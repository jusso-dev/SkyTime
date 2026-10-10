import { expect, request as requestFactory, test, type Page } from "@playwright/test";
import { seedCredential, TEST_PASSWORD } from "./credentials";

// Same host as BETTER_AUTH_URL so the WebAuthn rpID is localhost, not an IP.
const baseURL = "http://localhost:3100";

async function enableVirtualAuthenticator(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test("signed-in user registers a passkey and signs back in with it", async ({
  browser,
}) => {
  const anonymous = await requestFactory.newContext({ baseURL });
  const blocked = await anonymous.get(
    "/api/auth/passkey/generate-register-options",
  );
  expect(blocked.status(), await blocked.text()).toBe(401);
  await anonymous.dispose();

  const api = await requestFactory.newContext({ baseURL });
  const email = `passkey-${Date.now()}@example.com`;
  await seedCredential({ name: "Passkey User", email, password: TEST_PASSWORD });
  const signIn = await api.post("/api/auth/sign-in/email", {
    data: { email, password: TEST_PASSWORD },
  });
  expect(signIn.ok(), await signIn.text()).toBeTruthy();
  const organization = await api.post("/api/organizations", {
    data: { name: "Passkey Org" },
  });
  expect(organization.ok(), await organization.text()).toBeTruthy();

  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  await enableVirtualAuthenticator(page);
  await page.goto(baseURL);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Passkeys" })).toBeVisible();
  await page.getByRole("button", { name: "Add passkey" }).click();
  await expect(page.getByText("This device", { exact: true })).toBeVisible();
  await expect(page.getByText("Passkey added")).toBeVisible();

  await context.clearCookies();
  await page.goto(baseURL);
  await expect(page.getByRole("button", { name: "Use a passkey" })).toBeVisible();
  await page.getByRole("button", { name: "Use a passkey" }).click();
  await expect(
    page.getByRole("heading", { name: "Track time without losing the workday." }),
  ).toBeVisible();

  await context.close();
  await api.dispose();
});
