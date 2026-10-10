import { auth } from "@/lib/auth";
import { ensureReady } from "@/lib/db";
import { toNextJsHandler } from "better-auth/next-js";

export const runtime = "nodejs";

let handlers: ReturnType<typeof toNextJsHandler> | undefined;

async function ready() {
  await ensureReady();
  handlers ??= toNextJsHandler(auth);
  return handlers;
}

export async function GET(request: Request) {
  return (await ready()).GET(request);
}

export async function POST(request: Request) {
  return (await ready()).POST(request);
}
