import {
  actions,
  executeAction,
  actionCatalog,
} from "@/lib/automation/actions";
import { requireTenant } from "@/lib/tenant";
import { withRoute } from "@/lib/route";
import { readJson } from "@/lib/validation";
import { z } from "zod";
export const runtime = "nodejs";
const handler = withRoute<{ path: string[] }>(async ({ request, params }) => {
  const { tenant, error } = await requireTenant(request);
  if (error || !tenant) return error;
  const path = params.path.join("/");
  if (request.method === "GET" && path === "actions") return actionCatalog();
  if (request.method === "GET" && path === "openapi.json") {
    const paths: Record<string, Record<string, unknown>> = {};
    for (const a of actions) {
      const p = "/api/v1/" + a.path.replace(/:([^/]+)/g, "{$1}");
      const schema = z.toJSONSchema(a.schema);
      const { id, ...properties } = schema.properties ?? {};
      const required = (schema.required ?? []).filter(
        (key: string) => key !== "id",
      );
      paths[p] ??= {};
      paths[p][a.method.toLowerCase()] = {
        operationId: a.name,
        description: a.description,
        security: [{ bearerAuth: [] }],
        parameters: [
          ...(a.path.includes(":id")
            ? [{ name: "id", in: "path", required: true, schema: id }]
            : []),
          ...(a.method === "GET"
            ? Object.entries(properties).map(([name, schema]) => ({
                name,
                in: "query",
                required: required.includes(name),
                schema,
              }))
            : []),
        ],
        ...(a.method === "GET"
          ? {}
          : {
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: { type: "object", properties, required },
                  },
                },
              },
            }),
        responses: {
          200: { description: "Success" },
          400: { description: "Invalid input" },
          401: { description: "Authentication required" },
          403: { description: "Insufficient permission" },
          409: { description: "Conflict or locked record" },
        },
      };
    }
    return {
      openapi: "3.1.0",
      info: { title: "SkyTime API", version: "1.0.0" },
      paths,
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      },
    };
  }
  for (const action of actions) {
    if (action.method !== request.method) continue;
    const keys: string[] = [];
    const pattern = action.path.replace(/:([^/]+)/g, (_, key) => {
      keys.push(key);
      return "([^/]+)";
    });
    const match = path.match(new RegExp("^" + pattern + "$"));
    if (!match) continue;
    const body =
      request.method === "GET"
        ? Object.fromEntries(new URL(request.url).searchParams)
        : request.method === "DELETE"
          ? {}
          : await readJson(request);
    for (const [key, value] of Object.entries(body)) {
      if (request.method === "GET") {
        const property = z.toJSONSchema(action.schema).properties?.[key] as
          { type?: string } | undefined;
        if (
          property?.type === "boolean" &&
          (value === "true" || value === "false")
        )
          body[key] = value === "true";
        if (property?.type === "number" || property?.type === "integer")
          body[key] = Number(value);
      }
    }
    keys.forEach((key, i) => (body[key] = match[i + 1]));
    const result = await executeAction(action, { request, tenant }, body);
    return result instanceof Response
      ? result
      : Response.json(result, {
          headers: { "cache-control": "private, no-store" },
        });
  }
  return Response.json(
    { error: "Unknown endpoint or method" },
    { status: 404 },
  );
});
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
