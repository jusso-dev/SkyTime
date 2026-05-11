import { Resend } from "resend";

type InviteEmail = {
  acceptUrl: string;
  email: string;
  invitedBy: string;
  organizationName: string;
  role: "admin" | "member";
};

type EmailResult =
  | { sent: true; skipped: false }
  | { sent: false; skipped: true; reason: string }
  | { sent: false; skipped: false; reason: string };

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export function getAppUrl(requestUrl?: string) {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (requestUrl) return new URL(requestUrl).origin;
  return "http://localhost:3000";
}

export async function sendOrganizationInviteEmail(input: InviteEmail): Promise<EmailResult> {
  const from = process.env.RESEND_FROM_EMAIL ?? "SkyTime <onboarding@resend.dev>";
  const subject = `${input.invitedBy} invited you to ${input.organizationName} on SkyTime`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.5;color:#0f172a;background:#f8fafc;padding:32px">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dbeafe;border-radius:18px;padding:28px">
        <p style="margin:0 0 12px;color:#2563eb;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px">SkyTime invite</p>
        <h1 style="margin:0 0 12px;font-size:24px;line-height:1.2">Join ${escapeHtml(input.organizationName)}</h1>
        <p style="margin:0 0 20px;color:#475569">${escapeHtml(input.invitedBy)} invited you as a ${input.role}.</p>
        <a href="${input.acceptUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:12px;padding:12px 18px;font-weight:700">Accept invite</a>
        <p style="margin:22px 0 0;color:#64748b;font-size:13px">This invite was sent to ${escapeHtml(input.email)}. Sign in with that email to accept it.</p>
      </div>
    </div>
  `;

  if (!resend) {
    console.info("[email:skipped] Resend is not configured", {
      to: input.email,
      subject,
      acceptUrl: input.acceptUrl,
    });
    return { sent: false, skipped: true, reason: "Resend is not configured" };
  }

  const { error } = await resend.emails.send({
    from,
    to: input.email,
    subject,
    html,
  });

  if (error) {
    console.error("[email:error] Resend invite failed", error);
    return { sent: false, skipped: false, reason: error.message };
  }

  return { sent: true, skipped: false };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
