import { requestContext } from "@/lib/request-context";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensureReady, query } from "@/lib/db";

export type Tenant = {
  tokenScope?: "read" | "write";
  user: {
    id: string;
    email: string;
    name?: string;
    twoFactorEnabled: boolean;
  };
  organization: {
    id: string;
    name: string;
    role: "admin" | "member";
  };
};

// Internal requests may reuse authentication already resolved at the API/MCP
// boundary. This cannot be supplied by an HTTP header or another request.
const resolvedTenants = new WeakMap<Request, Tenant>();

export async function withResolvedTenant<T>(
  request: Request,
  tenant: Tenant,
  work: () => Promise<T>,
): Promise<T> {
  resolvedTenants.set(request, tenant);
  requestContext.set(request, {
    organizationId: tenant.organization.id,
    userId: tenant.user.id,
  });
  try {
    return await work();
  } finally {
    resolvedTenants.delete(request);
  }
}

export async function getSessionUser(request: Request) {
  await ensureReady();
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  const sessionUser = session?.user as
    | {
        id: string;
        email: string;
        name?: string;
        twoFactorEnabled?: boolean;
      }
    | undefined;

  return sessionUser
    ? {
        id: sessionUser.id,
        email: sessionUser.email,
        name: sessionUser.name,
        twoFactorEnabled: sessionUser.twoFactorEnabled ?? false,
      }
    : null;
}

export async function requireUser(request: Request) {
  const user = await getSessionUser(request);
  if (!user) {
    return {
      error: NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      ),
      user: null,
    };
  }

  return { user, error: null };
}

export async function requireTenant(request: Request) {
  const resolved = resolvedTenants.get(request);
  if (resolved) return { tenant: resolved, error: null };
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const token = authorization.match(/^Bearer (st_[A-Za-z0-9_-]+)$/)?.[1];
    const result = token
      ? await query<{
          id: string;
          email: string;
          name: string;
          organization_id: string;
          organization_name: string;
          role: "admin" | "member";
          scope: "read" | "write";
          token_id: string;
        }>(
          `select u.id,u.email,u.name,o.id as organization_id,o.name as organization_name,m.role,t.scope,t.id as token_id
       from api_tokens t
       join organization_memberships m on m.organization_id=t.organization_id and m.user_id=t.user_id
       join organizations o on o.id=m.organization_id
       join "user" u on u.id=t.user_id
       where t.token_hash=$1 and t.revoked_at is null and t.expires_at > now()`,
          [createHash("sha256").update(token).digest("hex")],
        )
      : null;
    const row = result?.rows[0];
    if (row) {
      await query("update api_tokens set last_used_at=now() where id=$1", [row.token_id]);
    }
    if (!row)
      return {
        tenant: null,
        error: NextResponse.json(
          { error: "Invalid or expired API token" },
          { status: 401 },
        ),
      };
    requestContext.set(request, {
      organizationId: row.organization_id,
      userId: row.id,
    });
    return {
      tenant: {
        user: {
          id: row.id,
          email: row.email,
          name: row.name,
          twoFactorEnabled: false,
        },
        organization: {
          id: row.organization_id,
          name: row.organization_name,
          role: row.role,
        },
        tokenScope: row.scope,
      } satisfies Tenant,
      error: null,
    };
  }
  const { user, error } = await requireUser(request);
  if (error || !user) return { tenant: null, error };

  const membership = await query<{
    id: string;
    name: string;
    role: "admin" | "member";
  }>(
    `select o.id, o.name, m.role
     from organization_memberships m
     join organizations o on o.id = m.organization_id
     where m.user_id = $1 and ($2::text is null or o.id::text = $2)
     order by m.created_at asc
     limit 1`,
    [user.id, request.headers.get("x-organization-id")],
  );

  if (!membership.rows[0]) {
    return {
      tenant: null,
      error: NextResponse.json(
        { error: "Organization required", needsOrganization: true, user },
        { status: 409 },
      ),
    };
  }

  requestContext.set(request, {
    organizationId: membership.rows[0].id,
    userId: user.id,
  });
  return {
    tenant: {
      user,
      organization: membership.rows[0],
    } satisfies Tenant,
    error: null,
  };
}

export function requireAdmin(tenant: Tenant) {
  if (tenant.organization.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  }

  return null;
}
