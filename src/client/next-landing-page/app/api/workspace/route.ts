import { NextResponse } from "next/server";
import { serverError } from "@/lib/api-response";
import { getWorkspace } from "@/lib/workspace-repository";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { tenant, error } = await requireTenant(request);
    if (error || !tenant) return error;

    const workspace = await getWorkspace(tenant.organization.id);
    return NextResponse.json({
      user: tenant.user,
      organization: tenant.organization,
      ...workspace,
    });
  } catch (error) {
    return serverError(error);
  }
}
