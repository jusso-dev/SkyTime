import PDFDocument from "./pdf-document";
import SVGtoPDF from "svg-to-pdfkit";
import type { Report, Branding } from "./data";
import { skytimeLogoSvg } from "./logo-svg";
const hours = (ms: number) => (ms / 3600000).toFixed(2) + " h";
const money = (n: number, c: string) =>
  `${c} ${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function drawLogo(
  doc: PDFKit.PDFDocument,
  svg: string,
  x: number,
  y: number,
  width: number,
) {
  doc
    .save()
    .translate(x, y)
    .scale(width / 960);
  SVGtoPDF(doc, svg, 0, 0, {
    assumePt: true,
    width: 960,
    height: 260,
    fontCallback: () => "Helvetica-Bold",
  });
  doc.restore();
}
export async function reportPdf(report: Report): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 42,
    bufferPages: true,
    info: {
      Title: report.title,
      Author: report.branding.companyName,
      Subject: "Time, project and billing report",
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (b) => chunks.push(b));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const b = report.branding;
  const width = 511;
  let y = 0;
  const logo = await skytimeLogoSvg();
  const header = (section: string) => {
    doc.rect(0, 0, 595, 7).fill(b.accentColor);
    if (b.logoDataUrl) {
      try {
        doc.image(Buffer.from(b.logoDataUrl.split(",")[1], "base64"), 42, 28, {
          fit: [150, 48],
        });
      } catch {
        drawLogo(doc, logo, 36, 24, 164);
      }
    } else drawLogo(doc, logo, 36, 24, 164);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#64748b")
      .text(b.companyName, 310, 37, { width: 243, align: "right" })
      .text(section, 310, 52, { width: 243, align: "right" });
    y = 101;
  };
  const page = (section: string) => {
    doc.addPage();
    header(section);
  };
  const ensure = (height: number, section = "Detailed time log") => {
    if (y + height > 760) page(section);
  };
  const label = (text: string) => {
    ensure(35);
    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor("#0f172a")
      .text(text, 42, y, { width });
    y += 28;
  };
  const paragraph = (text: string, size = 10, color = "#475569") => {
    doc.font("Helvetica").fontSize(size);
    const lines = doc.heightOfString(text, { width });
    ensure(lines + 12);
    doc.fillColor(color).text(text, 42, y, { width });
    y += lines + 12;
  };
  header("Overview");
  doc
    .font("Helvetica-Bold")
    .fontSize(28)
    .fillColor("#0f172a")
    .text(report.title, 42, y, { width });
  y += 44;
  paragraph(
    `${report.filters.from ?? "All recorded time"}  —  ${report.filters.to ?? "Present"}  |  ${report.filters.timezone}`,
  );
  paragraph(
    [b.address, b.email, b.taxId ? `Tax ID: ${b.taxId}` : ""]
      .filter(Boolean)
      .join("  •  "),
    9,
  );
  const cards = [
    ["TOTAL TIME", hours(report.totalMs)],
    ["BILLABLE TIME", hours(report.billableMs)],
    ["TIME ENTRIES", String(report.entries.length)],
  ];
  cards.forEach(([title, value], i) => {
    const x = 42 + i * 174;
    doc.roundedRect(x, y, 163, 76, 6).fill("#eff6ff");
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#475569")
      .text(title, x + 14, y + 15, { width: 139 });
    doc
      .font("Helvetica-Bold")
      .fontSize(23)
      .fillColor("#0f172a")
      .text(value, x + 14, y + 36, { width: 139 });
  });
  y += 100;
  label("Billing summary");
  for (const total of report.totals) {
    ensure(62, "Overview");
    const tax = Math.round(total.amount * b.taxPercent) / 100;
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#0f172a")
      .text(money(total.amount, total.currency), 42, y, { width: 245 });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#64748b")
      .text(
        `Tax ${b.taxPercent}%: ${money(tax, total.currency)}  |  Total: ${money(total.amount + tax, total.currency)}`,
        42,
        y + 20,
        { width },
      );
    y += 52;
  }
  if (!report.entries.length)
    paragraph(
      "No time entries match this report. Adjust the period or filters and try again.",
    );
  label(`Breakdown by ${report.filters.groupBy ?? "project"}`);
  const max = Math.max(1, ...report.groups.map((g) => g.durationMs));
  for (const g of report.groups) {
    doc.font("Helvetica-Bold").fontSize(10);
    const h = doc.heightOfString(g.name, { width: 270 }) + 36;
    ensure(h, "Summary");
    doc.fillColor("#0f172a").text(g.name, 42, y, { width: 270 });
    doc
      .font("Helvetica")
      .fontSize(10)
      .text(
        `${hours(g.durationMs)}  |  ${money(g.amount, g.currency)}`,
        315,
        y,
        { width: 238, align: "right" },
      );
    y += h - 24;
    doc.roundedRect(42, y, width, 4, 2).fill("#e2e8f0");
    doc
      .roundedRect(42, y, Math.max(4, (width * g.durationMs) / max), 4, 2)
      .fill(b.accentColor);
    y += 24;
  }
  if (report.filters.groupBy === "tag")
    paragraph(
      "Entries with multiple tags appear in each tag group. Grand totals count each entry once.",
      8,
    );
  ensure(70, "Report notes");
  y += 10;
  paragraph(b.footer, 9);
  paragraph(
    `Generated ${new Date(report.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC. ${report.filters.roundMinutes ? `Each entry rounded up to ${report.filters.roundMinutes} minutes.` : "Exact recorded durations; no rounding."} Amounts exclude expenses. This time report is not a tax invoice.`,
    8,
  );
  if (report.entries.length) {
    page("Detailed time log");
    label("Detailed time log");
    paragraph(
      "Hours, rates, and amounts use the selected rounding. Rates are captured when time is recorded.",
      9,
    );
    for (const e of report.entries) {
      const desc = [
        e.task,
        e.notes,
        e.tags.length ? "Tags: " + e.tags.join(", ") : "",
      ]
        .filter(Boolean)
        .join("\n");
      doc.font("Helvetica").fontSize(9);
      // Split long notes into bounded blocks without dropping text at page boundaries.
      const words = desc.split(/\s+/);
      const blocks: string[] = [];
      let block = "";
      for (const word of words) {
        const next = block ? block + " " + word : word;
        if (doc.heightOfString(next, { width: width - 24 }) > 230 && block) {
          blocks.push(block);
          block = word;
        } else block = next;
      }
      if (block) blocks.push(block);
      for (let i = 0; i < blocks.length; i++) {
        const text = blocks[i];
        doc.font("Helvetica").fontSize(9);
        const textHeight = doc.heightOfString(text, { width: width - 24 });
        const heading = `${e.project} / ${e.client}`;
        doc.font("Helvetica-Bold").fontSize(10);
        const headingHeight = doc.heightOfString(heading, {
          width: width - 24,
        });
        const rowHeight = textHeight + headingHeight + 81;
        ensure(rowHeight);
        doc.roundedRect(42, y, width, rowHeight - 10, 5).fill("#f8fafc");
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor("#0f172a")
          .text(heading, 54, y + 12, { width: width - 24 });
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor("#64748b")
          .text(
            `${e.date}  |  ${e.member}  |  ${e.billable ? "Billable" : "Non-billable"}${e.invoiced ? "  |  Invoiced" : ""}${i ? "  |  Continued" : ""}`,
            54,
            y + headingHeight + 19,
            { width: width - 24 },
          );
        doc
          .fontSize(9)
          .fillColor("#334155")
          .text(text, 54, y + headingHeight + 37, { width: width - 24 });
        if (i === 0)
          doc
            .font("Helvetica-Bold")
            .fontSize(9)
            .fillColor(b.accentColor)
            .text(
              `${hours(e.roundedMs)}  ×  ${money(e.rate, e.currency)} / h  =  ${money(e.amount, e.currency)}`,
              54,
              y + headingHeight + textHeight + 49,
              { width: width - 24 },
            );
        y += rowHeight;
      }
    }
  }
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.moveTo(42, 789).lineTo(553, 789).strokeColor("#e2e8f0").stroke();
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#64748b")
      .text("SkyTime  /  " + b.companyName, 42, 799, {
        width: 400,
        lineBreak: false,
      })
      .text(`${i + 1} / ${pages.count}`, 493, 799, {
        width: 60,
        align: "right",
        lineBreak: false,
      });
  }
  doc.end();
  return done;
}
export async function invoicePdf(
  invoice: Record<string, unknown>,
  branding: Branding,
): Promise<Buffer> {
  const lines = invoice.lines as {
    description: string;
    quantity: number;
    rate: number;
    amount: number;
  }[];
  const report: Report = {
    title: `Invoice ${invoice.number}`,
    generatedAt: new Date().toISOString(),
    organization: branding.companyName,
    branding: {
      ...branding,
      footer: `${branding.footer}\n${invoice.notes ?? ""}`,
    },
    filters: {
      from: String(invoice.issued_date).slice(0, 10),
      to: String(invoice.due_date).slice(0, 10),
      timezone: branding.timezone,
    },
    entries: [],
    groups: lines.map((l) => ({
      name: l.description,
      currency: String(invoice.currency),
      durationMs: l.quantity * 3600000,
      billableMs: l.quantity * 3600000,
      amount: l.amount,
      cost: 0,
      entries: 1,
    })),
    totals: [],
    totalMs: 0,
    billableMs: 0,
  };
  // Invoice rendering is separate from time report semantics.
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (b) => chunks.push(b));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const logo = await skytimeLogoSvg();
  doc.rect(0, 0, 595, 7).fill(branding.accentColor);
  if (branding.logoDataUrl)
    doc.image(
      Buffer.from(branding.logoDataUrl.split(",")[1], "base64"),
      42,
      30,
      { fit: [160, 50] },
    );
  else drawLogo(doc, logo, 36, 25, 170);
  doc.font("Helvetica-Bold").fontSize(26).text(report.title, 42, 105);
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#475569")
    .text(
      `${branding.companyName}\n${branding.address}\n${branding.email}\n${branding.taxId ? `Tax ID: ${branding.taxId}` : ""}`,
    );
  const client = invoice.client_snapshot as {
    name: string;
    address: string;
    contact_email: string;
  };
  doc
    .moveDown()
    .text(
      `Bill to: ${client.name}\n${client.address}\n${client.contact_email}`,
    );
  doc
    .moveDown()
    .text(
      `Status: ${invoice.status}   |   Issued: ${report.filters.from}   |   Due: ${report.filters.to}`,
    )
    .moveDown();
  for (const l of lines) {
    if (doc.y > 680) doc.addPage();
    doc.font("Helvetica-Bold").fillColor("#0f172a").text(l.description);
    doc
      .font("Helvetica")
      .fillColor("#475569")
      .text(
        `${l.quantity.toFixed(4)} × ${money(l.rate, String(invoice.currency))} = ${money(l.amount, String(invoice.currency))}`,
      )
      .moveDown();
  }
  if (doc.y > 630) doc.addPage();
  doc
    .moveDown()
    .text(
      `Subtotal: ${money(Number(invoice.subtotal), String(invoice.currency))}\nTax (${invoice.tax_percent}%): ${money(Number(invoice.tax), String(invoice.currency))}`,
    );
  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor(branding.accentColor)
    .text(`Total: ${money(Number(invoice.total), String(invoice.currency))}`);
  doc
    .moveDown()
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#475569")
    .text(report.branding.footer);
  doc.end();
  return done;
}
