import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { pool } from "@/lib/db";

const secret =
  process.env.BETTER_AUTH_SECRET ??
  (process.env.NODE_ENV === "production"
    ? undefined
    : "skytime-local-development-secret-change-before-production");
if (!secret)
  throw new Error(
    "BETTER_AUTH_SECRET must be configured for production builds and runtime",
  );

export const auth = betterAuth({
  appName: "SkyTime",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: [
    "http://localhost:3000",
    "http://localhost:3001",
    ...(process.env.NEXT_PUBLIC_APP_URL
      ? [process.env.NEXT_PUBLIC_APP_URL]
      : []),
  ],
  secret,
  database: pool,
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    twoFactor({
      issuer: "SkyTime",
      trustDeviceMaxAge: 60 * 60 * 24 * 30,
    }),
  ],
});
