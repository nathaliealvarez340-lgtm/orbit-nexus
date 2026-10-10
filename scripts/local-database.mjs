import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketHandler } from "@electric-sql/pglite-socket";
import { createServer } from "node:net";
import { readdir, readFile, mkdir } from "node:fs/promises";

// Extended-query messages: Parse, Bind, Describe, Execute, Close, Flush. They form one unit
// with the Sync that follows them.
const extendedQueryMessages = new Set(
  [..."PBDECH"].map((type) => type.charCodeAt(0)),
);

// PGlite is a single PostgreSQL session shared by every socket connection. The stock
// pglite-socket queue runs each protocol message separately, so outside a transaction (and
// right after COMMIT, before the owner's Sync) messages from different connections
// interleave: one connection's Bind/Execute then runs another connection's unnamed statement
// or loses its unnamed portal (34000), returning wrong rows or errors. A real PostgreSQL
// server has one backend per connection, so this queue gives one connection the session
// from its first message until its Sync or simple Query completes, and for its whole
// transaction.
class SessionQueue {
  queue = [];
  owner = null;
  processing = false;
  constructor(db) {
    this.db = db;
  }
  /**
   * @param {number} handlerId
   * @param {Uint8Array} message
   * @param {(data: Uint8Array) => void} onData
   */
  enqueue(handlerId, message, onData) {
    return new Promise((resolve, reject) => {
      this.queue.push({ handlerId, message, onData, resolve, reject });
      void this.process();
    });
  }
  async process() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length) {
        const index =
          this.owner === null
            ? 0
            : this.queue.findIndex((item) => item.handlerId === this.owner);
        // The owner's next message has not arrived yet; nobody else may use the session.
        if (index === -1) break;
        const [item] = this.queue.splice(index, 1);
        this.owner = item.handlerId;
        let bytes = 0;
        try {
          await this.db.runExclusive(() =>
            this.db.execProtocolRawStream(item.message, {
              onRawData: (data) => {
                bytes += data.length;
                item.onData(data);
              },
            }),
          );
        } catch (error) {
          if (!this.db.isInTransaction()) this.owner = null;
          item.reject(error);
          continue;
        }
        if (
          !extendedQueryMessages.has(item.message[0]) &&
          !this.db.isInTransaction()
        )
          this.owner = null;
        item.resolve(bytes);
      }
    } finally {
      this.processing = false;
    }
  }
  getQueueLength() {
    return this.queue.length;
  }
  /** @param {number} handlerId */
  clearQueueForHandler(handlerId) {
    this.queue = this.queue.filter((item) => {
      if (item.handlerId !== handlerId) return true;
      item.reject(new Error("Handler disconnected"));
      return false;
    });
  }
  /** @param {number} handlerId */
  async clearTransactionIfNeeded(handlerId) {
    if (this.owner !== handlerId) return;
    if (this.db.isInTransaction()) await this.db.exec("ROLLBACK");
    this.owner = null;
    await this.process();
  }
}

export async function startDatabase(persistent = false) {
  if (persistent) await mkdir(".orbit-local", { recursive: true });
  const db = await PGlite.create(
    persistent ? ".orbit-local/postgres" : undefined,
  );
  await db.exec(
    'CREATE TABLE IF NOT EXISTS "_orbit_local_migrations" ("name" TEXT PRIMARY KEY)',
  );
  for (const name of (await readdir("prisma/migrations")).sort()) {
    if (!/^\d/.test(name)) continue;
    const existing = await db.query(
      'SELECT "name" FROM "_orbit_local_migrations" WHERE "name"=$1',
      [name],
    );
    if (!existing.rows.length) {
      await db.exec(
        await readFile("prisma/migrations/" + name + "/migration.sql", "utf8"),
      );
      await db.query(
        'INSERT INTO "_orbit_local_migrations" ("name") VALUES ($1)',
        [name],
      );
    }
  }
  const queryQueue = new SessionQueue(db);
  const handlers = new Set();
  const server = createServer((socket) => {
    const handler = new PGLiteSocketHandler({
      // SessionQueue implements the QueryQueueManager interface the handler uses.
      queryQueue: /** @type {any} */ (queryQueue),
      closeOnDetach: true,
    });
    handlers.add(handler);
    handler.addEventListener("close", () => handlers.delete(handler));
    handler.attach(socket).catch(() => {
      handlers.delete(handler);
      socket.destroy();
    });
  });
  server.maxConnections = 20;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = /** @type {import("node:net").AddressInfo} */ (
    server.address()
  );
  return {
    db,
    url:
      "postgresql://postgres:postgres@" +
      `${address.address}:${address.port}` +
      "/postgres",
    async close() {
      await Promise.all([...handlers].map((handler) => handler.detach(true)));
      await new Promise((resolve) => server.close(() => resolve(undefined)));
      await db.close();
    },
  };
}
