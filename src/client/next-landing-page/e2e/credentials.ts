import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "@better-auth/utils/password";

const db = new DatabaseSync(process.env.SKYTIME_SQLITE ?? "data/skytime-test.sqlite");
db.exec("PRAGMA busy_timeout = 5000");

export const TEST_PASSWORD = "A-strong-test-password-123!";

async function waitForAuthTables() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const table = db
      .prepare("select name from sqlite_master where type = 'table' and name = 'user'")
      .get() as { name: string } | undefined;
    if (table) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Auth tables are missing. Request /api/v1/health before seeding.");
}

export async function seedCredential(input: {
  name: string;
  email: string;
  password?: string;
}) {
  await waitForAuthTables();
  const email = input.email.toLowerCase();
  const password = input.password ?? TEST_PASSWORD;
  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  const userId = randomBytes(16).toString("hex");
  const accountRowId = randomBytes(16).toString("hex");
  db.prepare(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", "twoFactorEnabled")
     values (?, ?, ?, 1, ?, ?, 0)`,
  ).run(userId, input.name, email, now, now);
  db.prepare(
    `insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
     values (?, ?, 'credential', ?, ?, ?, ?)`,
  ).run(accountRowId, userId, userId, hash, now, now);
  return { email, userId, password };
}
