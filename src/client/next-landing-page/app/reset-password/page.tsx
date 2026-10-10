"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const linkError = params.get("error");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(
    linkError ? "This reset link is invalid or expired." : "",
  );

  async function submit() {
    setError("");
    setMessage("");
    if (!token) {
      setError("This reset link is invalid or expired.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword: password, token }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!response.ok) {
        setError(data.message || "Could not reset the password.");
        return;
      }
      setMessage("Password updated. You can sign in.");
    } catch {
      setError("Could not reset the password.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-frame text-[var(--text)]">
      <section className="sky-panel w-full max-w-md p-5 sm:p-6">
        <h1 className="text-lg font-semibold">Choose a new password</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Use the link from your reset email. It expires in one hour.
        </p>
        <div className="mt-5 grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
              New password
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--raised)] px-3 text-base outline-none focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent-subtle)] sm:text-sm"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
              Confirm password
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--raised)] px-3 text-base outline-none focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent-subtle)] sm:text-sm"
            />
          </label>
          {error && (
            <p className="rounded-xl border border-[var(--error)] bg-[var(--error-soft)] p-3 text-sm text-[var(--error)]">
              {error}
            </p>
          )}
          {message && <p className="text-sm text-[var(--muted)]">{message}</p>}
          {message ? (
            <a
              href="/"
              className="inline-flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--raised)]"
            >
              Back to sign in
            </a>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => void submit()}
              className="inline-flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--raised)] disabled:opacity-60"
            >
              {pending ? "Saving..." : "Update password"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
