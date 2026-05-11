import { Pool, type QueryResultRow } from "pg";

const globalForPool = globalThis as unknown as {
  skytimePool?: Pool;
};

export const pool =
  globalForPool.skytimePool ??
  new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://skytime:skytime@localhost:55432/skytime",
  });

if (process.env.NODE_ENV !== "production") {
  globalForPool.skytimePool = pool;
}

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}

export function toNumber(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}
