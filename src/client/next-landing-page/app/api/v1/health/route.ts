import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let database: "ok" | "down" = "ok";
  try {
    await query("select 1");
  } catch (error) {
    const message = error instanceof Error ? error.message : "query failed";
    console.error("skytime health failed:", message.slice(0, 500));
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
