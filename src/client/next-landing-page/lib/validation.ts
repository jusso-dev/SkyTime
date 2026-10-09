import { query } from "@/lib/db";
import { ValidationError } from "@/lib/errors";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireString(
  value: unknown,
  field: string,
  max = 2000,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ValidationError(`${field} must be ${max} characters or fewer`);
  }
  return trimmed;
}

export function optString(value: unknown, field: string, max = 2000): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ValidationError(`${field} must be ${max} characters or fewer`);
  }
  return trimmed;
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ValidationError(`${field} must be a valid id`);
  }
  return value;
}

export function optUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireUuid(value, field);
}

export function requirePositiveNumber(value: unknown, field: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new ValidationError(`${field} must be greater than zero`);
  }
  return num;
}

export function optNumber(
  value: unknown,
  field: string,
  min = 0,
  max = 99999999,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new ValidationError(`${field} must be a number`);
  }
  if (num < min) {
    throw new ValidationError(`${field} must be at least ${min}`);
  }
  if (num > max) {
    throw new ValidationError(`${field} must be at most ${max}`);
  }
  return num;
}

export function optBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  throw new ValidationError(`${field} must be true or false`);
}

export function requireDateOnly(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`${field} must be a YYYY-MM-DD date`);
  }
  if (
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new ValidationError(`${field} is invalid`);
  return value;
}

export async function readJson(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    throw new ValidationError("Request body must be a JSON object");
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Request body must be valid JSON");
  }
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function optCurrency(
  value: unknown,
  field: string,
  fallback: string,
): string {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(normalized)) {
    throw new ValidationError(`${field} must be a 3-letter currency code`);
  }
  return normalized;
}

// Colors render in CSS `background` values; keep them to plain color tokens so
// values like url("https://…") cannot make every viewer's browser fetch a URL.
const COLOR_PATTERN =
  /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(oklch|rgb|rgba|hsl|hsla|lab|lch|color|light-dark|color-mix)\([\w\s.,%/#-]*\))$/;

export function optColor(value: unknown, field: string, fallback: string) {
  if (value === undefined || value === null || value === "") return fallback;
  const trimmed = String(value).trim();
  if (trimmed.length > 80 || !COLOR_PATTERN.test(trimmed)) {
    throw new ValidationError(`${field} must be a plain CSS color`);
  }
  return trimmed;
}

export async function requireProject(
  organizationId: string,
  projectId: string,
) {
  requireUuid(projectId, "Project");
  const result = await query(
    "select id from projects where id=$1 and organization_id=$2",
    [projectId, organizationId],
  );
  if (!result.rows[0])
    throw new ValidationError("Project not found in this organization");
}
export function entryTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((v) => typeof v !== "string" || !v.trim() || v.length > 60)
  )
    throw new ValidationError(
      "Tags must contain up to 20 names (60 characters each)",
    );
  return [...new Set(value.map((v) => v.trim()))];
}
export function duration(value: unknown): number {
  const n = requirePositiveNumber(value, "Duration");
  if (!Number.isInteger(n) || n > 2147483647)
    throw new ValidationError(
      "Duration must be an integer from 1 to 2147483647 milliseconds",
    );
  return n;
}
