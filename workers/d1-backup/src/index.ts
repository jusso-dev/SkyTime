interface Env {
  BACKUPS: R2Bucket;
  DB: D1Database;
}

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 200;

type SchemaRow = { type: string; name: string; sql: string | null };
type ColumnRow = { name: string };

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(backup(env, new Date(controller.scheduledTime)));
  },
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};

async function backup(env: Env, when: Date) {
  const day = when.toISOString().slice(0, 10);
  const key = `skytime/${day}.sql`;
  const sql = await exportDatabase(env);
  const stored = await env.BACKUPS.put(key, sql, {
    httpMetadata: { contentType: "application/sql; charset=utf-8" },
  });
  await assertSql(env, key);
  await deleteExpired(env, when.getTime() - RETENTION_MS);
  console.log(`d1 backup ${key} ${stored?.size ?? sql.byteLength} bytes`);
}

async function exportDatabase(env: Env) {
  const session = env.DB.withSession("first-primary");
  const schema = await session
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_cf_%'`,
    )
    .all<SchemaRow>();
  const objects = [...schema.results].sort(compareSchema);
  const tables = objects.filter((row) => row.type === "table" && row.sql);
  if (tables.length === 0) throw new Error("D1 backup found no tables");

  const lines = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];
  for (const table of tables) {
    lines.push(statement(table.sql!));
    await dumpTable(session, table.name, lines);
  }
  for (const row of objects) {
    if (row.type === "table" || !row.sql) continue;
    lines.push(statement(row.sql));
  }
  lines.push("COMMIT;");
  return new TextEncoder().encode(`${lines.join("\n")}\n`).buffer;
}

async function dumpTable(session: D1DatabaseSession, table: string, lines: string[]) {
  const info = await session
    .prepare(`PRAGMA table_info(${quoteIdent(table)})`)
    .all<ColumnRow>();
  const columns = info.results.map((column) => column.name).filter(Boolean);
  if (columns.length === 0) throw new Error(`D1 backup table ${table} has no columns`);
  const columnList = columns.map(quoteIdent).join(", ");
  const listed = quoteIdent(table);
  for (let offset = 0; offset < 1_000_000; offset += PAGE_SIZE) {
    const page = await session
      .prepare(`SELECT * FROM ${listed} LIMIT ?1 OFFSET ?2`)
      .bind(PAGE_SIZE, offset)
      .all<Record<string, unknown>>();
    for (const row of page.results) {
      const values = columns.map((column) => sqlLiteral(row[column]));
      lines.push(`INSERT INTO ${listed} (${columnList}) VALUES (${values.join(", ")});`);
    }
    if (page.results.length < PAGE_SIZE) return;
  }
  throw new Error(`D1 backup table ${table} exceeded the row cap`);
}

function compareSchema(a: SchemaRow, b: SchemaRow) {
  return schemaRank(a.type) - schemaRank(b.type) || a.name.localeCompare(b.name);
}

function schemaRank(type: string) {
  if (type === "table") return 0;
  if (type === "index") return 1;
  if (type === "trigger") return 2;
  if (type === "view") return 3;
  return 4;
}

function statement(sql: string) {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  return `${trimmed};`;
}

function quoteIdent(name: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error("D1 backup found an unexpected identifier");
  }
  return `"${name}"`;
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("D1 backup saw a non-finite number");
    return String(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") return quoteText(value);
  if (value instanceof Date) return quoteText(value.toISOString());
  if (value instanceof ArrayBuffer) return blobLiteral(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) {
    return blobLiteral(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (typeof value === "object") return quoteText(JSON.stringify(value));
  throw new Error("D1 backup saw an unsupported value type");
}

function quoteText(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function blobLiteral(bytes: Uint8Array) {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `X'${hex}'`;
}

async function assertSql(env: Env, key: string) {
  const head = await env.BACKUPS.get(key, { range: { offset: 0, length: 512 } });
  const preview = await head?.text();
  if (!preview || !/CREATE TABLE|PRAGMA /i.test(preview)) {
    throw new Error("D1 backup was not a SQL dump");
  }
}

async function deleteExpired(env: Env, cutoffMs: number) {
  let cursor: string | undefined;
  do {
    const page = await env.BACKUPS.list({ prefix: "skytime/", cursor });
    for (const object of page.objects) {
      if (object.uploaded.getTime() < cutoffMs) await env.BACKUPS.delete(object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
