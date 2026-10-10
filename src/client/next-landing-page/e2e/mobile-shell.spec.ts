import { expect, request as requestFactory, test } from "@playwright/test";
import { seedCredential, TEST_PASSWORD } from "./credentials";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const widths = [320, 375, 414, 768];

async function noHorizontalOverflow(page: import("@playwright/test").Page) {
  const spill = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement).overflowX;
    const body = getComputedStyle(document.body).overflowX;
    return {
      root,
      body,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  expect(spill.root).toBe("clip");
  expect(spill.body).toBe("clip");
  expect(spill.overflow).toBe(false);
}

test("mobile shell stays on one screen width", async ({ browser }) => {
  const signedOut = await browser.newContext();
  const page = await signedOut.newPage();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(baseURL);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await noHorizontalOverflow(page);
  }
  await signedOut.close();

  const api = await requestFactory.newContext({ baseURL });
  const email = `mobile-shell-${Date.now()}@example.com`;
  await seedCredential({ name: "Mobile Admin", email });
  const signIn = await api.post("/api/auth/sign-in/email", {
    data: { email, password: TEST_PASSWORD },
  });
  expect(signIn.ok(), await signIn.text()).toBeTruthy();
  const organization = await api.post("/api/organizations", {
    data: { name: "Mobile Studio" },
  });
  expect(organization.ok(), await organization.text()).toBeTruthy();

  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1280, height: 900 },
  });
  const app = await context.newPage();
  await app.goto(baseURL);
  await expect(app.getByTestId("desktop-nav")).toBeVisible();
  await expect(app.getByTestId("mobile-nav")).toBeHidden();
  await expect(
    app.getByTestId("desktop-nav").getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  await noHorizontalOverflow(app);

  for (const width of widths) {
    await app.setViewportSize({ width, height: 800 });
    await expect(app.getByTestId("mobile-nav")).toBeVisible();
    await expect(app.getByTestId("desktop-nav")).toBeHidden();
    await expect(app.getByRole("button", { name: "Home" })).toHaveCount(0);
    await expect(app.getByRole("button", { name: "Dashboard", exact: true })).toBeVisible();
    await noHorizontalOverflow(app);
  }

  await app.setViewportSize({ width: 390, height: 844 });
  await app.getByRole("button", { name: "More sections" }).click();
  await app
    .getByRole("navigation", { name: "More sections" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(app.getByRole("heading", { name: "PDF reports" })).toBeVisible();
  await noHorizontalOverflow(app);

  await app.getByLabel("Workspace section").selectOption("timesheets");
  await expect(app.getByRole("button", { name: "CSV" })).toBeVisible();
  await noHorizontalOverflow(app);

  await app.getByLabel("Workspace section").selectOption("dashboard");
  await expect(
    app.getByRole("heading", { name: "Track time without losing the workday." }),
  ).toBeVisible();
  const clearance = await app.evaluate(() => {
    const nav = document.querySelector("[data-testid=mobile-nav]");
    const content = document.querySelector("main > div");
    if (!nav || !content) return 0;
    const navHeight = nav.getBoundingClientRect().height;
    const pad = Number.parseFloat(getComputedStyle(content).paddingBottom);
    return pad - navHeight;
  });
  expect(clearance).toBeGreaterThanOrEqual(-1);

  await context.close();
  await api.dispose();
});
