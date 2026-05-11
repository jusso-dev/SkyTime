import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { pool } from "@/lib/db";

export const auth = betterAuth({
  appName: "SkyTime",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: [
    "http://localhost:3000",
    "http://localhost:3001",
    ...(process.env.NEXT_PUBLIC_APP_URL ? [process.env.NEXT_PUBLIC_APP_URL] : []),
  ],
  secret: process.env.BETTER_AUTH_SECRET ?? "skytime-local-development-secret-change-before-production",
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
