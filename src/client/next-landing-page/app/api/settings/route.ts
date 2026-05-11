import { NextResponse } from "next/server";
import { badRequest, serverError } from "@/lib/api-response";
import { query } from "@/lib/db";
import { getSettings, settingsFromRow, type SettingsRow } from "@/lib/workspace-repository";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { tenant, error } = await requireTenant(request);
    if (error || !tenant) return error;
    return NextResponse.json(await getSettings(tenant.organization.id));
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { tenant, error } = await requireTenant(request);
    if (error || !tenant) return error;

    const body = await request.json();
    const fyStartMonth = body.fyStartMonth === undefined ? undefined : Number(body.fyStartMonth);
    if (fyStartMonth !== undefined && (fyStartMonth < 1 || fyStartMonth > 12)) {
      return badRequest("Financial year start month must be between 1 and 12");
    }

    const current = await getSettings(tenant.organization.id);
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
        body.reminders?.enabled ?? current.reminders.enabled,
        body.reminders?.cadenceMinutes ?? current.reminders.cadenceMinutes,
        body.reminders?.lastSentAt ?? current.reminders.lastSentAt ?? null,
        fyStartMonth ?? current.fyStartMonth,
        tenant.organization.id,
      ],
    );

    return NextResponse.json(settingsFromRow(result.rows[0]));
  } catch (error) {
    return serverError(error);
  }
}
