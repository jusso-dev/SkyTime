import { optNumber, optString, requireProject } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { withTenant } from "@/lib/route";
import { readJson, requireUuid } from "@/lib/validation";
import {
  TASK_COLUMNS,
  taskFromRow,
  type BoardTaskRow,
} from "@/lib/workspace-repository";

export const runtime = "nodejs";

type Params = { id: string };

export const PATCH = withTenant<Params>(async ({ tenant, request, params }) => {
  const id = requireUuid(params.id, "Task id");
  const body = await readJson(request);
  if (
    body.title !== undefined &&
    (typeof body.title !== "string" || !body.title.trim())
  ) {
    throw new ValidationError("Task title is required");
  }

  const current = await query<BoardTaskRow>(
    `select ${TASK_COLUMNS} from board_tasks where id = $1 and organization_id = $2`,
    [id, tenant.organization.id],
  );
  if (!current.rows[0]) throw new NotFoundError("Task not found");
  const existing = current.rows[0];
  await requireProject(
    tenant.organization.id,
    body.projectId === undefined
      ? existing.project_id
      : requireUuid(body.projectId, "Project"),
  );
  if (body.projectId !== undefined && body.projectId !== existing.project_id) {
    const linked = await query(
      "select id from time_entries where task_id=$1 and organization_id=$2 limit 1",
      [id, tenant.organization.id],
    );
    if (linked.rows.length)
      throw new ConflictError(
        "Tasks with linked time entries cannot move to another project",
      );
  }
  const before = taskFromRow(existing);

  const result = await query<BoardTaskRow>(
    `update board_tasks
     set project_id = $2, title = $3, status = $4, estimate_hours = $5, updated_at = now()
     where id = $1 and organization_id = $6
     returning ${TASK_COLUMNS}`,
    [
      id,
      body.projectId ?? existing.project_id,
      typeof body.title === "string" && body.title.trim()
        ? optString(body.title, "Title", 200)
        : existing.title,
      ["Backlog", "Today", "Doing", "Done"].includes(String(body.status))
        ? body.status
        : existing.status,
      body.estimateHours === undefined
        ? existing.estimate_hours
        : optNumber(body.estimateHours, "Estimate", 0, 9999.99),
      tenant.organization.id,
    ],
  );

  const updated = taskFromRow(result.rows[0]);
  if (before.status !== updated.status) {
    await recordAudit({
      tenant,
      request,
      action: "update",
      entityType: "board_task",
      entityId: updated.id,
      summary: `Moved task ${updated.title} → ${updated.status}`,
      before,
      after: updated,
    });
  } else {
    await recordAudit({
      tenant,
      request,
      action: "update",
      entityType: "board_task",
      entityId: updated.id,
      summary: `Updated task ${updated.title}`,
      before,
      after: updated,
    });
  }
  return updated;
});

export const DELETE = withTenant<Params>(
  async ({ tenant, request, params }) => {
    const id = requireUuid(params.id, "Task id");
    const result = await query<BoardTaskRow>(
      `delete from board_tasks where id = $1 and organization_id = $2 returning ${TASK_COLUMNS}`,
      [id, tenant.organization.id],
    );
    if (!result.rows[0]) throw new NotFoundError("Task not found");
    const removed = taskFromRow(result.rows[0]);
    await recordAudit({
      tenant,
      request,
      action: "delete",
      entityType: "board_task",
      entityId: removed.id,
      summary: `Deleted task ${removed.title}`,
      before: removed,
    });
    return { ok: true };
  },
);
