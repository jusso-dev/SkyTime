import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types, type PoolClient, type QueryResultRow } from "pg";

types.setTypeParser(1082, (value) => new Date(`${value}T00:00:00.000Z`));

const globalForPool = globalThis as unknown as {
  skytimePool?: Pool;
};

export const pool =
  globalForPool.skytimePool ??
  new Pool({
    options: "-c timezone=UTC",
    connectionString:
      process.env.DATABASE_URL ??
      "postgres://skytime:skytime@localhost:55432/skytime",
  });

if (process.env.NODE_ENV !== "production") {
  globalForPool.skytimePool = pool;
}

const transactions = new AsyncLocalStorage<PoolClient>();

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
) {
  return (transactions.getStore() ?? pool).query<T>(text, params);
}

export function toNumber(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export async function transaction<T>(
  work: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  const existing = transactions.getStore();
  if (existing) return work(existing);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await transactions.run(client, () => work(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function tenantMutation<T>(
  organizationId: string,
  work: () => Promise<T>,
) {
  return transaction(async (client) => {
    // Serialize tenant mutations before acquiring row locks. The same connection
    // is reused by legacy routes, services, audit writes and nested transactions.
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1,42))",
      [organizationId],
    );
    return work();
  });
}
