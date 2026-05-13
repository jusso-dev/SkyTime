import { NextResponse } from "next/server";
import { captureError, errorResponse, HttpError } from "@/lib/errors";
import { requireAdmin, requireTenant, requireUser, type Tenant } from "@/lib/tenant";

type RouteHandler<TParams, TResult> = (ctx: {
  request: Request;
  params: TParams;
}) => Promise<TResult>;

type TenantHandler<TParams, TResult> = (ctx: {
  request: Request;
  params: TParams;
  tenant: Tenant;
}) => Promise<TResult>;

type UserHandler<TParams, TResult> = (ctx: {
  request: Request;
  params: TParams;
  user: { id: string; email: string; name?: string; twoFactorEnabled: boolean };
}) => Promise<TResult>;

type RouteContext<TParams> = { params: Promise<TParams> } | undefined;

function toResponse<T>(result: T) {
  if (result instanceof NextResponse || result instanceof Response) return result;
  return NextResponse.json(result);
}

async function resolveParams<TParams>(context: RouteContext<TParams>): Promise<TParams> {
  if (!context) return {} as TParams;
  return (await context.params) ?? ({} as TParams);
}

export function withRoute<TParams = Record<string, never>, TResult = unknown>(
  handler: RouteHandler<TParams, TResult>,
) {
  return async (request: Request, context?: RouteContext<TParams>) => {
    const params = await resolveParams(context);
    try {
      return toResponse(await handler({ request, params }));
    } catch (error) {
      await captureError(error, {
        request,
        status: error instanceof HttpError ? error.status : 500,
      });
      return errorResponse(error);
    }
  };
}

export function withTenant<TParams = Record<string, never>, TResult = unknown>(
  handler: TenantHandler<TParams, TResult>,
  options: { admin?: boolean } = {},
) {
  return async (request: Request, context?: RouteContext<TParams>) => {
    const params = await resolveParams(context);
    try {
      const { tenant, error } = await requireTenant(request);
      if (error || !tenant) return error;
      if (options.admin) {
        const adminError = requireAdmin(tenant);
        if (adminError) return adminError;
      }
      return toResponse(await handler({ request, params, tenant }));
    } catch (error) {
      await captureError(error, {
        request,
        status: error instanceof HttpError ? error.status : 500,
      });
      return errorResponse(error);
    }
  };
}

export function withUser<TParams = Record<string, never>, TResult = unknown>(
  handler: UserHandler<TParams, TResult>,
) {
  return async (request: Request, context?: RouteContext<TParams>) => {
    const params = await resolveParams(context);
    try {
      const { user, error } = await requireUser(request);
      if (error || !user) return error;
      return toResponse(await handler({ request, params, user }));
    } catch (error) {
      await captureError(error, {
        request,
        status: error instanceof HttpError ? error.status : 500,
      });
      return errorResponse(error);
    }
  };
}
