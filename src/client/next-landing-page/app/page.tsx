import { SkyTimeWorkspace } from "@/components/skytime-workspace";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { getWorkspace } from "@/lib/workspace-repository";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return <SkyTimeWorkspace initialState={{ kind: "signed-out" }} />;
  }

  const membership = await query<{ id: string; name: string; role: "admin" | "member" }>(
    `select o.id, o.name, m.role
     from organization_memberships m
     join organizations o on o.id = m.organization_id
     where m.user_id = $1
     order by m.created_at asc
     limit 1`,
    [session.user.id],
  );

  const organization = membership.rows[0];
  const sessionUser = session.user as typeof session.user & { twoFactorEnabled?: boolean };
  const user = {
    id: sessionUser.id,
    email: sessionUser.email,
    name: sessionUser.name,
    twoFactorEnabled: sessionUser.twoFactorEnabled ?? false,
  };

  if (!organization) {
    return <SkyTimeWorkspace initialState={{ kind: "needs-org", user }} />;
  }

  const workspace = await getWorkspace(organization.id, user.id, user.email);

  return (
    <SkyTimeWorkspace
      initialState={{
        kind: "workspace",
        data: {
          user,
          organization,
          ...workspace,
        },
      }}
    />
  );
}
