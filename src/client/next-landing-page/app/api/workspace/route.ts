import { getWorkspace } from "@/lib/workspace-repository";
import { withTenant } from "@/lib/route";

export const runtime = "nodejs";

export const GET = withTenant(async ({ tenant }) => {
  const workspace = await getWorkspace(tenant.organization.id, tenant.user.id, tenant.user.email);
  return {
    user: tenant.user,
    organization: tenant.organization,
    ...workspace,
  };
});
