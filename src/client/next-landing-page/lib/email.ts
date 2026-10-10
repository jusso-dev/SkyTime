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

type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

type SendEmailBinding = {
  send(message: {
    to: string;
    from: { email: string; name?: string };
    subject: string;
    html: string;
    text: string;
  }): Promise<{ messageId?: string }>;
};

const fromAddress = { email: "noreply@yarndigi.au", name: "SkyTime" };

export function getAppUrl(requestUrl?: string) {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (requestUrl) return new URL(requestUrl).origin;
  return "http://localhost:3000";
}

export async function sendOrganizationInviteEmail(input: InviteEmail): Promise<EmailResult> {
  const subject = `${input.invitedBy} invited you to ${input.organizationName} on SkyTime`;
  const text = `${input.invitedBy} invited you to ${input.organizationName} on SkyTime as a ${input.role}.\n${input.acceptUrl}`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.5;color:#0f172a;background:#f8fafc;padding:32px">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dbeafe;border-radius:18px;padding:28px">
        <p style="margin:0 0 12px;color:#2563eb;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px">SkyTime invite</p>
        <h1 style="margin:0 0 12px;font-size:24px;line-height:1.2">Join ${escapeHtml(input.organizationName)}</h1>
        <p style="margin:0 0 20px;color:#475569">${escapeHtml(input.invitedBy)} invited you as a ${input.role}.</p>
        <a href="${escapeHtml(input.acceptUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:12px;padding:12px 18px;font-weight:700">Accept invite</a>
        <p style="margin:22px 0 0;color:#64748b;font-size:13px">This invite was sent to ${escapeHtml(input.email)}. Sign in with that email to accept it.</p>
      </div>
    </div>
  `;
  return sendMail({ to: input.email, subject, html, text });
}

export async function sendPasswordResetEmail(input: {
  email: string;
  url: string;
}): Promise<EmailResult> {
  const subject = "Reset your SkyTime password";
  const text = [
    "Reset your SkyTime password:",
    input.url,
    "",
    "This link expires in one hour.",
    "If you did not ask for a reset, you can ignore this email.",
  ].join("\n");
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.5;color:#0f172a;background:#f8fafc;padding:32px">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dbeafe;border-radius:18px;padding:28px">
        <p style="margin:0 0 12px;color:#2563eb;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px">SkyTime</p>
        <h1 style="margin:0 0 12px;font-size:24px;line-height:1.2">Reset your password</h1>
        <p style="margin:0 0 20px;color:#475569">This link expires in one hour.</p>
        <a href="${escapeHtml(input.url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:12px;padding:12px 18px;font-weight:700">Choose a new password</a>
        <p style="margin:22px 0 0;color:#64748b;font-size:13px">If you did not ask for this, you can ignore this email.</p>
      </div>
    </div>
  `;
  return sendMail({ to: input.email, subject, html, text });
}

async function sendMail(input: OutboundEmail): Promise<EmailResult> {
  const email = await emailBinding();
  if (!email) {
    console.info("[email:skipped] Cloudflare email binding missing", {
      to: input.to,
      subject: input.subject,
    });
    return { sent: false, skipped: true, reason: "Cloudflare email is not configured" };
  }

  try {
    const result = await email.send({
      to: input.to,
      from: fromAddress,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    console.info("[email:sent]", {
      to: input.to,
      subject: input.subject,
      messageId: result.messageId,
    });
    return { sent: true, skipped: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Email send failed";
    console.error("[email:error] Cloudflare email failed", reason.slice(0, 300));
    return { sent: false, skipped: false, reason };
  }
}

async function emailBinding(): Promise<SendEmailBinding | null> {
  try {
    const specifier = "cloudflare:workers";
    const mod = (await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier)) as {
      env?: { EMAIL?: SendEmailBinding };
    };
    return mod.env?.EMAIL ?? null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
