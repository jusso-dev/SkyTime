const JSON_COLUMNS = new Set([
  "tags",
  "filters",
  "lines",
  "client_snapshot",
  "branding_snapshot",
  "before_data",
  "after_data",
  "context",
  "financials",
]);

const BOOLEAN_COLUMNS = new Set(["billable", "reminder_enabled", "locked"]);

const DATE_COLUMNS = new Set(["period_start", "period_end", "deadline"]);

export function rewriteSql(sql: string, params: unknown[]) {
  let text = sql.replace(/\s+for\s+update(\s+of\s+[A-Za-z_][A-Za-z0-9_]*)?/gi, "");
  text = text.replace(
    /([A-Za-z0-9_.]+)\s*=\s*any\(\$(\d+)(?:::[A-Za-z0-9_[\]]+)?\)/gi,
    "$1 in (select value from json_each($$$2))",
  );
  text = text.replace(
    /\$(\d+)\s*=\s*any\(([^)]+)\)/gi,
    "exists (select 1 from json_each($2) where value = $$$1)",
  );
  text = text.replace(/\$(\d+)::[A-Za-z_][A-Za-z0-9_[\]]*/g, "$$$1");
  text = text.replace(
    /::(float8?|double|int|integer|bigint|date|timestamptz|timestamp|text|jsonb|json|uuid|numeric|boolean)/gi,
    "",
  );
  text = text.replace(
    /([A-Za-z_][A-Za-z0-9_.]*)\s*\+\s*interval\s+'1 day'/gi,
    "date($1, '+1 day')",
  );
  text = text.replace(
    /\bnow\(\)/gi,
    "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
  );
  text = text.replace(/([A-Za-z0-9_.]+)\s+nulls\s+first/gi, "$1 is not null, $1");
  text = text.replace(
    /([A-Za-z0-9_.]+)\s+(asc|desc)\s+nulls\s+last/gi,
    "$1 is null, $1 $2",
  );
  text = text.replace(/\bilike\b/gi, "like");
  const next: unknown[] = [];
  text = text.replace(/\$(\d+)/g, (_match, index: string) => {
    next.push(coerceParam(params[Number(index) - 1]));
    return "?";
  });
  return { sql: text, params: next };
}

const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function coerceParam(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "string" && ISO_INSTANT.test(value)) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  if (value === undefined) return null;
  return value;
}

export function coerceRow<T>(row: T): T {
  if (!row || typeof row !== "object" || row instanceof Date) return row;
  // node:sqlite rows use a null prototype. Next.js refuses those as RSC props.
  const record: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const [key, value] of Object.entries(record)) {
    if (JSON_COLUMNS.has(key) && typeof value === "string") {
      try {
        record[key] = JSON.parse(value);
      } catch {
        // Leave non-JSON text alone.
      }
      continue;
    }
    if (BOOLEAN_COLUMNS.has(key) && (value === 0 || value === 1)) {
      record[key] = value === 1;
      continue;
    }
    if (typeof value !== "string") continue;
    if (key.endsWith("_at")) {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) record[key] = new Date(parsed);
      continue;
    }
    if (DATE_COLUMNS.has(key) && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      record[key] = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
    }
  }
  return record as T;
}
