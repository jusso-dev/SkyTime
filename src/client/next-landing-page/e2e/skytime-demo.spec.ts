import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const screenshotDir = path.resolve(process.cwd(), "../../..", "docs/screenshots");

const views = [
  { id: "dashboard", label: "Dashboard" },
  { id: "projects", label: "Projects" },
  { id: "board", label: "Board" },
  { id: "timesheets", label: "Timesheets" },
  { id: "settings", label: "Settings" },
] as const;

const projects = [
  { name: "NAILSMA Discovery", client: "Indigi Managed", rate: "145" },
  { name: "Civic Cloud Portal", client: "Bluegum Council", rate: "165" },
  { name: "Internal Operations", client: "SkyTime Labs", rate: "0" },
];

test.describe("SkyTime demo screenshots", () => {
  test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
  });

  test("captures desktop light and dark demo screenshots", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await seedWorkspace(page, "desktop");
    await captureViews(page, "desktop", "light");
    await toggleTheme(page, "dark");
    await captureViews(page, "desktop", "dark");
  });

  test("captures mobile light and dark demo screenshots", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedWorkspace(page, "mobile");
    await captureViews(page, "mobile", "light");
    await toggleTheme(page, "dark");
    await captureViews(page, "mobile", "dark");
  });
});

async function seedWorkspace(page: Page, label: string) {
  const runId = `${label}-${Date.now()}`;
  const email = `demo-${runId}@example.com`;

  await page.goto("/");
  await page.getByRole("button", { name: "Create account" }).first().click();
  await page.getByLabel("Name").fill("Justin Demo");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Password123!");
  await page.getByLabel("Confirm password").fill("Password123!");
  await page.getByRole("button", { name: "Create account" }).last().click();

  await page.getByLabel("Organization name").fill(`SkyTime Demo ${label}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByText("Track time without losing the workday.")).toBeVisible();

  await switchView(page, "Projects");
  for (const project of projects) {
    await page.getByLabel("Project name").fill(project.name);
    await page.getByLabel("Client").fill(project.client);
    await page.getByLabel("Hourly rate").fill(project.rate);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByText(project.name).first()).toBeVisible();
  }

  const workspace = await (await page.request.get("/api/workspace")).json();
  const projectId = (name: string) => workspace.projects.find((project: { name: string }) => project.name === name)?.id;
  const discoveryId = projectId("NAILSMA Discovery");
  const portalId = projectId("Civic Cloud Portal");
  const opsId = projectId("Internal Operations");
  if (!discoveryId || !portalId || !opsId) throw new Error("Demo project seeding failed");

  const today = new Date();
  const isoAt = (daysAgo: number, hour: number) => {
    const date = new Date(today);
    date.setDate(today.getDate() - daysAgo);
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };

  const entries = [
    {
      projectId: discoveryId,
      task: "Firestore configuration",
      notes: "Created Firebase project config, auth settings, and Firestore collections for the field counter workflow.",
      startedAt: isoAt(0, 9),
      durationMs: 2 * 60 * 60 * 1000,
      billable: true,
    },
    {
      projectId: discoveryId,
      task: "Stakeholder report",
      notes: "Prepared project time notes and reconciled billable tasks for May reporting.",
      startedAt: isoAt(0, 13),
      durationMs: 90 * 60 * 1000,
      billable: true,
    },
    {
      projectId: portalId,
      task: "Timesheet export QA",
      notes: "Validated CSV and PDF export formatting, totals, and GST calculations.",
      startedAt: isoAt(1, 10),
      durationMs: 2.5 * 60 * 60 * 1000,
      billable: true,
    },
    {
      projectId: opsId,
      task: "Weekly planning",
      notes: "Reviewed board priorities and reminder cadence for the internal workspace.",
      startedAt: isoAt(2, 11),
      durationMs: 45 * 60 * 1000,
      billable: false,
    },
  ];

  for (const entry of entries) {
    await page.request.post("/api/time-entries", { data: entry });
  }

  const tasks = [
    { projectId: discoveryId, title: "Prepare Firebase security rules", status: "Doing", estimateHours: 3 },
    { projectId: discoveryId, title: "Review client export wording", status: "Today", estimateHours: 1.5 },
    { projectId: portalId, title: "Polish PDF report header", status: "Done", estimateHours: 2 },
    { projectId: opsId, title: "Invite finance reviewer", status: "Backlog", estimateHours: 1 },
  ];

  for (const task of tasks) {
    await page.request.post("/api/tasks", { data: task });
  }

  await page.reload();
  await hideDevTools(page);
  await expect(page.getByText("Track time without losing the workday.")).toBeVisible();
}

async function captureViews(page: Page, device: "desktop" | "mobile", theme: "light" | "dark") {
  for (const view of views) {
    await hideDevTools(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await switchView(page, view.label);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(screenshotDir, `skytime-${device}-${theme}-${view.id}.png`),
      fullPage: device === "desktop",
    });
  }
}

async function hideDevTools(page: Page) {
  await page.addStyleTag({
    content: `
      [aria-label*="Next.js Dev Tools"],
      [data-nextjs-dev-tools-button],
      [data-nextjs-dev-tools-menu],
      nextjs-portal {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `,
  });
}

async function switchView(page: Page, label: string) {
  const width = page.viewportSize()?.width ?? 1440;
  const nav = page.getByTestId(width < 1024 ? "mobile-nav" : "desktop-nav");
  await nav.getByRole("button", { name: label, exact: true }).evaluate((button) => (button as HTMLButtonElement).click());
  if (label === "Dashboard") await expect(page.getByText("Current timer")).toBeVisible();
  if (label === "Projects") await expect(page.getByRole("heading", { name: "Create project" })).toBeVisible();
  if (label === "Board") await expect(page.getByRole("heading", { name: "Task board" })).toBeVisible();
  if (label === "Timesheets") await expect(page.getByRole("heading", { name: "Timesheets" })).toBeVisible();
  if (label === "Settings") await expect(page.getByRole("heading", { name: "Multi-factor authentication" })).toBeVisible();
}

async function toggleTheme(page: Page, nextTheme: "light" | "dark") {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(`button[aria-label="Switch to ${nextTheme} mode"]:visible`).first().click({ force: true });
  await expect(page.locator("html")).toHaveAttribute("data-theme", nextTheme);
}
