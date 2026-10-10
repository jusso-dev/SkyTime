import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { schemaSql } from "@/db/schema-sql";
import { coerceRow, rewriteSql } from "@/lib/sql";

type SqlValue = string | number | bigint | Uint8Array | null;
type SqlRow = Record<string, any>;

export type QueryResult<T> = { rows: T[]; rowCount: number };

type SyncStatement = {
  all: (...params: SqlValue[]) => SqlRow[];
  run: (...params: SqlValue[]) => { changes: number };
  columns: () => unknown[];
};

type SyncDatabase = {
  prepare: (sql: string) => SyncStatement;
  exec: (sql: string) => void;
  close: () => void;
};

type D1Result = {
  results?: SqlRow[];
  meta?: { changes?: number };
};

type D1Statement = {
  all: () => Promise<D1Result>;
  bind: (...params: SqlValue[]) => D1Statement;
};

type D1Database = {
  prepare: (sql: string) => D1Statement;
  exec: (sql: string) => Promise<unknown>;
  batch: (statements: unknown[]) => Promise<unknown>;
};

type Database = SyncDatabase | D1Database;

const transactions = new AsyncLocalStorage<SyncDatabase | "d1">();

const globalState = globalThis as unknown as {
  skytimeSqlite?: SyncDatabase;
  skytimeD1?: D1Database;
  skytimeReady?: Promise<void>;
  skytimeMigrating?: boolean;
  skytimeRuntime?: "workers" | "node";
};

function onWorkers(): boolean {
  if (globalState.skytimeRuntime) return globalState.skytimeRuntime === "workers";
  const userAgent = globalThis.navigator?.userAgent;
  return typeof userAgent === "string" && userAgent.includes("Cloudflare-Workers");
}

