import { recordAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { withTenant } from "@/lib/route";
import { optNumber, readJson, requireString, requireUuid } from "@/lib/validation";
import { listTasks, TASK_COLUMNS, taskFromRow, type BoardTaskRow } from "@/lib/workspace-repository";

export const runtime = "nodejs";

export const GET = withTenant(async ({ tenant }) => {
  return listTasks(tenant.organization.id);
});

export const POST = withTenant(async ({ tenant, request }) => {
  const body = await readJson(request);
  const projectId = requireUuid(body.projectId, "Project");
  const title = requireString(body.title, "Task title", 200);
  const estimate = optNumber(body.estimateHours, "Estimate", 0) ?? 1;
  const status = ["Backlog", "Today", "Doing", "Done"].includes(String(body.status))
    ? String(body.status)
    : "Backlog";

  const result = await query<BoardTaskRow>(
    `insert into board_tasks (organization_id, project_id, title, status, estimate_hours)
     values ($1, $2, $3, $4, $5)
     returning ${TASK_COLUMNS}`,
    [tenant.organization.id, projectId, title, status, estimate],
  );

  const task = taskFromRow(result.rows[0]);
  await recordAudit({
    tenant,
    request,
    action: "create",
    entityType: "board_task",
    entityId: task.id,
    summary: `Created task ${task.title}`,
    after: task,
  });
  return new Response(JSON.stringify(task), { status: 201, headers: { "content-type": "application/json" } });
});
