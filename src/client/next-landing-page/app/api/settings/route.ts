import { recordAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { withTenant } from "@/lib/route";
import { optBoolean, optNumber, readJson } from "@/lib/validation";
import { getSettings, settingsFromRow, type SettingsRow } from "@/lib/workspace-repository";

export const runtime = "nodejs";

export const GET = withTenant(async ({ tenant }) => {
  return getSettings(tenant.organization.id);
});

export const PATCH = withTenant(async ({ tenant, request }) => {
  const body = await readJson(request);
  const fyStartMonth =
    body.fyStartMonth === undefined
      ? undefined
      : optNumber(body.fyStartMonth, "Financial year start month", 1);
  if (
    fyStartMonth !== undefined &&
    (!Number.isInteger(fyStartMonth) || fyStartMonth > 12)
  ) {
    throw new ValidationError("Financial year start month must be between 1 and 12");
  }

  const current = await getSettings(tenant.organization.id);
  const rawReminders = body.reminders ?? {};
  if (typeof rawReminders !== "object" || Array.isArray(rawReminders)) {
    throw new ValidationError("Reminders must be an object");
  }
  const reminders = rawReminders as Record<string, unknown>;
  const enabled = optBoolean(reminders.enabled, "Reminders enabled");
  const cadenceMinutes =
    reminders.cadenceMinutes === undefined
      ? undefined
      : optNumber(reminders.cadenceMinutes, "Reminder cadence", 5);
  if (
    cadenceMinutes !== undefined &&
    (!Number.isInteger(cadenceMinutes) || cadenceMinutes > 1440)
  ) {
    throw new ValidationError(
      "Reminder cadence must be a whole number of minutes, 5 to 1440",
    );
  }
  let lastSentAt: string | null | undefined;
  if (reminders.lastSentAt !== undefined) {
    const parsed = new Date(String(reminders.lastSentAt));
    if (Number.isNaN(parsed.getTime())) {
      throw new ValidationError("Reminder last-sent time is invalid");
    }
    lastSentAt = parsed.toISOString();
  }

  const result = await query<SettingsRow>(
    `update workspace_settings
     set reminder_enabled = $1,
         reminder_cadence_minutes = $2,
         reminder_last_sent_at = $3,
         fy_start_month = $4,
         updated_at = now()
     where organization_id = $5
     returning reminder_enabled, reminder_cadence_minutes, reminder_last_sent_at, fy_start_month`,
    [
      enabled ?? current.reminders.enabled,
      cadenceMinutes ?? current.reminders.cadenceMinutes,
      lastSentAt ?? current.reminders.lastSentAt ?? null,
      fyStartMonth ?? current.fyStartMonth,
      tenant.organization.id,
    ],
  );

  const next = settingsFromRow(result.rows[0]);

  // Audit only configuration changes; suppress the noisy lastSentAt heartbeat.
  const meaningfullyChanged =
    current.reminders.enabled !== next.reminders.enabled ||
    current.reminders.cadenceMinutes !== next.reminders.cadenceMinutes ||
    current.fyStartMonth !== next.fyStartMonth;
  if (meaningfullyChanged) {
    await recordAudit({
      tenant,
      request,
      action: "update",
      entityType: "settings",
      summary: "Updated workspace settings",
      before: current,
      after: next,
    });
  }
  return next;
});
