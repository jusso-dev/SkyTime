export const requestContext = new WeakMap<
  Request,
  { organizationId: string; userId: string }
>();
