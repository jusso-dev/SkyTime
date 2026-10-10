import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { authDatabase } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";

const secret =
  process.env.BETTER_AUTH_SECRET ??
  (process.env.NODE_ENV === "production"
    ? undefined
    : "skytime-local-development-secret-change-before-production");
if (!secret)
  throw new Error(
    "BETTER_AUTH_SECRET must be configured for production builds and runtime",
  );

type AuthDatabase = ReturnType<typeof authDatabase>;

export function authOptions(database: AuthDatabase) {
  return {
    appName: "SkyTime",
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    trustedOrigins: [
      "http://localhost:3000",
      "http://localhost:3001",
      ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
      ...(process.env.NEXT_PUBLIC_APP_URL ? [process.env.NEXT_PUBLIC_APP_URL] : []),
    ],
    secret,
    database,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      sendResetPassword: async ({
        user,
        url,
      }: {
        user: { email: string };
        url: string;
      }) => {
        const result = await sendPasswordResetEmail({ email: user.email, url });
        if (!result.sent) throw new Error(result.reason);
      },
    },
    plugins: [
      twoFactor({
        issuer: "SkyTime",
        trustDeviceMaxAge: 60 * 60 * 24 * 30,
      }),
      // Registration stays session-only, so a passkey cannot create an account.
      passkey({
        rpName: "SkyTime",
      }),
    ],
  };
}

function createAuth() {
  return betterAuth(authOptions(authDatabase()));
}

type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

function currentAuth() {
  instance ??= createAuth();
  return instance;
}

export const auth: Auth = new Proxy({} as Auth, {
  get(_target, prop) {
    const target = currentAuth();
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
  // The auth CLI uses Object.keys. better-auth's Next handler uses `in`.
  has(_target, prop) {
    return Reflect.has(currentAuth(), prop);
  },
  ownKeys() {
    return Reflect.ownKeys(currentAuth());
  },
  getOwnPropertyDescriptor(_target, prop) {
    const target = currentAuth();
    const value = Reflect.get(target, prop, target);
    return {
      configurable: true,
      enumerable: true,
      value: typeof value === "function" ? value.bind(target) : value,
    };
  },
});
