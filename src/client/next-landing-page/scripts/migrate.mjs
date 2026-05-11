import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL ?? "postgres://skytime:skytime@localhost:55432/skytime";
const pool = new Pool({ connectionString: databaseUrl });

try {
  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  const sql = await readFile(schemaPath, "utf8");
  await pool.query(sql);
  console.log("SkyTime database schema is ready.");
} finally {
  await pool.end();
}
