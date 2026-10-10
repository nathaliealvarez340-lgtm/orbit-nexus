import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { currentMexicoMonth } from "../src/lib/report-periods";
import {
  listMonthlyReports,
  type ReportTenant,
} from "../src/services/monthly-reports";
import { startDatabase } from "../scripts/local-database.mjs";

// The previous Mexico month is always closed; the 15th avoids time-zone edges.
const now = currentMexicoMonth();
const period =
  now.month === 1
    ? { year: now.year - 1, month: 12 }
    : { year: now.year, month: now.month - 1 };
const purchaseDate = `${period.year}-${String(period.month).padStart(2, "0")}-15`;
const tenantA: ReportTenant = {
  organizationId: "org-a",
  organizationName: "Org A",
};
const tenantB: ReportTenant = {
  organizationId: "org-b",
  organizationName: "Org B",
};

let database: Awaited<ReturnType<typeof startDatabase>>;
let db: PrismaClient;
const sql = async <T>(query: string, params: unknown[] = []) =>
  (await database.db.query<T>(query, params)).rows;
const client = (adapter: PrismaPg) => new PrismaClient({ adapter });
const pgAdapter = () =>
  new PrismaPg({ connectionString: database.url, max: 5 });

before(async () => {
  database = await startDatabase();
  db = client(pgAdapter());
  await database.db.exec(`
    INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('user-a','A','a@example.test',NOW()),('user-b','B','b@example.test',NOW());
    INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('org-a','Org A',NOW()),('org-b','Org B',NOW());`);
  for (const [id, org, user, total] of [
    ["expense-one", "org-a", "user-a", "123.45"],
    ["expense-two", "org-a", "user-a", "80.50"],
    ["expense-b", "org-b", "user-b", "10.00"],
  ]) {
    await sql(
      `INSERT INTO "Ticket" (id,"organizationId","userId","fileName","storageKey","mimeType",status,"updatedAt") VALUES ($1,$2,$3,'synthetic.png','local-test','image/png','REGISTERED',NOW())`,
      [id, org, user],
    );
    await sql(
      `INSERT INTO "Expense" (id,"organizationId","ticketId","capturedById",merchant,"purchaseDate",total,details) VALUES ($1,$2,$1,$3,'Comercio local prueba',$4,$5,$6)`,
      [id, org, user, purchaseDate, total, { issuerRfc: "CCC010101CCC" }],
    );
  }
  await sql(
    `INSERT INTO "Invoice" (id,"organizationId","userId","ticketId",status,"receiverRfc",subtotal,tax,total,"updatedAt",uuid) VALUES ('incoming-fixture','org-a','user-a','expense-two','ISSUED','AAA010101AAA',80.50,0,80.50,NOW(),'00000000-0000-4000-8000-000000000001')`,
  );
  await sql(
    `UPDATE "Expense" SET "billingStatus"='INVOICED' WHERE id='expense-two'`,
  );
});

after(async () => {
  await db?.$disconnect();
  await database?.close();
});

const resetReports = () =>
  database.db.exec(
    `DELETE FROM "Notification"; DELETE FROM "MonthlyExpenseReport";`,
  );
const stored = (organizationId: string) =>
  sql<{
    id: string;
    created: string;
    notifications: number;
    eventKeys: string[];
  }>(
    `SELECT r.id, to_char(r."createdAt", 'YYYY-MM-DD HH24:MI:SS') AS created,
       (SELECT COUNT(*)::int FROM "Notification" n WHERE n."organizationId"=r."organizationId") AS notifications,
       (SELECT array_agg(n."eventKey") FROM "Notification" n WHERE n."organizationId"=r."organizationId") AS "eventKeys"
     FROM "MonthlyExpenseReport" r WHERE r."organizationId"=$1 AND r.year=$2 AND r.month=$3`,
    [organizationId, period.year, period.month],
  );
const closedPeriod = (
  reports: Awaited<ReturnType<typeof listMonthlyReports>>,
) => reports.find((r) => r.year === period.year && r.month === period.month);

test("concurrent report requests close a month once per Organization", async () => {
  for (let round = 0; round < 5; round++) {
    await resetReports();
    const [first, second, other] = await Promise.all([
      listMonthlyReports(db, tenantA),
      listMonthlyReports(db, tenantA),
      listMonthlyReports(db, tenantB),
    ]);
    for (const reports of [first, second]) {
      const report = closedPeriod(reports);
      assert(report, "both concurrent requests return the closed period");
      assert.equal(report.total.toFixed(2), "203.95");
      assert.equal(report.ticketCount, 2);
      assert.equal(report.invoiceCount, 1);
      assert.equal(report.pendingCount, 1);
      assert.equal(reports.length, 1);
    }
    assert.equal(closedPeriod(first)!.id, closedPeriod(second)!.id);
    const a = await stored("org-a");
    assert.equal(a.length, 1, "one report per organization/year/month");
    assert.equal(a[0].notifications, 1, "one notification per report");
    assert.deepEqual(a[0].eventKeys, ["report:" + a[0].id]);
    // Tenant isolation: Organization B only sees and stores its own period.
    const b = await stored("org-b");
    assert.equal(b.length, 1);
    assert.equal(b[0].notifications, 1);
    assert.deepEqual(b[0].eventKeys, ["report:" + b[0].id]);
    assert.equal(other.length, 1);
    assert.equal(closedPeriod(other)!.id, b[0].id);
    assert.equal(closedPeriod(other)!.total.toFixed(2), "10.00");
    assert.equal(closedPeriod(other)!.ticketCount, 1);
    const snapshots = await sql<{ organization: string; rows: number }>(
      `SELECT snapshot->>'organization' AS organization, jsonb_array_length(snapshot->'rows') AS rows FROM "MonthlyExpenseReport" ORDER BY "organizationId"`,
    );
    assert.deepEqual(snapshots, [
      { organization: "Org A", rows: 2 },
      { organization: "Org B", rows: 1 },
    ]);
  }
});

