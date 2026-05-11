import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";

export type Tenant = {
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

export async function getSessionUser(request: Request) {
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
      error: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
      user: null,
    };
  }

  return { user, error: null };
}

export async function requireTenant(request: Request) {
  const { user, error } = await requireUser(request);
  if (error || !user) return { tenant: null, error };

  const membership = await query<{ id: string; name: string; role: "admin" | "member" }>(
    `select o.id, o.name, m.role
     from organization_memberships m
     join organizations o on o.id = m.organization_id
     where m.user_id = $1
     order by m.created_at asc
     limit 1`,
    [user.id],
  );

  if (!membership.rows[0]) {
    return {
      tenant: null,
      error: NextResponse.json({ error: "Organization required", needsOrganization: true, user }, { status: 409 }),
    };
  }

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
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  return null;
}