async function resolveRuntime(): Promise<"workers" | "node"> {
  if (globalState.skytimeRuntime) return globalState.skytimeRuntime;
  if (onWorkers()) {
    globalState.skytimeRuntime = "workers";
    return "workers";
  }
  try {
    const specifier = "cloudflare:workers";
    const mod = (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as {
      env?: { DB?: D1Database };
    };
    // Present only inside a Worker. The vinext prerender stub throws on env access.
    if (mod.env?.DB) globalState.skytimeD1 = mod.env.DB;
    if (mod.env) {
      globalState.skytimeRuntime = "workers";
      return "workers";
    }
  } catch {
    // Node has no cloudflare:workers module.
  }
  globalState.skytimeRuntime = "node";
  return "node";
}

function nodeRequire(specifier: string) {
  // Built only when Node opens sqlite. Workers disallow new Function, and a
  // direct require() call is rewritten by the Vite build.
  const loadBuiltin = new Function(
    "createRequire",
    "url",
    "specifier",
    "return createRequire(url)(specifier)",
  ) as (
    createRequire: typeof import("node:module").createRequire,
    url: string,
    specifier: string,
  ) => { DatabaseSync: new (path: string) => SyncDatabase };
  return loadBuiltin(createRequire, import.meta.url, specifier);
}

function sqlitePath() {
  return path.resolve(
    /*turbopackIgnore: true*/ process.env.SKYTIME_SQLITE ?? "data/skytime.sqlite",
  );
}

function nodeDb(): SyncDatabase {
  if (globalState.skytimeSqlite) return globalState.skytimeSqlite;
  const file = sqlitePath();
  mkdirSync(path.dirname(file), { recursive: true });
  const { DatabaseSync } = nodeRequire("node:sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  globalState.skytimeSqlite = db;
  return db;
}

async function workerDb(): Promise<D1Database> {
  if (globalState.skytimeD1) return globalState.skytimeD1;
  const specifier = "cloudflare:workers";
  const mod = (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as {
    env?: { DB?: D1Database };
  };
  const db = mod.env?.DB;
  if (!db) throw new Error("D1 binding DB is required on Cloudflare Workers");
  globalState.skytimeD1 = db;
  return db;
}

export function authDatabase(): Database {
  if (onWorkers()) {
    const db = globalState.skytimeD1;
    if (!db) throw new Error("Call ensureReady() before using auth on Workers");
    return db;
  }
  return nodeDb();
}

function wordCount(sql: string, word: string) {
  const matches = sql.match(new RegExp(`\\b${word}\\b`, "gi"));
  return matches ? matches.length : 0;
}

// D1's HTTP query API splits on every semicolon and rejects trigger bodies.
// Keep begin/end blocks together, then run them with the binding batch API.
function sqlStatements(sql: string) {
  const parts: string[] = [];
  let current = "";
  let quote = false;
  let line = false;
  let block = false;
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    const next = sql[index + 1];
    if (line) {
      current += char;
      if (char === "\n") line = false;
      continue;
    }
    if (block) {
      current += char;
      if (char === "*" && next === "/") {
        current += "/";
        index++;
        block = false;
      }
      continue;
    }
    if (quote) {
      current += char;
      if (char === "'") {
        if (next === "'") {
          current += "'";
          index++;
          continue;
        }
        quote = false;
      }
      continue;
    }
    if (char === "-" && next === "-") {
      line = true;
      current += char;
      continue;
    }
    if (char === "/" && next === "*") {
      block = true;
      current += char;
      continue;
    }
    if (char === "'") {
      quote = true;
      current += char;
      continue;
    }
    if (char === ";") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);

  const statements: string[] = [];
  let buffer: string[] = [];
  let depth = 0;
  for (const part of parts) {
    buffer.push(part);
    depth += wordCount(part, "begin") - wordCount(part, "end");
    if (depth <= 0) {
      const statement = buffer.join(";").trim();
      if (statement) statements.push(statement);
      buffer = [];
      depth = 0;
    }
  }
  if (buffer.length) {
    const statement = buffer.join(";").trim();
    if (statement) statements.push(statement);
  }
  return statements;
}

async function applySchema(db: Database) {
  if (!onWorkers()) {
    (db as SyncDatabase).exec(schemaSql);
    return;
  }
  const d1 = db as D1Database;
  const statements = sqlStatements(schemaSql).map((sql) => d1.prepare(sql));
  const chunkSize = 25;
  for (let index = 0; index < statements.length; index += chunkSize) {
    await d1.batch(statements.slice(index, index + chunkSize));
  }
}

export async function ensureReady() {
  if (globalState.skytimeReady) return globalState.skytimeReady;
  globalState.skytimeReady = migrate().catch((error) => {
    globalState.skytimeReady = undefined;
    throw error;
  });
  return globalState.skytimeReady;
}

async function migrate() {
  globalState.skytimeMigrating = true;
  try {
    const runtime = await resolveRuntime();
    const db = runtime === "workers" ? await workerDb() : nodeDb();
    await applySchema(db);
    // better-auth 1.7 does not export getMigrations from the "better-auth/db" entry.
    const { getMigrations } = (await import(
      "../node_modules/better-auth/dist/db/get-migration.mjs"
    )) as {
      getMigrations: (config: any) => Promise<{ runMigrations: () => Promise<void> }>;
    };
    const { authOptions } = await import("@/lib/auth");
    const plan = await getMigrations(authOptions(db));
    await plan.runMigrations();
  } catch (error) {
    const message = error instanceof Error ? error.message : "migrate failed";
    console.error("skytime migrate failed:", message.slice(0, 500));
    throw error;
  } finally {
    globalState.skytimeMigrating = false;
  }
}

function result<T>(rows: T[], changes: number): QueryResult<T> {
  return { rows, rowCount: rows.length > 0 ? rows.length : changes };
}

async function run<T>(text: string, params: unknown[]): Promise<QueryResult<T>> {
  const rewritten = rewriteSql(text, params);
  const values = rewritten.params as SqlValue[];
  const tx = transactions.getStore();
  if (onWorkers() || tx === "d1") {
    const db = await workerDb();
    const statement = db.prepare(rewritten.sql);
    const bound = values.length ? statement.bind(...values) : statement;
    const queryResult = await bound.all();
    const rows = (queryResult.results ?? []).map((row) => coerceRow(row as T));
    return result(rows, queryResult.meta?.changes ?? 0);
  }
  const db = tx ?? nodeDb();
  const statement = db.prepare(rewritten.sql);
  if (statement.columns().length > 0) {
    const rows = statement.all(...values).map((row) => coerceRow(row as T));
    return result(rows, rows.length);
  }
  return result([], statement.run(...values).changes ?? 0);
}

export async function query<T = any>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  if (!globalState.skytimeMigrating) await ensureReady();
  return run<T>(text, params);
}

type TxClient = { query: typeof query };

export async function transaction<T>(work: (client: TxClient) => Promise<T>): Promise<T> {
  if (transactions.getStore()) return work({ query });
  await ensureReady();
  if (onWorkers()) {
    // D1 commits each statement. The callback still runs in order.
    return transactions.run("d1", () => work({ query }));
  }
  const db = nodeDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = await transactions.run(db, () => work({ query }));
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The original error is the one to surface.
    }
    throw error;
  }
}

export async function tenantMutation<T>(_organizationId: string, work: () => Promise<T>) {
  return transaction(async () => work());
}

export function toNumber(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}
