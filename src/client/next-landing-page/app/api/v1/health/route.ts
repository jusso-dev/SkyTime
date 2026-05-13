import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let database: "ok" | "down" = "ok";
  try {
    await query("select 1");
  } catch {
    database = "down";
  }
  return NextResponse.json(
    {
      version: "v1",
      status: database === "ok" ? "ok" : "degraded",
      database,
      time: new Date().toISOString(),
    },
    { status: database === "ok" ? 200 : 503 },
  );
}
