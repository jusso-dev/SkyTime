import { isTrustedOrigin } from "@/lib/request-origin";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  actions,
  actionCatalog,
  executeAction,
} from "@/lib/automation/actions";
import { requireTenant } from "@/lib/tenant";
import { withRoute } from "@/lib/route";
import { captureError, errorResponse, HttpError } from "@/lib/errors";
export const runtime = "nodejs";
export const POST = withRoute(async ({ request }) => {
  const origin = request.headers.get("origin");
  if (origin && !isTrustedOrigin(request))
    return Response.json(
      { error: "Cross-origin MCP requests are not allowed" },
      { status: 403 },
    );
  const { tenant, error } = await requireTenant(request);
  if (error || !tenant) return error;
  const server = new McpServer(
    { name: "skytime", version: "1.0.0" },
    {
      instructions:
        "SkyTime controls time, projects, clients, tasks, approvals, reporting and billing. Read before making changes. Use timer_get before starting or stopping. Money is grouped by currency. Approval weeks use UTC; reports use their selected timezone. Invoices reserve unbilled items. Mutations follow the authenticated member role and API token scope.",
    },
  );
  for (const action of actions) {
    server.registerTool(
      action.name,
      {
        description: action.description,
        inputSchema: action.schema,
        annotations: {
          readOnlyHint: action.method === "GET",
          destructiveHint: action.destructive ?? false,
          idempotentHint: action.method === "GET" || action.method === "DELETE",
          openWorldHint: action.name === "invitations_create",
        },
      },
      async (input) => {
        try {
          const result = await executeAction(
            action,
            { request, tenant },
            input,
          );
          if (result instanceof Response) {
            const mimeType =
              result.headers.get("content-type")?.split(";")[0] ??
              "application/octet-stream";
            const blob = Buffer.from(await result.arrayBuffer()).toString(
              "base64",
            );
            return {
              content: [
                {
                  type: "resource" as const,
                  resource: {
                    uri: `skytime://exports/${action.name}/${Date.now()}`,
                    mimeType,
                    blob,
                  },
                },
              ],
            };
          }
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: { result },
          };
        } catch (error) {
          const response = errorResponse(error);
          await captureError(error, {
            request,
            organizationId: tenant.organization.id,
            userId: tenant.user.id,
            status: response.status,
          });
          const failure = await response.json();
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: failure.error,
              },
            ],
          };
        }
      },
    );
  }
  server.registerResource(
    "action_catalog",
    "skytime://actions",
    {
      description: "All SkyTime actions and their API paths",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(actionCatalog()),
        },
      ],
    }),
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
});
export const GET = () =>
  new Response(null, { status: 405, headers: { Allow: "POST" } });
export const DELETE = GET;
