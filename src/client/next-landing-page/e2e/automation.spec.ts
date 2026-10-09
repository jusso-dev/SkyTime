import {
  test,
  expect,
  request as requestFactory,
  type APIRequestContext,
} from "@playwright/test";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Pool } from "pg";
import fs from "node:fs/promises";
import path from "node:path";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
let admin: APIRequestContext,
  other: APIRequestContext,
  member: APIRequestContext;
let projectId: string,
  clientId: string,
  otherProjectId: string,
  token: string,
  readToken: string;
const db = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://skytime:skytime@localhost:55432/skytime",
});
async function json(r: Awaited<ReturnType<APIRequestContext["get"]>>) {
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function account(name: string) {
  const api = await requestFactory.newContext({ baseURL });
  await json(
    await api.post("/api/auth/sign-up/email", {
      data: {
        name,
        email: `${name}-${Date.now()}@example.com`,
        password: "A-strong-test-password-123!",
      },
    }),
  );
  await json(
    await api.post("/api/organizations", { data: { name: `${name} Studio` } }),
  );
  return api;
}
const entry = (overrides: Record<string, unknown> = {}) => ({
  projectId,
  task: "Service design",
  notes: "Research findings and delivery notes.",
  startedAt: "2026-09-07T11:00:00+10:00",
  durationMs: 3600000,
  billable: true,
  tags: ["Design"],
  ...overrides,
});
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Set DATABASE_URL to a dedicated migrated test database before running integration tests.",
    );
  admin = await account("Harbour");
  other = await account("Wattle");
  member = await account("Member");
  const aw = await json(await admin.get("/api/workspace"));
  const mw = await json(await member.get("/api/workspace"));
  await db.query(
    "update organization_memberships set organization_id=$1,role='member' where user_id=$2",
    [aw.organization.id, mw.user.id],
  );
  const client = await json(
    await admin.post("/api/v1/clients", {
      data: {
        name: "North Coast Studio",
        contactName: "Amelia Clarke",
        contactEmail: "amelia@example.com",
        address: "18 Harbour Road, Sydney NSW 2000",
        currency: "AUD",
        defaultRate: 150,
      },
    }),
  );
  clientId = client.id;
  const project = await json(
    await admin.post("/api/v1/projects", {
      data: {
        name: "Coastal service redesign",
        clientId,
        rate: 150,
        costRate: 65,
        budgetHours: 40,
        budgetAmount: 6000,
      },
    }),
  );
  projectId = project.id;
  otherProjectId = (
    await json(
      await other.post("/api/v1/projects", {
        data: { name: "Private project" },
      }),
    )
  ).id;
  token = (
    await json(
      await admin.post("/api/v1/tokens", {
        data: { name: "MCP integration", scope: "write", expiresInDays: 1 },
      }),
    )
  ).token;
  readToken = (
    await json(
      await admin.post("/api/v1/tokens", {
        data: { name: "Reporting only", scope: "read", expiresInDays: 1 },
      }),
    )
  ).token;
});
test.afterAll(async () => {
  await Promise.all([
    admin?.dispose(),
    other?.dispose(),
    member?.dispose(),
    db.end(),
  ]);
});
test("tenant boundaries, credential scopes and schema validation", async () => {
  expect(
    (
      await admin.post("/api/v1/time-entries", {
        data: entry({ projectId: otherProjectId }),
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await admin.post("/api/time-entries", {
        data: entry({ projectId: otherProjectId }),
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await admin.post("/api/v1/tasks", {
        data: { projectId: otherProjectId, title: "Not allowed" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await admin.post("/api/v1/time-entries", {
        data: entry({ durationMs: -100 }),
      })
    ).status(),
  ).toBe(400);
  expect((await admin.get("/api/v1/reports?from=2026-02-31")).status()).toBe(
    400,
  );
  const read = await requestFactory.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${readToken}` },
  });
  expect((await read.get("/api/v1/projects")).ok()).toBeTruthy();
  expect(
    (
      await read.post("/api/v1/projects", { data: { name: "Cannot write" } })
    ).status(),
  ).toBe(403);
  expect(
    (
      await member.patch("/api/v1/branding", {
        data: { companyName: "Cannot change" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await admin.post("/api/v1/projects", {
        headers: { origin: "https://attacker.example" },
        data: { name: "CSRF" },
      })
    ).status(),
  ).toBe(403);
  await read.dispose();
});
test("concurrent timer start and stop records exactly one entry", async () => {
  const responses = await Promise.all([
    admin.post("/api/v1/timer", {
      data: {
        projectId,
        task: "Concurrent timer",
        startedAt: new Date(Date.now() - 5000).toISOString(),
      },
    }),
    admin.post("/api/v1/timer", {
      data: { projectId, task: "Concurrent timer" },
    }),
  ]);
  expect(responses.map((r) => r.status()).sort()).toEqual([200, 409]);
  const timer = await json(await admin.get("/api/v1/timer"));
  const stops = await Promise.all([
    admin.post("/api/v1/timer/stop", { data: { id: timer.id } }),
    admin.post("/api/v1/timer/stop", { data: { id: timer.id } }),
  ]);
  expect(stops.map((r) => r.status()).sort()).toEqual([200, 404]);
  expect(await json(await admin.get("/api/v1/timer"))).toBeNull();
  const entries = await json(
    await admin.get("/api/v1/time-entries?search=Concurrent"),
  );
  expect(entries).toHaveLength(1);
});
test("rates are captured, imports are atomic, approval and invoice locks hold", async () => {
  const first = await json(
    await admin.post("/api/v1/time-entries", { data: entry() }),
  );
  expect(first.hourlyRate).toBe(150);
  await json(
    await admin.patch("/api/v1/projects/" + projectId, { data: { rate: 175 } }),
  );
  const report = await json(
    await admin.get("/api/v1/reports?from=2026-09-07&to=2026-09-07"),
  );
  expect(report.totals[0].amount).toBe(150);
  const before = (await json(await admin.get("/api/v1/time-entries"))).length;
  expect(
    (
      await admin.post("/api/v1/time-entries/import", {
        data: {
          entries: [
            entry({ task: "Should roll back" }),
            entry({ projectId: otherProjectId }),
          ],
        },
      })
    ).status(),
  ).toBe(409);
  expect((await json(await admin.get("/api/v1/time-entries"))).length).toBe(
    before,
  );
  const period = await json(
    await admin.post("/api/v1/timesheets", { data: { date: "2026-09-07" } }),
  );
  await json(
    await admin.post("/api/v1/timesheets/" + period.id, {
      data: { action: "submit" },
    }),
  );
  await json(
    await admin.post("/api/v1/timesheets/" + period.id, {
      data: { action: "approve" },
    }),
  );
  expect(
    (
      await admin.patch("/api/v1/time-entries/" + first.id, {
        data: { task: "Blocked" },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await admin.patch("/api/v1/time-entries", {
        data: { ids: [first.id], billable: false },
      })
    ).status(),
  ).toBe(409);
  const expense = await json(
    await admin.post("/api/v1/expenses", {
      data: {
        projectId,
        date: "2026-09-07",
        description: "Workshop supplies",
        amount: 28.5,
        currency: "AUD",
      },
    }),
  );
  const invoice = await json(
    await admin.post("/api/v1/invoices", {
      data: {
        clientId,
        number: "INV-1001",
        from: "2026-09-07",
        to: "2026-09-07",
        issuedDate: "2026-09-30",
        dueDate: "2026-10-30",
        taxPercent: 10,
      },
    }),
  );
  expect(Number(invoice.subtotal)).toBe(178.5);
  expect(Number(invoice.total)).toBe(196.35);
  const invoicePdf = await admin.get(`/api/v1/invoices/${invoice.id}/pdf`);
  expect(invoicePdf.ok()).toBeTruthy();
  await fs.mkdir(path.resolve(__dirname, "../../../../docs/reports"), {
    recursive: true,
  });
  await fs.writeFile(
    path.resolve(
      __dirname,
      "../../../../docs/reports/skytime-sample-invoice.pdf",
    ),
    await invoicePdf.body(),
  );
  expect(invoice.branding_snapshot.companyName).toBe("Harbour Studio");
  expect(
    (
      await admin.post("/api/v1/invoices", {
        data: {
          clientId,
          number: "INV-1002",
          from: "2026-09-07",
          to: "2026-09-07",
          issuedDate: "2026-09-30",
          dueDate: "2026-10-30",
          taxPercent: 10,
        },
      })
    ).status(),
  ).toBe(400);
  expect((await admin.delete("/api/v1/expenses/" + expense.id)).status()).toBe(
    409,
  );
  await json(
    await admin.patch("/api/v1/invoices/" + invoice.id, {
      data: { status: "void" },
    }),
  );
  await json(await admin.delete("/api/v1/expenses/" + expense.id));
  await json(
    await admin.post("/api/v1/timesheets/" + period.id, {
      data: { action: "reopen" },
    }),
  );
  await json(
    await admin.patch("/api/v1/time-entries/" + first.id, {
      data: { task: "Updated after reopening" },
    }),
  );
  const audit = await json(await admin.get("/api/v1/audit-log"));
  expect(audit.length).toBeGreaterThan(0);
});
test("capacity accounts for approved leave, templates copy tasks, and last admin is protected", async () => {
  const workspace = await json(await admin.get("/api/workspace"));
  const userId = workspace.user.id;
  await json(
    await admin.patch(`/api/v1/members/${userId}`, {
      data: { weeklyCapacity: 30 },
    }),
  );
  expect(
    (
      await admin.patch(`/api/v1/members/${userId}`, {
        data: { role: "member" },
      })
    ).status(),
  ).toBe(409);
  await json(
    await admin.post("/api/v1/allocations", {
      data: { projectId, userId, date: "2026-11-02", hours: 8 },
    }),
  );
  const leave = await json(
    await admin.post("/api/v1/time-off", {
      data: { from: "2026-11-03", to: "2026-11-03", note: "Annual leave" },
    }),
  );
  expect(
    (
      await admin.post("/api/v1/time-off", {
        data: { from: "2026-11-03", to: "2026-11-04" },
      })
    ).status(),
  ).toBe(409);
  await json(
    await admin.patch(`/api/v1/time-off/${leave.id}`, {
      data: { status: "approved" },
    }),
  );
  const workload = await json(
    await admin.get("/api/v1/workload?from=2026-11-02&to=2026-11-06"),
  );
  expect(workload.find((m: { id: string }) => m.id === userId)).toMatchObject({
    available: 24,
    planned: 8,
    remaining: 16,
    leaveHours: 6,
  });
  const task = await json(
    await admin.post("/api/v1/tasks", {
      data: { projectId, title: "Template task", estimateHours: 3 },
    }),
  );
  const copy = await json(
    await admin.post(`/api/v1/projects/${projectId}/duplicate`, {
      data: { name: "Next project from template" },
    }),
  );
  const tasks = await json(await admin.get("/api/v1/tasks"));
  expect(
    tasks.find(
      (t: { projectId: string; title: string }) =>
        t.projectId === copy.id && t.title === task.title,
    ),
  ).toMatchObject({ estimateHours: 3, status: "Backlog" });
  expect(
    (
      await member.post("/api/v1/allocations", {
        data: { projectId, userId, date: "2026-11-04", hours: 2 },
      })
    ).status(),
  ).toBe(403);
});

test("custom branding, currencies, and credential revocation", async () => {
  expect(
    (
      await admin.patch("/api/v1/branding", {
        data: { logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" },
      })
    ).status(),
  ).toBe(400);

  const { createCanvas } = await import("@napi-rs/canvas");
  const logo = createCanvas(200, 60);
  const drawing = logo.getContext("2d");
  drawing.fillStyle = "#2563eb";
  drawing.fillRect(0, 0, 200, 60);
  drawing.fillStyle = "white";
  drawing.font = "bold 24px sans-serif";
  drawing.fillText("HARBOUR", 12, 40);
  await json(
    await admin.patch("/api/v1/branding", {
      data: { logoDataUrl: logo.toDataURL("image/png") },
    }),
  );
  expect(
    (await admin.get("/api/v1/reports/export?format=pdf")).ok(),
  ).toBeTruthy();
  await json(
    await admin.patch("/api/v1/branding", {
      data: {
        logoDataUrl: null,
        companyName: "Harbour Advisory",
        taxPercent: 12.5,
        timezone: "Australia/Sydney",
        footer: "Prepared for North Coast Studio.",
      },
    }),
  );
  const usdClient = await json(
    await admin.post("/api/v1/clients", {
      data: { name: "Pacific US", currency: "USD", defaultRate: 200 },
    }),
  );
  const usdProject = await json(
    await admin.post("/api/v1/projects", {
      data: { name: "US discovery", clientId: usdClient.id },
    }),
  );
  expect(usdProject.rate).toBe(200);
  await json(
    await admin.post("/api/v1/time-entries", {
      data: entry({
        projectId: usdProject.id,
        task: "USD research",
        startedAt: "2026-09-22T11:00:00+10:00",
      }),
    }),
  );
  const report = await json(
    await admin.get("/api/v1/reports?from=2026-09-01&to=2026-09-30"),
  );
  expect(
    report.totals.map((t: { currency: string }) => t.currency).sort(),
  ).toEqual(["AUD", "USD"]);
  expect(report.branding.companyName).toBe("Harbour Advisory");
  const temporary = await json(
    await admin.post("/api/v1/tokens", {
      data: { name: "Disposable", scope: "read", expiresInDays: 1 },
    }),
  );
  await json(await admin.delete(`/api/v1/tokens/${temporary.id}`));
  const revoked = await requestFactory.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${temporary.token}` },
  });
  expect((await revoked.get("/api/v1/projects")).status()).toBe(401);
  await revoked.dispose();
});

test("MCP SDK discovers all actions, executes workflows, exports PDF, rejects read-only writes", async () => {
  const client = new McpClient({ name: "skytime-tests", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(baseURL + "/api/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const tools = await client.listTools();
  const catalog = await json(await admin.get("/api/v1/actions"));
  expect(tools.tools.map((t) => t.name).sort()).toEqual(
    catalog.map((a: { name: string }) => a.name).sort(),
  );
  const created = await client.callTool({
    name: "tags_create",
    arguments: { name: "MCP-tested" },
  });
  expect(created.isError).not.toBe(true);
  const report = await client.callTool({
    name: "reports_summary",
    arguments: { from: "2026-09-01", to: "2026-09-30" },
  });
  expect(report.isError).not.toBe(true);
  const exported = await client.callTool({
    name: "reports_export",
    arguments: { format: "pdf", from: "2026-09-01", to: "2026-09-30" },
  });
  expect(exported.isError).not.toBe(true);
  const content = exported.content as {
    type: string;
    resource: { blob: string; mimeType: string };
  }[];
  expect(content[0].resource.mimeType).toBe("application/pdf");
  expect(
    Buffer.from(content[0].resource.blob, "base64").subarray(0, 5).toString(),
  ).toBe("%PDF-");
  await client.close();
  const reader = new McpClient({ name: "reader-tests", version: "1" });
  await reader.connect(
    new StreamableHTTPClientTransport(new URL(baseURL + "/api/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${readToken}` } },
    }),
  );
  const denied = await reader.callTool({
    name: "projects_create",
    arguments: { name: "Read scope violation" },
  });
  expect(denied.isError).toBe(true);
  await reader.close();
});
test("PDF pagination preserves detailed notes and member attribution; CSV escapes formulas", async () => {
  const entries = Array.from({ length: 18 }, (_, i) =>
    entry({
      task: i === 0 ? "=SUM(A1:A2)" : `Discovery session ${i + 1}`,
      startedAt: `2026-09-${String(14 + (i % 10)).padStart(2, "0")}T11:00:00+10:00`,
      notes:
        "Detailed research and implementation notes for the client. ".repeat(
          i === 0 ? 65 : 5,
        ) + ` END-OF-NOTES-${i}`,
      durationMs: (i + 1) * 600000,
    }),
  );
  await json(
    await admin.post("/api/v1/time-entries/import", { data: { entries } }),
  );
  await json(
    await member.post("/api/v1/time-entries", {
      data: entry({
        task: "Member research",
        startedAt: "2026-09-21T11:00:00+10:00",
      }),
    }),
  );
  const csv = await admin.get(
    "/api/v1/reports/export?format=csv&from=2026-09-01&to=2026-09-30",
  );
  expect(await csv.text()).toContain("'=SUM(A1:A2)");
  const response = await admin.get(
    "/api/v1/reports/export?format=pdf&from=2026-09-01&to=2026-09-30",
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  const bytes = await response.body();
  await fs.mkdir(path.resolve(__dirname, "../../../../docs/reports"), {
    recursive: true,
  });
  await fs.writeFile(
    path.resolve(
      __dirname,
      "../../../../docs/reports/skytime-sample-report.pdf",
    ),
    bytes,
  );
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  const pdf = await loading.promise;
  expect(pdf.numPages).toBeGreaterThan(2);
  expect(pdf.numPages).toBeLessThanOrEqual(8);
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    text += content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
  }
  expect(text).toContain("END-OF-NOTES-0");
  expect(text).toContain("END-OF-NOTES-17");
  expect(text).toContain("Member");
  expect(text).toContain("SkyTime");
  await loading.destroy();
  // Publish a readable fictional sample separately from the pagination stress fixture.
  const showcase = [
    [
      "Stakeholder interviews",
      5400000,
      "Met with the service team to map current intake and escalation paths. Documented recurring friction points and agreed on the outcomes to measure.",
    ],
    [
      "Journey mapping",
      7200000,
      "Mapped the customer journey from first enquiry through service delivery. Prioritised three opportunities and prepared recommendations for the project team.",
    ],
    [
      "Prototype and accessibility review",
      9000000,
      "Built the revised intake prototype and checked keyboard navigation, form labels, and validation messages. Incorporated feedback from the first review.",
    ],
    [
      "Client workshop",
      4500000,
      "Facilitated a walkthrough of the proposed workflow. Captured decisions, assigned follow-up actions, and confirmed the scope for implementation.",
    ],
    [
      "Delivery notes and handover",
      3600000,
      "Prepared the handover pack, recorded implementation notes, and reconciled project time. The client has the materials needed for the next delivery phase.",
    ],
  ] as const;
  await json(
    await admin.post("/api/v1/time-entries/import", {
      data: {
        entries: showcase.map(([task, durationMs, notes], i) =>
          entry({
            task,
            durationMs,
            notes,
            startedAt: `2026-09-${14 + i}T11:00:00+10:00`,
            tags: ["Client report"],
            billable: i !== 4,
          }),
        ),
      },
    }),
  );
  await json(
    await admin.patch("/api/v1/branding", {
      data: {
        taxPercent: 10,
        address: "42 Clarence Street, Sydney NSW 2000",
        email: "team@harbour.example",
      },
    }),
  );
  const sample = await admin.get(
    "/api/v1/reports/export?format=pdf&from=2026-09-01&to=2026-09-30&tag=Client%20report",
  );
  expect(sample.ok()).toBeTruthy();
  await fs.writeFile(
    path.resolve(
      __dirname,
      "../../../../docs/reports/skytime-sample-report.pdf",
    ),
    await sample.body(),
  );
});
test("new screens render on desktop and mobile and browser timer persists on reload", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: await admin.storageState(),
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  await page.goto(baseURL);
  await expect(
    page.getByRole("button", { name: "Reports", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start timer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop and save", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Stop and save", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Stop and save", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start timer", exact: true }),
  ).toBeVisible();
  const screenshotDir = path.resolve(__dirname, "../../../../docs/screenshots");
  await fs.mkdir(screenshotDir, { recursive: true });
  for (const [nav, title, name] of [
    ["Reports", "Every hour, accounted for.", "reports"],
    ["Billing", "From recorded work to invoice.", "billing"],
    ["Planning", "Make room for the next project.", "planning"],
    ["API & MCP", "Your workspace, through MCP.", "automation"],
  ] as const) {
    await page.getByRole("button", { name: nav, exact: true }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    if (nav === "Reports") {
      await page.getByLabel("From", { exact: true }).fill("2026-09-01");
      await page.getByLabel("To", { exact: true }).fill("2026-09-30");
      await page.getByRole("button", { name: "Apply filters" }).click();
      await expect(page.getByText("Report updated")).toBeVisible();
    }
    if (nav === "API & MCP") {
      await expect(
        page.getByRole("button", { name: "Create token", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByRole("cell", { name: "tokens_revoke", exact: true }),
      ).toBeVisible();
    }
    if (nav === "Billing")
      await expect(
        page.getByRole("cell", { name: "INV-1001", exact: true }),
      ).toBeVisible();
    if (nav === "Planning")
      await expect(
        page.getByText("30 h / week", { exact: false }),
      ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(screenshotDir, `skytime-desktop-light-${name}.png`),
      animations: "disabled",
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Workspace section").selectOption("reports");
  await expect(
    page.getByRole("heading", { name: "Every hour, accounted for." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.getByLabel("From", { exact: true }).fill("2026-09-01");
  await page.getByLabel("To", { exact: true }).fill("2026-09-30");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("Report updated")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(screenshotDir, "skytime-mobile-light-reports.png"),
    animations: "disabled",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.screenshot({
    path: path.join(screenshotDir, "skytime-mobile-dark-reports.png"),
    animations: "disabled",
    fullPage: true,
  });
  await context.close();
});

test("session mutations exceeding pool capacity finish without reauthentication deadlock", async () => {
  const results = await Promise.all(
    Array.from({ length: 24 }, async (_, i) => {
      const api = i % 2 ? other : admin;
      const name = `Concurrent project ${i}`;
      const project = await json(
        await api.post("/api/v1/projects", {
          data: { name },
          timeout: 15000,
        }),
      );
      expect(project.name).toBe(name);
      return { id: project.id, other: i % 2 === 1 };
    }),
  );
  const own = await json(await admin.get("/api/v1/projects"));
  const foreign = await json(await other.get("/api/v1/projects"));
  for (const result of results) {
    expect(own.some((p: { id: string }) => p.id === result.id)).toBe(
      !result.other,
    );
    expect(foreign.some((p: { id: string }) => p.id === result.id)).toBe(
      result.other,
    );
  }
  expect(
    (await admin.get("/api/workspace", { timeout: 5000 })).ok(),
  ).toBeTruthy();
});

test("task moves preserve linked time through approval and invoice assignment", async () => {
  const target = await json(
    await admin.post("/api/v1/projects", {
      data: { name: "Task destination" },
    }),
  );
  const task = await json(
    await admin.post("/api/v1/tasks", {
      data: { projectId, title: "Linked task" },
    }),
  );
  await json(
    await admin.patch(`/api/tasks/${task.id}`, {
      data: { projectId: target.id },
    }),
  );
  await json(
    await admin.patch(`/api/v1/tasks/${task.id}`, { data: { projectId } }),
  );
  const linked = await json(
    await admin.post("/api/v1/time-entries", {
      data: entry({ taskId: task.id, startedAt: "2026-08-10T12:00:00Z" }),
    }),
  );
  for (const prefix of ["/api", "/api/v1"]) {
    const move = await admin.patch(`${prefix}/tasks/${task.id}`, {
      data: { projectId: target.id },
    });
    expect(move.status()).toBe(409);
    expect((await move.json()).error).toContain("linked time entries");
  }
  await json(
    await admin.patch(`/api/v1/time-entries/${linked.id}`, {
      data: { notes: "Still editable" },
    }),
  );
  const week = await json(
    await admin.post("/api/v1/timesheets", { data: { date: "2026-08-10" } }),
  );
  for (const action of ["submit", "approve"])
    await json(
      await admin.post(`/api/v1/timesheets/${week.id}`, { data: { action } }),
    );
  expect(
    (
      await admin.patch(`/api/v1/tasks/${task.id}`, {
        data: { projectId: target.id },
      })
    ).status(),
  ).toBe(409);
  const invoice = await json(
    await admin.post("/api/v1/invoices", {
      data: {
        clientId,
        number: "INV-LINK-REGRESSION",
        taxPercent: 10,
        from: "2026-08-10",
        to: "2026-08-10",
        issuedDate: "2026-08-11",
        dueDate: "2026-08-30",
      },
    }),
  );
  expect(invoice.lines).toHaveLength(1);
  expect(
    (
      await admin.patch(`/api/tasks/${task.id}`, {
        data: { projectId: target.id },
      })
    ).status(),
  ).toBe(409);
  const records = await db.query(
    "select t.project_id, e.project_id as entry_project_id, e.invoice_id from board_tasks t join time_entries e on e.task_id=t.id where t.id=$1",
    [task.id],
  );
  expect(records.rows[0]).toEqual({
    project_id: projectId,
    entry_project_id: projectId,
    invoice_id: invoice.id,
  });
  await json(
    await admin.patch(`/api/v1/tasks/${task.id}`, {
      data: { title: "Renaming remains allowed" },
    }),
  );
});

test("duplicate tags are normalized on writes and counted once for historical entries", async () => {
  const imported = await json(
    await admin.post("/api/v1/time-entries/import", {
      data: {
        entries: [
          entry({
            task: "Tag regression",
            startedAt: "2026-08-20T12:00:00Z",
            tags: ["Design", " Design ", "Review", "Review"],
          }),
        ],
      },
    }),
  );
  expect(imported[0].tags).toEqual(["Design", "Review"]);
  const updated = await json(
    await admin.patch("/api/v1/time-entries", {
      data: { ids: [imported[0].id], tags: ["Design", "Design", "Review"] },
    }),
  );
  expect(updated[0].tags).toEqual(["Design", "Review"]);
  const timer = await json(
    await admin.post("/api/v1/timer", {
      data: {
        projectId,
        task: "Tag timer",
        tags: ["Design", "Design"],
        startedAt: new Date(Date.now() - 5000).toISOString(),
      },
    }),
  );
  expect(timer.tags).toEqual(["Design"]);
  const stopped = await json(
    await admin.post("/api/v1/timer/stop", { data: { id: timer.id } }),
  );
  expect(stopped.tags).toEqual(["Design"]);
  // Simulate rows saved before normalization was introduced.
  await db.query("update time_entries set tags=$2 where id=$1", [
    imported[0].id,
    ["Design", "Design", "Review"],
  ]);
  const report = await json(
    await admin.get(
      "/api/v1/reports?from=2026-08-20&to=2026-08-20&groupBy=tag",
    ),
  );
  expect(report.entries).toHaveLength(1);
  expect(report.groups).toHaveLength(2);
  for (const group of report.groups) {
    expect(group.durationMs).toBe(report.totalMs);
    expect(group.billableMs).toBe(report.billableMs);
    expect(group.amount).toBe(report.totals[0].amount);
    expect(group.cost).toBe(report.totals[0].cost);
    expect(group.entries).toBe(1);
  }
});

for (const timezoneId of ["Australia/Sydney", "America/Los_Angeles"]) {
  test(`manual decimal hours and both exports match displayed dates in ${timezoneId}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: await admin.storageState(),
      timezoneId,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(baseURL);
    const marker = timezoneId.split("/")[1];
    const dates = await page.evaluate(() => {
      const start = new Date("2026-10-09T00:00:00").getTime();
      const end = new Date("2026-10-10T00:00:00").getTime();
      return [start - 1, start, end - 1, end].map((ms) =>
        new Date(ms).toISOString(),
      );
    });
    await json(
      await admin.post("/api/v1/time-entries/import", {
        data: {
          entries: dates.map((startedAt, i) =>
            entry({ task: `${marker}-boundary-${i}`, startedAt }),
          ),
        },
      }),
    );
    await page.reload();
    const quickAdd = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Quick add", exact: true }),
    });
    await quickAdd.getByRole("combobox").selectOption(projectId);
    await quickAdd
      .getByLabel("Task", { exact: true })
      .fill(`${marker}-decimal-hours`);
    await quickAdd.getByLabel("Date", { exact: true }).fill("2026-10-09");
    await quickAdd.getByLabel("Hours", { exact: true }).fill("2.05");
    const savedResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/time-entries") &&
        r.request().method() === "POST",
    );
    await quickAdd
      .getByRole("button", { name: "Add entry", exact: true })
      .click();
    const saved = await savedResponse;
    expect(saved.ok(), await saved.text()).toBeTruthy();
    expect((await saved.json()).durationMs).toBe(7380000);
    await page.getByRole("button", { name: "Timesheets", exact: true }).click();
    await page.getByRole("button", { name: "Custom", exact: true }).click();
    await page.getByLabel("Start", { exact: true }).fill("2026-10-09");
    await page.getByLabel("End", { exact: true }).fill("2026-10-09");
    for (const format of ["csv", "pdf"]) {
      const downloadPromise = page.waitForEvent("download");
      const responsePromise = page.waitForResponse((r) =>
        r.url().includes("/api/v1/reports/export?"),
      );
      await page
        .getByRole("button", { name: format.toUpperCase(), exact: true })
        .click();
      const response = await responsePromise;
      const params = new URL(response.url()).searchParams;
      expect(params.get("from")).toBe("2026-10-09");
      expect(params.get("to")).toBe("2026-10-09");
      expect(params.get("timezone")).toBe(timezoneId);
      expect(response.ok()).toBeTruthy();
      const download = await downloadPromise;
      const file = await download.path();
      expect(file).toBeTruthy();
      const bytes = await fs.readFile(file!);
      let text: string;
      if (format === "csv") text = bytes.toString("utf8");
      else {
        const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const task = getDocument({
          data: new Uint8Array(bytes),
          useSystemFonts: true,
        });
        const pdf = await task.promise;
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const content = await (await pdf.getPage(i)).getTextContent();
          pages.push(
            content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" "),
          );
        }
        text = pages.join(" ");
        await task.destroy();
      }
      expect(text).toContain(`${marker}-decimal-hours`);
      expect(text).toContain(`${marker}-boundary-1`);
      expect(text).toContain(`${marker}-boundary-2`);
      expect(text).not.toContain(`${marker}-boundary-0`);
      expect(text).not.toContain(`${marker}-boundary-3`);
    }
    await context.close();
  });
}

test("legacy timer recovery preserves browser data on conflict/failure and survives reload", async ({
  browser,
}) => {
  const legacy = {
    running: true,
    projectId,
    task: "Recovered browser work",
    notes: "Original local notes",
    billable: false,
    startedAt: new Date(Date.now() - 3600000).toISOString(),
  };
  const stored = JSON.stringify(legacy);
  const state = await admin.storageState();
  state.origins = [
    {
      origin: baseURL,
      localStorage: [{ name: "skytime-timer", value: stored }],
    },
  ];
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  const active = await json(
    await admin.post("/api/v1/timer", {
      data: { projectId, task: "Other active work" },
    }),
  );
  await page.goto(baseURL);
  const recovery = page.getByRole("region", { name: "Recover browser timer" });
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText(legacy.notes);
  await recovery.getByRole("button", { name: "Recover timer" }).click();
  await expect(
    page.getByText(
      "Stop and save the current timer before recovering this browser timer. Your browser timer is still saved.",
    ),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("skytime-timer"))).toBe(
    stored,
  );
  expect((await json(await admin.get("/api/v1/timer"))).id).toBe(active.id);
  await json(await admin.delete(`/api/v1/timer/${active.id}`));
  await page.route("**/api/v1/timer", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 503,
        json: { error: "Recovery temporarily unavailable" },
      });
    else await route.continue();
  });
  await recovery.getByRole("button", { name: "Recover timer" }).click();
  await expect(
    page.getByText("Recovery temporarily unavailable"),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("skytime-timer"))).toBe(
    stored,
  );
  await page.unroute("**/api/v1/timer");
  // Commit recovery but drop its response; retry must adopt the saved timer.
  await page.route("**/api/v1/timer", async (route) => {
    if (route.request().method() === "POST") {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort("failed");
    } else await route.continue();
  });
  await recovery.getByRole("button", { name: "Recover timer" }).click();
  await expect(
    recovery.getByRole("button", { name: "Recover timer", exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem("skytime-timer"))).toBe(
    stored,
  );
  const remote = await json(await admin.get("/api/v1/timer"));
  expect(remote).toMatchObject(legacy);
  await page.unroute("**/api/v1/timer");
  await recovery.getByRole("button", { name: "Recover timer" }).click();
  await expect(recovery).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("skytime-timer")),
  ).toBeNull();
  await page.reload();
  await expect(recovery).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Stop and save", exact: true }),
  ).toBeVisible();
  expect((await json(await admin.get("/api/v1/timer"))).id).toBe(remote.id);
  const responsePromise = page.waitForResponse((r) =>
    r.url().endsWith("/api/v1/timer/stop"),
  );
  await page
    .getByRole("button", { name: "Stop and save", exact: true })
    .click();
  const saved = await (await responsePromise).json();
  expect(saved).toMatchObject({
    startedAt: legacy.startedAt,
    task: legacy.task,
    notes: legacy.notes,
    billable: false,
  });
  expect(saved.durationMs).toBeGreaterThanOrEqual(3600000);
  await context.close();
});
