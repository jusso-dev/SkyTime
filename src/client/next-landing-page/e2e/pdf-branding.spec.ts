import { expect, request as requestFactory, test } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { seedCredential, TEST_PASSWORD } from "./credentials";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const accent = "#0a7a4b";

function pdfStreams(pdf: Buffer) {
  const text: string[] = [pdf.toString("latin1")];
  const source = pdf;
  for (const marker of ["stream\n", "stream\r\n"]) {
    let index = 0;
    while (index < source.length) {
      const start = source.indexOf(marker, index);
      if (start < 0) break;
      const dataStart = start + marker.length;
      const end = source.indexOf("endstream", dataStart);
      if (end < 0) break;
      const raw = source.subarray(dataStart, end).subarray(0, -1);
      try {
        text.push(zlib.inflateSync(raw).toString("latin1"));
      } catch {
        text.push(raw.toString("latin1"));
      }
      index = end + "endstream".length;
    }
  }
  return text.join("\n");
}

function accentOperator(hex: string) {
  const channels = [1, 3, 5].map(
    (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  return `${channels.join(" ")} scn`;
}

test("settings logo and accent color appear on generated PDFs", async ({
  browser,
}) => {
  const api = await requestFactory.newContext({ baseURL });
  const email = `pdf-brand-${Date.now()}@example.com`;
  await seedCredential({ name: "PDF Admin", email, password: TEST_PASSWORD });
  const signIn = await api.post("/api/auth/sign-in/email", {
    data: { email, password: TEST_PASSWORD },
  });
  expect(signIn.ok(), await signIn.text()).toBeTruthy();
  const organization = await api.post("/api/organizations", {
    data: { name: "Brand Studio" },
  });
  expect(organization.ok(), await organization.text()).toBeTruthy();

  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  await page.goto(baseURL);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "PDF reports" })).toBeVisible();
  await expect(page.getByLabel("Accent color hex")).toHaveValue("#2563eb");

  const { createCanvas } = await import("@napi-rs/canvas");
  const logo = createCanvas(80, 24);
  const drawing = logo.getContext("2d");
  drawing.fillStyle = accent;
  drawing.fillRect(0, 0, 80, 24);
  const logoPath = path.join(os.tmpdir(), `skytime-logo-${Date.now()}.png`);
  await fs.writeFile(
    logoPath,
    Buffer.from(logo.toDataURL("image/png").split(",")[1], "base64"),
  );

  await page.getByLabel("Accent color hex").fill(accent);
  await page.getByLabel("Company logo").setInputFiles(logoPath);
  await expect(page.getByText("Logo ready. Save to use it on PDFs.")).toBeVisible();
  await page.getByRole("button", { name: "Save PDF branding" }).click();
  await expect(page.getByText("PDF branding saved")).toBeVisible();
  await expect(page.getByRole("img", { name: "Company logo preview" })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Accent color hex")).toHaveValue(accent);
  await expect(page.getByRole("img", { name: "Company logo preview" })).toBeVisible();

  const brandingResponse = await api.get("/api/v1/branding");
  expect(brandingResponse.ok(), await brandingResponse.text()).toBeTruthy();
  const branding = await brandingResponse.json();
  expect(branding.accentColor).toBe(accent);
  expect(branding.logoDataUrl).toMatch(/^data:image\/png;base64,/);

  const reportPdf = await api.get("/api/v1/reports/export?format=pdf");
  expect(reportPdf.ok(), await reportPdf.text()).toBeTruthy();
  const reportBody = Buffer.from(await reportPdf.body());
  const reportDrawn = pdfStreams(reportBody);
  expect(reportBody.subarray(0, 5).toString()).toBe("%PDF-");
  expect(reportDrawn).toContain(accentOperator(accent));
  expect(reportDrawn).toContain("/Subtype /Image");

  const clientResponse = await api.post("/api/v1/clients", {
    data: { name: "Brand Client" },
  });
  expect(clientResponse.ok(), await clientResponse.text()).toBeTruthy();
  const client = await clientResponse.json();
  const projectResponse = await api.post("/api/v1/projects", {
    data: { name: "Brand Project", clientId: client.id },
  });
  expect(projectResponse.ok(), await projectResponse.text()).toBeTruthy();
  const project = await projectResponse.json();
  const entryResponse = await api.post("/api/v1/time-entries", {
    data: {
      projectId: project.id,
      task: "Logo check",
      startedAt: "2026-10-10T01:00:00.000Z",
      durationMs: 3_600_000,
      billable: true,
    },
  });
  expect(entryResponse.ok(), await entryResponse.text()).toBeTruthy();
  const invoiceResponse = await api.post("/api/v1/invoices", {
    data: {
      clientId: client.id,
      number: `INV-BRAND-${Date.now()}`,
      from: "2026-10-10",
      to: "2026-10-10",
      issuedDate: "2026-10-10",
      dueDate: "2026-10-20",
      taxPercent: 10,
    },
  });
  expect(invoiceResponse.ok(), await invoiceResponse.text()).toBeTruthy();
  const invoice = await invoiceResponse.json();
  expect(invoice.branding_snapshot.accentColor).toBe(accent);
  expect(invoice.branding_snapshot.logoDataUrl).toMatch(/^data:image\/png;base64,/);

  const invoicePdf = await api.get(`/api/v1/invoices/${invoice.id}/pdf`);
  expect(invoicePdf.ok(), await invoicePdf.text()).toBeTruthy();
  const invoiceBody = Buffer.from(await invoicePdf.body());
  const invoiceDrawn = pdfStreams(invoiceBody);
  expect(invoiceDrawn).toContain(accentOperator(accent));
  expect(invoiceDrawn).toContain("/Subtype /Image");

  await page.getByRole("button", { name: "Use SkyTime logo" }).click();
  await page.getByRole("button", { name: "Save PDF branding" }).click();
  await expect(page.getByText("PDF branding saved")).toBeVisible();
  await expect(page.getByText("SkyTime", { exact: true })).toBeVisible();
  const cleared = await (await api.get("/api/v1/branding")).json();
  expect(cleared.logoDataUrl).toBeNull();
  expect(cleared.accentColor).toBe(accent);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Workspace section").selectOption("settings");
  await expect(page.getByRole("heading", { name: "PDF reports" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();

  await fs.unlink(logoPath);
  await context.close();
  await api.dispose();
});
