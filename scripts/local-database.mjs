import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readdir, readFile, mkdir } from "node:fs/promises";
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
  const server = new PGLiteSocketServer({
    db,
    port: 0,
    host: "127.0.0.1",
    maxConnections: 20,
  });
  await server.start();
  return {
    db,
    url: "postgresql://postgres:postgres@" + server.getServerConn() + "/postgres",
    async close() {
      await server.stop();
      await db.close();
    },
  };
}
