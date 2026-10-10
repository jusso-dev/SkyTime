import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const file = path.resolve(process.env.SKYTIME_SQLITE ?? "data/skytime.sqlite");
mkdirSync(path.dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec("PRAGMA foreign_keys = ON");

try {
  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  const sql = await readFile(schemaPath, "utf8");
  db.exec(sql);
  console.log("SkyTime database schema is ready.");
} finally {
  db.close();
}