// Runs `hook` before every statement of each interactive transaction, at the driver
// adapter, so a test can place a concurrent write at an exact point of the transaction.
function beforeTransactionStatements(
  factory: PrismaPg,
  hook: (sql: string) => Promise<void>,
) {
  type Method = (...args: unknown[]) => Promise<unknown>;
  const wrap = <T extends object>(
    target: T,
    intercept: Record<string, (original: Method) => Method>,
  ) =>
    new Proxy(target, {
      get(object, property) {
        const value: unknown = Reflect.get(object, property, object);
        if (typeof value !== "function") return value;
        const bound = (value as Method).bind(object);
        return typeof property === "string" && intercept[property]
          ? intercept[property](bound)
          : bound;
      },
    });
  const statement =
    (run: Method): Method =>
    async (query) => {
      await hook((query as { sql: string }).sql);
      return run(query);
    };
  return wrap(factory, {
    connect: (connect) => async () =>
      wrap((await connect()) as object, {
        startTransaction:
          (start) =>
          async (...args) =>
            wrap((await start(...args)) as object, {
              queryRaw: statement,
              executeRaw: statement,
            }),
      }),
  });
}

test("a period stored by a concurrent request right before the insert is reused, not duplicated", async () => {
  await resetReports();
  // In PostgreSQL (READ COMMITTED) another request can commit the same period after this
  // request checked it and before it inserts. PGlite has one session, so the concurrent
  // request's report and notification are written at that exact point of the transaction.
  const concurrent = {
    id: "concurrent-report",
    createdAt: "2000-01-01 00:00:00",
    snapshot: {
      organization: "Org A",
      rfc: "Sin perfil fiscal",
      ...period,
      total: "203.95",
      ticketCount: 2,
      invoiceCount: 1,
      pendingCount: 1,
      rows: ["expense-one", "expense-two"].map((ticketId) => ({
        ticketId,
        date: purchaseDate,
        merchant: "Comercio local prueba",
        rfc: "CCC010101CCC",
        folio: "",
        uuid: "",
        total: ticketId === "expense-one" ? "123.45" : "80.50",
        status: ticketId === "expense-one" ? "PENDING" : "INVOICED",
      })),
    },
  };
  let inserted = false;
  const racing = client(
    beforeTransactionStatements(pgAdapter(), async (statement) => {
      if (
        inserted ||
        !statement.includes('INTO "public"."MonthlyExpenseReport"')
      )
        return;
      inserted = true;
      await sql(
        `INSERT INTO "MonthlyExpenseReport" (id,"organizationId",year,month,total,"ticketCount","invoiceCount","pendingCount",snapshot,"createdAt") VALUES ($1,'org-a',$2,$3,203.95,2,1,1,$4,$5)`,
        [
          concurrent.id,
          period.year,
          period.month,
          concurrent.snapshot,
          concurrent.createdAt,
        ],
      );
      await sql(
        `INSERT INTO "Notification" (id,"organizationId","eventKey",title,message,href,type) VALUES ('concurrent-notification','org-a',$1,'Reporte mensual disponible','concurrent','/dashboard/reports','REPORT_AVAILABLE')`,
        ["report:" + concurrent.id],
      );
    }),
  );
  try {
    const report = closedPeriod(await listMonthlyReports(racing, tenantA));
    assert(
      inserted,
      "the concurrent write ran inside the generation transaction",
    );
    assert.equal(report?.id, concurrent.id);
    assert.equal(report.total.toFixed(2), "203.95");
    assert.equal(report.invoiceCount, 1);
    assert.equal(report.pendingCount, 1);
    const rows = await stored("org-a");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, concurrent.id);
    assert.equal(
      rows[0].created,
      concurrent.createdAt,
      "the first stored report is kept",
    );
    assert.equal(rows[0].notifications, 1);
    assert.deepEqual(rows[0].eventKeys, ["report:" + concurrent.id]);
  } finally {
    await racing.$disconnect();
  }
});

test("local PGlite server never mixes protocol messages of concurrent connections", async () => {
  const pool = new pg.Pool({ connectionString: database.url, max: 4 });
  let running = true;
  // One connection keeps opening short transactions, like Prisma interactive transactions,
  // while three others run parameterized queries with different result shapes.
  const transactions = (async () => {
    const connection = await pool.connect();
    try {
      while (running) {
        await connection.query("BEGIN");
        await connection.query("SELECT $1::int AS n", [1]);
        await new Promise((resolve) => setTimeout(resolve, 2));
        await connection.query("COMMIT");
      }
    } finally {
      connection.release();
    }
  })();
  const shapes = [
    "SELECT $1::text AS tag, $2::int AS i",
    "SELECT $1::text AS tag, $2::int AS i, 'x'::text AS extra",
    "SELECT $1::text AS tag, $2::int AS i, 1 AS a, 2 AS b",
  ];
  const wrong: unknown[] = [];
  try {
    await Promise.all(
      shapes.map(async (query, index) => {
        for (let i = 0; i < 60; i++) {
          const { rows } = await pool.query(query, ["c" + index, i]);
          if (
            rows.length !== 1 ||
            rows[0].tag !== "c" + index ||
            rows[0].i !== i
          )
            wrong.push({ expected: ["c" + index, i], rows });
        }
      }),
    );
  } finally {
    running = false;
    await transactions;
    await pool.end();
  }
  assert.deepEqual(wrong, []);
});
