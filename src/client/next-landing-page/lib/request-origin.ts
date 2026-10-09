/** Match the configured public origin because reverse proxies/Next may rewrite request.url. */
export function isTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const publicUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    request.url;
  try {
    return origin === new URL(publicUrl).origin;
  } catch {
    return false;
  }
}
