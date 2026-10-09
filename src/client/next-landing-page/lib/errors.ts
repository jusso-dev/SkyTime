import { requestContext } from "@/lib/request-context";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "request_failed") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class ValidationError extends HttpError {
  constructor(message: string) {
    super(400, message, "validation_failed");
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(404, message, "not_found");
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden") {
    super(403, message, "forbidden");
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super(409, message, "conflict");
  }
}

export type ErrorContext = {
  organizationId?: string | null;
  userId?: string | null;
  request?: Request;
  status?: number;
  context?: Record<string, unknown>;
};

export async function captureError(error: unknown, ctx: ErrorContext = {}) {
  const tenantContext = ctx.request
    ? requestContext.get(ctx.request)
    : undefined;
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  const stack = error instanceof Error ? (error.stack ?? null) : null;
  const status =
    ctx.status ?? (error instanceof HttpError ? error.status : 500);
  const method = ctx.request?.method ?? null;
  const path = ctx.request ? safePath(ctx.request.url) : null;

  // Always log to console so it shows up in the platform logs.
  // Validation errors are noisy but expected — surface them as warn-level.
  const isClientError = status >= 400 && status < 500;
  const logger = isClientError ? console.warn : console.error;
  logger(
    `[skytime] ${method ?? "?"} ${path ?? "?"} → ${status} ${message}`,
    error,
  );

  try {
    await query(
      `insert into error_log (organization_id, user_id, level, message, stack, context, path, method, status_code)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        ctx.organizationId ?? tenantContext?.organizationId ?? null,
        ctx.userId ?? tenantContext?.userId ?? null,
        isClientError ? "warn" : "error",
        message,
        stack,
        ctx.context ? JSON.stringify(ctx.context) : null,
        path,
        method,
        status,
      ],
    );
  } catch (writeError) {
    // Avoid recursion if the database itself is unreachable.
    console.error("[skytime] error_log write failed", writeError);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "23514")
      return NextResponse.json(
        {
          error: "The change violates a tenant, approval, or billing lock",
          code: "record_locked",
        },
        { status: 409 },
      );
    if (error.code === "23505")
      return NextResponse.json(
        {
          error: "A record with that identity already exists",
          code: "conflict",
        },
        { status: 409 },
      );
    if (error.code === "23503")
      return NextResponse.json(
        { error: "This record is referenced by other records", code: "in_use" },
        { status: 409 },
      );
  }
  return NextResponse.json(
    { error: "Server error", code: "server_error" },
    { status: 500 },
  );
}

function safePath(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}
