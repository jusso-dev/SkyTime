"use client";
import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import {
  ArrowDownToLine,
  Check,
  Code2,
  FileText,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { Client, Project } from "@/lib/workspace-types";
import type { Branding, Report, ReportFilters } from "@/lib/reports/data";
const control = "feature-control";
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api/v1/" + path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Request failed");
  return data;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="feature-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Button({
  children,
  onClick,
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      className="feature-button"
      onClick={onClick}
      type={type}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="feature-empty">
      <FileText size={26} />
      <p>{children}</p>
    </div>
  );
}
function useFeedback() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function run(work: () => Promise<void>, success = "Saved") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return {
    busy,
    run,
    feedback: (
      <>
        {error && (
          <p className="feature-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="feature-success" role="status">
            <Check size={16} />
            {message}
          </p>
        )}
      </>
    ),
  };
}
function queryString(f: Record<string, unknown>) {
  return new URLSearchParams(
    Object.entries(f)
      .filter(([, v]) => v !== "" && v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
}
async function download(path: string, filename: string) {
  const r = await fetch("/api/v1/" + path);
  if (!r.ok) throw new Error((await r.json()).error ?? "Export failed");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const today = () => {
  // Use the browser's local calendar date, not UTC: toISOString() returns
  // yesterday's date for local mornings in timezones ahead of UTC (e.g. AEST),
  // which would date invoices, expenses and report ranges a day early.
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const dayOffset = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const money = (amount: number, currency: string) => {
  // Intl throws RangeError for anything that is not a 3-letter code; client
  // currency is free text on legacy data, so fall back instead of crashing
  // the whole render.
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "AUD";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: code }).format(
    amount,
  );
};
const hours = (ms: number) => (ms / 3600000).toFixed(2);
export function ReportsView({
  projects,
  clients,
}: {
  projects: Project[];
  clients: Client[];
}) {
  const [filters, setFilters] = useState<Record<string, string>>({
    from: today().slice(0, 8) + "01",
    to: today(),
    groupBy: "project",
  });
  const [report, setReport] = useState<Report | null>(null);
  const [saved, setSaved] = useState<
    { id: string; name: string; filters: ReportFilters }[]
  >([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const [reportName, setReportName] = useState("");
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [view, setView] = useState("summary");
  const f = useFeedback();
  async function load(next = filters) {
    const r = await api<Report>("reports?" + queryString(next));
    setReport(r);
    setSelected([]);
  }
  useEffect(() => {
    void f.run(async () => {
      await load();
      setSaved(await api("saved-reports"));
      setMembers(await api("members"));
    }, "");
  }, []);
  const set = (key: string, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));
  return (
    <div className="feature-stack">
      <div className="feature-heading">
        <div>
          <p className="feature-eyebrow">Reports</p>
          <h2>Every hour, accounted for.</h2>
          <p>
            Explore the work, review the numbers, and send a report with your
            brand.
          </p>
        </div>
        <div className="feature-actions">
          <Button
            disabled={f.busy || !report}
            onClick={() =>
              void f.run(
                () =>
                  download(
                    "reports/export?" +
                      queryString({ ...report?.filters, format: "csv" }),
                    "skytime-report.csv",
                  ),
                "CSV downloaded",
              )
            }
          >
            <ArrowDownToLine size={16} />
            CSV
          </Button>
          <Button
            disabled={f.busy || !report}
            onClick={() =>
              void f.run(
                () =>
                  download(
                    "reports/export?" +
                      queryString({ ...report?.filters, format: "pdf" }),
                    "skytime-report.pdf",
                  ),
                "PDF downloaded",
              )
            }
          >
            <FileText size={16} />
            Branded PDF
          </Button>
        </div>
      </div>
      {f.feedback}
      <form
        className="feature-panel feature-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void f.run(() => load(), "Report updated");
        }}
      >
        <Field label="From">
          <input
            className={control}
            type="date"
            value={filters.from ?? ""}
            onChange={(e) => set("from", e.target.value)}
          />
        </Field>
        <Field label="To">
          <input
            className={control}
            type="date"
            value={filters.to ?? ""}
            onChange={(e) => set("to", e.target.value)}
          />
        </Field>
        <Field label="Client">
          <select
            className={control}
            value={filters.clientId ?? ""}
            onChange={(e) => set("clientId", e.target.value)}
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Project">
          <select
            className={control}
            value={filters.projectId ?? ""}
            onChange={(e) => set("projectId", e.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Member">
          <select
            className={control}
            value={filters.userId ?? ""}
            onChange={(e) => set("userId", e.target.value)}
          >
            <option value="">All members</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Group by">
          <select
            className={control}
            value={filters.groupBy ?? "project"}
            onChange={(e) => set("groupBy", e.target.value)}
          >
            {["project", "client", "member", "day", "tag"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Billing">
          <select
            className={control}
            value={filters.billable ?? ""}
            onChange={(e) => set("billable", e.target.value)}
          >
            <option value="">All time</option>
            <option value="true">Billable</option>
            <option value="false">Non-billable</option>
          </select>
        </Field>
        <Field label="Invoice state">
          <select
            className={control}
            value={filters.invoiced ?? ""}
            onChange={(e) => set("invoiced", e.target.value)}
          >
            <option value="">All entries</option>
            <option value="false">Unbilled</option>
            <option value="true">Invoiced</option>
          </select>
        </Field>
        <Field label="Round up">
          <select
            className={control}
            value={filters.roundMinutes ?? "0"}
            onChange={(e) => set("roundMinutes", e.target.value)}
          >
            {[0, 5, 6, 10, 15, 30, 60].map((v) => (
              <option key={v} value={v}>
                {v ? `${v} minutes` : "Exact time"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tag">
          <input
            className={control}
            value={filters.tag ?? ""}
            onChange={(e) => set("tag", e.target.value)}
            placeholder="Any tag"
          />
        </Field>
        <Field label="Search descriptions">
          <input
            className={control}
            value={filters.search ?? ""}
            onChange={(e) => set("search", e.target.value)}
            placeholder="Search work…"
          />
        </Field>
        <Button type="submit" disabled={f.busy}>
          <RefreshCw size={16} />
          Apply filters
        </Button>
      </form>
      <div className="feature-toolbar">
        <div className="feature-actions">
          {["summary", "details", "weekly"].map((v) => (
            <button
              key={v}
              className="feature-tab"
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {v === "weekly"
                ? "Daily grid"
                : v === "summary"
                  ? "Summary"
                  : "Time entries"}
            </button>
          ))}
        </div>
        <div className="feature-actions">
          <input
            aria-label="Report preset name"
            className={control}
            value={reportName}
            onChange={(e) => setReportName(e.target.value)}
            placeholder="Name this report"
          />
          <Button
            disabled={!reportName.trim() || !report || f.busy}
            onClick={() =>
              void f.run(async () => {
                await api("saved-reports", "POST", {
                  name: reportName,
                  filters: report!.filters,
                });
                setSaved(await api("saved-reports"));
                setReportName("");
              }, "Report saved")
            }
          >
            Save view
          </Button>
        </div>
      </div>
      {saved.length > 0 && (
        <div className="feature-actions">
          {saved.map((s) => (
            <div className="feature-preset" key={s.id}>
              <button
                onClick={() =>
                  void f.run(async () => {
                    const next = Object.fromEntries(
                      Object.entries(s.filters).map(([k, v]) => [k, String(v)]),
                    );
                    setFilters(next);
                    await load(next);
                  }, "Saved view loaded")
                }
              >
                {s.name}
              </button>
              <button
                aria-label={`Delete ${s.name}`}
                onClick={() =>
                  void f.run(async () => {
                    await api("saved-reports/" + s.id, "DELETE", {});
                    setSaved(await api("saved-reports"));
                  }, "Preset deleted")
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {!report ? (
        <Empty>Loading report…</Empty>
      ) : (
        <>
          <div className="feature-stats">
            <div>
              <span>Total tracked</span>
              <strong>
                {hours(report.totalMs)}
                <small> h</small>
              </strong>
            </div>
            <div>
              <span>Billable time</span>
              <strong>
                {hours(report.billableMs)}
                <small> h</small>
              </strong>
            </div>
            <div>
              <span>Billable share</span>
              <strong>
                {report.totalMs
                  ? Math.round((report.billableMs / report.totalMs) * 100)
                  : 0}
                <small>%</small>
              </strong>
            </div>
            <div>
              <span>Entries</span>
              <strong>{report.entries.length}</strong>
            </div>
          </div>
          {view === "summary" && (
            <div className="feature-columns">
              <section className="feature-panel">
                <h3>Time by {report.filters.groupBy ?? "project"}</h3>
                {!report.groups.length ? (
                  <Empty>No time matches these filters.</Empty>
                ) : (
                  report.groups.map((g, i) => (
                    <div key={i} className="feature-breakdown">
                      <div>
                        <strong>{g.name}</strong>
                        <span>
                          {hours(g.durationMs)} h ·{" "}
                          {money(g.amount, g.currency)}
                        </span>
                      </div>
                      <progress
                        max={Math.max(
                          ...report.groups.map((x) => x.durationMs),
                          1,
                        )}
                        value={g.durationMs}
                      />
                    </div>
                  ))
                )}
                {report.filters.groupBy === "tag" && (
                  <p className="feature-help">
                    An entry can appear under multiple tags. Totals count it
                    once.
                  </p>
                )}
              </section>
              <section className="feature-panel">
                <h3>Billing & profitability</h3>
                <p className="feature-help">
                  Time revenue and labor cost. Expenses are listed in Billing.
                </p>
                {report.totals.map((t) => (
                  <div key={t.currency} className="feature-billing-total">
                    <span>{t.currency}</span>
                    <strong>{money(t.amount, t.currency)}</strong>
                    <dl>
                      <dt>Labor cost</dt>
                      <dd>{money(t.cost, t.currency)}</dd>
                      <dt>Time profit</dt>
                      <dd>{money(t.amount - t.cost, t.currency)}</dd>
                      <dt>Tax ({report.branding.taxPercent}%)</dt>
                      <dd>
                        {money(
                          Math.round(t.amount * report.branding.taxPercent) /
                            100,
                          t.currency,
                        )}
                      </dd>
                    </dl>
                  </div>
                ))}
                <p className="feature-help">
                  Rates are captured with each entry. Currency totals stay
                  separate.
                </p>
              </section>
            </div>
          )}
          {view === "details" && (
            <section className="feature-panel">
              {selected.length > 0 && (
                <div className="feature-toolbar">
                  <strong>{selected.length} selected</strong>
                  <input
                    aria-label="Tags for selected entries"
                    className={control}
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                    placeholder="Tags, separated by commas"
                  />
                  <Button
                    disabled={f.busy}
                    onClick={() =>
                      void f.run(async () => {
                        await api("time-entries", "PATCH", {
                          ids: selected,
                          tags: tag
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        });
                        await load();
                      }, "Tags updated")
                    }
                  >
                    Set tags
                  </Button>
                  <Button
                    disabled={f.busy}
                    onClick={() =>
                      void f.run(async () => {
                        await api("time-entries", "PATCH", {
                          ids: selected,
                          billable: true,
                        });
                        await load();
                      }, "Entries marked billable")
                    }
                  >
                    Make billable
                  </Button>
                </div>
              )}
              <div className="feature-table-wrap">
                <table className="feature-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select all entries"
                          checked={
                            report.entries.length > 0 &&
                            selected.length ===
                              Math.min(report.entries.length, 100)
                          }
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? report.entries.slice(0, 100).map((e) => e.id)
                                : [],
                            )
                          }
                        />
                      </th>
                      <th>Date / member</th>
                      <th>Work / project</th>
                      <th>Tags</th>
                      <th>Hours</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.entries.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <input
                            aria-label={`Select ${e.task}`}
                            type="checkbox"
                            checked={selected.includes(e.id)}
                            onChange={(event) =>
                              setSelected(
                                event.target.checked
                                  ? [...selected, e.id].slice(0, 100)
                                  : selected.filter((id) => id !== e.id),
                              )
                            }
                          />
                        </td>
                        <td>
                          {e.date}
                          <small>{e.member}</small>
                        </td>
                        <td>
                          <strong>{e.task}</strong>
                          <small>
                            {e.project} · {e.client}
                          </small>
                          {e.notes && (
                            <small className="feature-notes">{e.notes}</small>
                          )}
                        </td>
                        <td>{e.tags.join(", ") || "—"}</td>
                        <td>{hours(e.roundedMs)}</td>
                        <td>
                          {money(e.amount, e.currency)}
                          <small>
                            {e.invoiced
                              ? "Invoiced"
                              : e.billable
                                ? "Unbilled"
                                : "Non-billable"}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!report.entries.length && (
                <Empty>No entries match this period.</Empty>
              )}
            </section>
          )}
          {view === "weekly" && (
            <section className="feature-panel">
              <h3>Daily time grid</h3>
              <div className="feature-table-wrap">
                <table className="feature-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      {[...new Set(report.entries.map((e) => e.date))].map(
                        (d) => (
                          <th key={d}>{d}</th>
                        ),
                      )}
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...new Set(report.entries.map((e) => e.projectId))].map(
                      (id) => (
                        <tr key={id}>
                          <td>
                            {
                              report.entries.find((e) => e.projectId === id)
                                ?.project
                            }
                          </td>
                          {[...new Set(report.entries.map((e) => e.date))].map(
                            (d) => (
                              <td key={d}>
                                {hours(
                                  report.entries
                                    .filter(
                                      (e) => e.projectId === id && e.date === d,
                                    )
                                    .reduce((s, e) => s + e.roundedMs, 0),
                                )}
                              </td>
                            ),
                          )}
                          <td>
                            {hours(
                              report.entries
                                .filter((e) => e.projectId === id)
                                .reduce((s, e) => s + e.roundedMs, 0),
                            )}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

type Insight = {
  id: string;
  name: string;
  hours: number;
  revenue: number;
  cost: number;
  profit: number | null;
  financials: { currency: string; profit: number }[];
  currency: string;
  budgetUsedPercent: number | null;
  amountUsedPercent: number | null;
  completed_tasks: number;
  total_tasks: number;
};
export function ProjectBudgets({
  projects,
  onChange,
}: {
  projects: Project[];
  onChange: () => Promise<void>;
}) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [id, setId] = useState("");
  const [form, setForm] = useState({
    budgetHours: "0",
    budgetAmount: "0",
    costRate: "0",
    deadline: "",
    notes: "",
  });
  const f = useFeedback();
  useEffect(() => {
    void f.run(async () => setInsights(await api("project-insights")), "");
  }, [projects]);
  const pick = (id: string) => {
    setId(id);
    const p = projects.find((p) => p.id === id);
    if (p)
      setForm({
        budgetHours: String(p.budgetHours ?? 0),
        budgetAmount: String(p.budgetAmount ?? 0),
        costRate: String(p.costRate ?? 0),
        deadline: p.deadline ?? "",
        notes: p.notes ?? "",
      });
  };
  return (
    <section className="feature-panel feature-stack">
      <div>
        <p className="feature-eyebrow">Project health</p>
        <h3>Budgets, costs & delivery</h3>
      </div>
      {f.feedback}
      <div className="feature-table-wrap">
        <table className="feature-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Logged</th>
              <th>Time budget</th>
              <th>Fee budget</th>
              <th>Time profit</th>
              <th>Tasks</th>
            </tr>
          </thead>
          <tbody>
            {insights.map((p) => (
              <tr key={p.id}>
                <td>
                  <button className="feature-link" onClick={() => pick(p.id)}>
                    {p.name}
                  </button>
                </td>
                <td>{p.hours.toFixed(2)} h</td>
                <td>
                  {p.budgetUsedPercent === null ? (
                    "No budget"
                  ) : (
                    <span data-over={p.budgetUsedPercent >= 100}>
                      {Math.round(p.budgetUsedPercent)}% used
                      <progress
                        max={100}
                        value={Math.min(p.budgetUsedPercent, 100)}
                      />
                    </span>
                  )}
                </td>
                <td>
                  {p.amountUsedPercent === null
                    ? p.financials.length > 1
                      ? "Multiple currencies"
                      : "No budget"
                    : `${Math.round(p.amountUsedPercent)}% used`}
                </td>
                <td>
                  {p.financials.length
                    ? p.financials.map((f) => (
                        <div key={f.currency}>
                          {money(f.profit, f.currency)}
                        </div>
                      ))
                    : money(0, p.currency)}
                </td>
                <td>
                  {p.completed_tasks} / {p.total_tasks}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="feature-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void f.run(async () => {
            await api("projects/" + id, "PATCH", {
              budgetHours: Number(form.budgetHours),
              budgetAmount: Number(form.budgetAmount),
              costRate: Number(form.costRate),
              deadline: form.deadline || null,
              notes: form.notes,
            });
            await onChange();
          }, "Project budget saved");
        }}
      >
        <Field label="Configure project">
          <select
            className={control}
            value={id}
            onChange={(e) => pick(e.target.value)}
            required
          >
            <option value="">Select a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {(["budgetHours", "budgetAmount", "costRate", "deadline"] as const).map(
          (k) => (
            <Field
              key={k}
              label={
                {
                  budgetHours: "Hours budget",
                  budgetAmount: "Fee budget",
                  costRate: "Labor cost / hour",
                  deadline: "Deadline",
                }[k]
              }
            >
              <input
                className={control}
                type={k === "deadline" ? "date" : "number"}
                min="0"
                step="0.01"
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </Field>
          ),
        )}
        <Field label="Project notes">
          <input
            className={control}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
        <Button type="submit" disabled={!id || f.busy}>
          Save budget
        </Button>
      </form>
      <p className="feature-help">
        Rate changes apply to future entries. Historical entries retain their
        captured rates.
      </p>
    </section>
  );
}

export function AutomationView({ isAdmin }: { isAdmin: boolean }) {
  const [tokens, setTokens] = useState<
    {
      id: string;
      name: string;
      prefix: string;
      scope: string;
      expires_at: string;
      revoked_at: string | null;
    }[]
  >([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState("read");
  const [days, setDays] = useState("90");
  const [secret, setSecret] = useState("");
  const [catalog, setCatalog] = useState<
    { name: string; description: string; method: string; path: string }[]
  >([]);
  const [search, setSearch] = useState("");
  const [branding, setBranding] = useState<Branding | null>(null);
  const [importText, setImportText] = useState("");
  const [origin, setOrigin] = useState("");
  const f = useFeedback();
  useEffect(() => {
    setOrigin(window.location.origin);
    void f.run(async () => {
      setTokens(await api("tokens"));
      setCatalog(await api("actions"));
      setBranding(await api("branding"));
    }, "");
  }, []);
  return (
    <div className="feature-stack">
      <div className="feature-heading">
        <div>
          <p className="feature-eyebrow">Automation</p>
          <h2>Your workspace, through MCP.</h2>
          <p>Every workspace action has an API endpoint and an MCP tool.</p>
        </div>
        <Code2 size={36} />
      </div>
      {f.feedback}
      <div className="feature-columns">
        <section className="feature-panel feature-stack">
          <h3>Connect an assistant</h3>
          <p className="feature-help">
            Use Streamable HTTP with a personal bearer token. The token inherits
            your workspace role and can be restricted to read access.
          </p>
          <Field label="MCP server URL">
            <input className={control} readOnly value={origin + "/api/mcp"} />
          </Field>
          <pre className="feature-code">
            {JSON.stringify(
              {
                mcpServers: {
                  skytime: {
                    url: origin + "/api/mcp",
                    headers: { Authorization: "Bearer <your-token>" },
                  },
                },
              },
              null,
              2,
            )}
          </pre>
          <a
            className="feature-link"
            href="/api/v1/openapi.json"
            target="_blank"
            rel="noreferrer"
          >
            OpenAPI specification ↗
          </a>
          <p className="feature-help">
            API base: {origin}/api/v1 · JSON responses · Organization-scoped
            credentials
          </p>
        </section>
        <section className="feature-panel feature-stack">
          <h3>
            <KeyRound size={18} />
            Personal access tokens
          </h3>
          <form
            className="feature-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void f.run(async () => {
                const result = await api<{ token: string }>("tokens", "POST", {
                  name,
                  scope,
                  expiresInDays: Number(days),
                });
                setSecret(result.token);
                setTokens(await api("tokens"));
                setName("");
              }, "Token created. Copy it now; it will not be shown again.");
            }}
          >
            <Field label="Token name">
              <input
                className={control}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Codex on my laptop"
                required
              />
            </Field>
            <div className="feature-filters">
              <Field label="Access">
                <select
                  className={control}
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="read">Read only</option>
                  <option value="write">Read and write</option>
                </select>
              </Field>
              <Field label="Expires in days">
                <input
                  className={control}
                  type="number"
                  min="1"
                  max="365"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  required
                />
              </Field>
            </div>
            <Button type="submit" disabled={f.busy}>
              <Plus size={16} />
              Create token
            </Button>
          </form>
          {secret && (
            <div className="feature-secret">
              <Field label="New token — shown once">
                <input className={control} readOnly value={secret} />
              </Field>
              <Button
                onClick={() =>
                  void f.run(
                    () => navigator.clipboard.writeText(secret),
                    "Token copied",
                  )
                }
              >
                Copy token
              </Button>
              <Button onClick={() => setSecret("")}>Dismiss</Button>
            </div>
          )}
          {tokens
            .filter((t) => !t.revoked_at)
            .map((t) => (
              <div className="feature-token" key={t.id}>
                <div>
                  <strong>{t.name}</strong>
                  <small>
                    {t.prefix}… · {t.scope} · expires{" "}
                    {t.expires_at.slice(0, 10)}
                  </small>
                </div>
                <Button
                  disabled={f.busy}
                  onClick={() =>
                    void f.run(async () => {
                      await api("tokens/" + t.id, "DELETE", {});
                      setTokens(await api("tokens"));
                    }, "Token revoked")
                  }
                >
                  Revoke
                </Button>
              </div>
            ))}
        </section>
      </div>
      {isAdmin && branding && (
        <section className="feature-panel feature-stack">
          <h3>Report identity & branding</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void f.run(
                async () =>
                  setBranding(await api("branding", "PATCH", branding)),
                "Branding saved",
              );
            }}
          >
            <div className="feature-filters">
              {(
                [
                  "companyName",
                  "email",
                  "taxId",
                  "currency",
                  "timezone",
                  "taxPercent",
                  "accentColor",
                ] as const
              ).map((k) => (
                <Field
                  key={k}
                  label={
                    {
                      companyName: "Company name",
                      email: "Contact email",
                      taxId: "Tax / business number",
                      currency: "Default currency",
                      timezone: "Report timezone",
                      taxPercent: "Tax percentage",
                      accentColor: "Accent color",
                    }[k]
                  }
                >
                  <input
                    className={control}
                    type={
                      k === "accentColor"
                        ? "color"
                        : k === "taxPercent"
                          ? "number"
                          : "text"
                    }
                    value={branding[k]}
                    onChange={(e) =>
                      setBranding({
                        ...branding,
                        [k]:
                          k === "taxPercent"
                            ? Number(e.target.value)
                            : e.target.value,
                      })
                    }
                  />
                </Field>
              ))}
              <Field label="Logo (PNG or JPEG, max 1 MB)">
                <input
                  className={control}
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void f.run(async () => {
                      if (file.size > 1000000)
                        throw new Error("Choose a logo smaller than 1 MB");
                      const data = await new Promise<string>(
                        (resolve, reject) => {
                          const reader = new FileReader();
                          reader.onload = () => resolve(String(reader.result));
                          reader.onerror = reject;
                          reader.readAsDataURL(file);
                        },
                      );
                      setBranding({ ...branding, logoDataUrl: data });
                    }, "Logo loaded. Save branding to apply it.");
                  }}
                />
              </Field>
            </div>
            <Field label="Business address">
              <textarea
                className={control}
                value={branding.address}
                onChange={(e) =>
                  setBranding({ ...branding, address: e.target.value })
                }
              />
            </Field>
            <Field label="Report footer">
              <textarea
                className={control}
                value={branding.footer}
                onChange={(e) =>
                  setBranding({ ...branding, footer: e.target.value })
                }
              />
            </Field>
            <div className="feature-actions">
              <Button type="submit" disabled={f.busy}>
                Save branding
              </Button>
              <Button
                onClick={() => setBranding({ ...branding, logoDataUrl: null })}
              >
                Use SkyTime logo
              </Button>
            </div>
          </form>
        </section>
      )}
      <section className="feature-panel feature-stack">
        <h3>Import time entries</h3>
        <p className="feature-help">
          Paste a JSON array of up to 100 entries. Each entry needs projectId,
          task, startedAt (ISO timestamp), and durationMs. The whole import
          succeeds or rolls back together.
        </p>
        <textarea
          className={control}
          rows={4}
          aria-label="Time entries JSON"
          placeholder={
            '[{"projectId":"…","task":"Design review","startedAt":"2026-10-01T09:00:00+10:00","durationMs":3600000}]'
          }
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <Button
          disabled={!importText || f.busy}
          onClick={() =>
            void f.run(async () => {
              await api("time-entries/import", "POST", {
                entries: JSON.parse(importText),
              });
              setImportText("");
            }, "Time entries imported")
          }
        >
          Import entries
        </Button>
      </section>
      <section className="feature-panel">
        <div className="feature-toolbar">
          <h3>
            Action directory{" "}
            <span className="feature-count">{catalog.length}</span>
          </h3>
          <input
            className={control}
            aria-label="Search actions"
            placeholder="Find an action…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="feature-table-wrap">
          <table className="feature-table">
            <thead>
              <tr>
                <th>MCP tool</th>
                <th>API endpoint</th>
                <th>What it does</th>
              </tr>
            </thead>
            <tbody>
              {catalog
                .filter((a) =>
                  (a.name + " " + a.description)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((a) => (
                  <tr key={a.name}>
                    <td>
                      <code>{a.name}</code>
                    </td>
                    <td>
                      <span className="feature-method">{a.method}</span>
                      <code>{a.path}</code>
                    </td>
                    <td>{a.description}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

type Expense = {
  id: string;
  description: string;
  project: string;
  date: string;
  amount: string;
  currency: string;
  invoice_id: string | null;
};
type Invoice = {
  id: string;
  number: string;
  client: string;
  status: string;
  total: string;
  currency: string;
  due_date: string;
};
export function BillingView({
  projects,
  clients,
  isAdmin,
}: {
  projects: Project[];
  clients: Client[];
  isAdmin: boolean;
}) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expense, setExpense] = useState({
    projectId: "",
    date: today(),
    description: "",
    category: "Travel",
    amount: "",
    currency: "AUD",
    billable: true,
  });
  const [invoice, setInvoice] = useState({
    clientId: "",
    number: "",
    from: today().slice(0, 8) + "01",
    to: today(),
    issuedDate: today(),
    dueDate: dayOffset(30),
    taxPercent: "10",
    notes: "",
  });
  const f = useFeedback();
  async function load() {
    setExpenses(await api("expenses"));
    if (isAdmin) setInvoices(await api("invoices"));
  }
  useEffect(() => {
    void f.run(load, "");
  }, []);
  return (
    <div className="feature-stack">
      <div className="feature-heading">
        <div>
          <p className="feature-eyebrow">Billing</p>
          <h2>From recorded work to invoice.</h2>
          <p>
            Track expenses, invoice unbilled work, and keep an accurate billing
            history.
          </p>
        </div>
      </div>
      {f.feedback}
      <div className="feature-columns">
        <section className="feature-panel feature-stack">
          <h3>Record an expense</h3>
          <form
            className="feature-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void f.run(async () => {
                await api("expenses", "POST", {
                  ...expense,
                  amount: Number(expense.amount),
                });
                setExpense({ ...expense, description: "", amount: "" });
                await load();
              }, "Expense recorded");
            }}
          >
            <Field label="Expense project">
              <select
                className={control}
                required
                value={expense.projectId}
                onChange={(e) => {
                  const p = projects.find((p) => p.id === e.target.value);
                  setExpense({
                    ...expense,
                    projectId: e.target.value,
                    currency:
                      clients.find((c) => c.id === p?.clientId)?.currency ??
                      "AUD",
                  });
                }}
              >
                <option value="">Select project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description">
              <input
                className={control}
                value={expense.description}
                onChange={(e) =>
                  setExpense({ ...expense, description: e.target.value })
                }
                required
              />
            </Field>
            <div className="feature-filters">
              <Field label="Expense date">
                <input
                  type="date"
                  className={control}
                  value={expense.date}
                  onChange={(e) =>
                    setExpense({ ...expense, date: e.target.value })
                  }
                  required
                />
              </Field>
              <Field label="Category">
                <select
                  className={control}
                  value={expense.category}
                  onChange={(e) =>
                    setExpense({ ...expense, category: e.target.value })
                  }
                >
                  {["Travel", "Meals", "Software", "Materials", "Other"].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="Amount">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className={control}
                  value={expense.amount}
                  onChange={(e) =>
                    setExpense({ ...expense, amount: e.target.value })
                  }
                  required
                />
              </Field>
              <Field label="Currency">
                <input
                  className={control}
                  maxLength={3}
                  value={expense.currency}
                  onChange={(e) =>
                    setExpense({
                      ...expense,
                      currency: e.target.value.toUpperCase(),
                    })
                  }
                  required
                />
              </Field>
            </div>
            <label>
              <input
                type="checkbox"
                checked={expense.billable}
                onChange={(e) =>
                  setExpense({ ...expense, billable: e.target.checked })
                }
              />{" "}
              Billable to client
            </label>
            <Button type="submit" disabled={f.busy}>
              Record expense
            </Button>
          </form>
        </section>
        {isAdmin && (
          <section className="feature-panel feature-stack">
            <h3>Create an invoice</h3>
            <p className="feature-help">
              Includes all unbilled time and billable expenses for this client
              and period. Creating a draft reserves those items.
            </p>
            <form
              className="feature-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void f.run(async () => {
                  await api("invoices", "POST", {
                    ...invoice,
                    taxPercent: Number(invoice.taxPercent),
                  });
                  await load();
                }, "Draft invoice created");
              }}
            >
              <Field label="Invoice client">
                <select
                  className={control}
                  required
                  value={invoice.clientId}
                  onChange={(e) =>
                    setInvoice({ ...invoice, clientId: e.target.value })
                  }
                >
                  <option value="">Select client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="feature-filters">
                {(
                  [
                    "number",
                    "from",
                    "to",
                    "issuedDate",
                    "dueDate",
                    "taxPercent",
                  ] as const
                ).map((k) => (
                  <Field
                    key={k}
                    label={
                      {
                        number: "Invoice number",
                        from: "Period from",
                        to: "Period to",
                        issuedDate: "Issue date",
                        dueDate: "Due date",
                        taxPercent: "Tax %",
                      }[k]
                    }
                  >
                    <input
                      className={control}
                      type={
                        k === "number"
                          ? "text"
                          : k === "taxPercent"
                            ? "number"
                            : "date"
                      }
                      required
                      value={invoice[k]}
                      onChange={(e) =>
                        setInvoice({ ...invoice, [k]: e.target.value })
                      }
                    />
                  </Field>
                ))}
              </div>
              <Field label="Payment instructions / notes">
                <textarea
                  className={control}
                  value={invoice.notes}
                  onChange={(e) =>
                    setInvoice({ ...invoice, notes: e.target.value })
                  }
                />
              </Field>
              <Button type="submit" disabled={f.busy}>
                Create draft invoice
              </Button>
            </form>
          </section>
        )}
      </div>
      {isAdmin && (
        <section className="feature-panel">
          <h3>Invoices</h3>
          {!invoices.length ? (
            <Empty>Create your first invoice from recorded client work.</Empty>
          ) : (
            <div className="feature-table-wrap">
              <table className="feature-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Client</th>
                    <th>Due</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <strong>{i.number}</strong>
                      </td>
                      <td>{i.client}</td>
                      <td>{i.due_date.slice(0, 10)}</td>
                      <td>{money(Number(i.total), i.currency)}</td>
                      <td>
                        <span className="feature-status">{i.status}</span>
                      </td>
                      <td>
                        <div className="feature-actions">
                          <Button
                            onClick={() =>
                              void f.run(
                                () =>
                                  download(
                                    `invoices/${i.id}/pdf`,
                                    "skytime-invoice.pdf",
                                  ),
                                "Invoice downloaded",
                              )
                            }
                          >
                            PDF
                          </Button>
                          {(i.status === "draft" || i.status === "issued") && (
                            <>
                              <Button
                                disabled={f.busy}
                                onClick={() =>
                                  void f.run(async () => {
                                    await api("invoices/" + i.id, "PATCH", {
                                      status:
                                        i.status === "draft"
                                          ? "issued"
                                          : "paid",
                                    });
                                    await load();
                                  }, "Invoice updated")
                                }
                              >
                                {i.status === "draft"
                                  ? "Mark issued"
                                  : "Mark paid"}
                              </Button>
                              <Button
                                disabled={f.busy}
                                onClick={() =>
                                  void f.run(async () => {
                                    await api("invoices/" + i.id, "PATCH", {
                                      status: "void",
                                    });
                                    await load();
                                  }, "Invoice voided; items released")
                                }
                              >
                                Void
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <section className="feature-panel">
        <h3>Expenses</h3>
        {!expenses.length ? (
          <Empty>No expenses yet. Record a project cost above.</Empty>
        ) : (
          <div className="feature-table-wrap">
            <table className="feature-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Expense</th>
                  <th>Project</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td>{e.date.slice(0, 10)}</td>
                    <td>{e.description}</td>
                    <td>{e.project}</td>
                    <td>{money(Number(e.amount), e.currency)}</td>
                    <td>{e.invoice_id ? "Invoiced" : "Unbilled"}</td>
                    <td>
                      {!e.invoice_id && (
                        <Button
                          disabled={f.busy}
                          onClick={() =>
                            void f.run(async () => {
                              await api("expenses/" + e.id, "DELETE", {});
                              await load();
                            }, "Expense removed")
                          }
                        >
                          <Trash2 size={14} />
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

type Workload = {
  id: string;
  name: string;
  weeklyCapacity: number;
  available: number;
  planned: number;
  tracked: number;
  leaveHours: number;
  remaining: number;
  utilization: number | null;
};
type Allocation = {
  id: string;
  project: string;
  member: string;
  date: string;
  hours: number;
  note: string;
};
type Leave = {
  id: string;
  member: string;
  start_date: string;
  end_date: string;
  status: string;
  note: string;
};
export function PlanningView({
  projects,
  isAdmin,
}: {
  projects: Project[];
  isAdmin: boolean;
}) {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(dayOffset(6));
  const [workload, setWorkload] = useState<Workload[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [leave, setLeave] = useState<Leave[]>([]);
  const [schedule, setSchedule] = useState({
    projectId: "",
    userId: "",
    date: today(),
    hours: "4",
    note: "",
  });
  const [request, setRequest] = useState({
    from: today(),
    to: today(),
    note: "",
  });
  const [memberId, setMemberId] = useState("");
  const [capacity, setCapacity] = useState("40");
  const f = useFeedback();
  async function load() {
    const [w, a, l] = await Promise.all([
      api<Workload[]>("workload?" + queryString({ from, to })),
      api<Allocation[]>("allocations"),
      api<Leave[]>("time-off"),
    ]);
    setWorkload(w);
    setAllocations(a);
    setLeave(l);
  }
  useEffect(() => {
    void f.run(load, "");
  }, []);
  return (
    <div className="feature-stack">
      <div className="feature-heading">
        <div>
          <p className="feature-eyebrow">Planning</p>
          <h2>Make room for the next project.</h2>
          <p>
            See planned hours, actual work, and available capacity after time
            off.
          </p>
        </div>
      </div>
      {f.feedback}
      <form
        className="feature-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void f.run(load, "Capacity updated");
        }}
      >
        <div className="feature-actions">
          <Field label="Planning from">
            <input
              className={control}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              required
            />
          </Field>
          <Field label="Planning to">
            <input
              className={control}
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
          </Field>
        </div>
        <Button type="submit" disabled={f.busy}>
          Update period
        </Button>
      </form>
      <section className="feature-panel">
        <h3>Team capacity</h3>
        <div className="feature-table-wrap">
          <table className="feature-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Available</th>
                <th>Planned</th>
                <th>Actual</th>
                <th>Remaining</th>
                <th>Billable utilization</th>
              </tr>
            </thead>
            <tbody>
              {workload.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.name}</strong>
                    <small>
                      {m.weeklyCapacity} h / week · {m.leaveHours.toFixed(1)} h
                      leave
                    </small>
                  </td>
                  <td>{m.available.toFixed(1)} h</td>
                  <td>
                    {m.planned.toFixed(1)} h
                    <progress
                      max={Math.max(m.available, m.planned, 1)}
                      value={m.planned}
                    />
                  </td>
                  <td>{m.tracked.toFixed(1)} h</td>
                  <td>
                    <span data-over={m.remaining < 0}>
                      {m.remaining < 0
                        ? `${Math.abs(m.remaining).toFixed(1)} h overbooked`
                        : `${m.remaining.toFixed(1)} h free`}
                    </span>
                  </td>
                  <td>
                    {m.utilization === null
                      ? "—"
                      : `${Math.round(m.utilization)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="feature-help">
          Capacity is spread evenly over Monday–Friday. Approved leave reduces
          availability. Public holidays are not deducted automatically.
        </p>
      </section>
      <div className="feature-columns">
        {isAdmin && (
          <section className="feature-panel feature-stack">
            <h3>Schedule work</h3>
            <form
              className="feature-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void f.run(async () => {
                  await api("allocations", "POST", {
                    ...schedule,
                    hours: Number(schedule.hours),
                  });
                  await load();
                }, "Work scheduled");
              }}
            >
              <div className="feature-filters">
                <Field label="Scheduled project">
                  <select
                    className={control}
                    required
                    value={schedule.projectId}
                    onChange={(e) =>
                      setSchedule({ ...schedule, projectId: e.target.value })
                    }
                  >
                    <option value="">Choose project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Assign member">
                  <select
                    className={control}
                    required
                    value={schedule.userId}
                    onChange={(e) =>
                      setSchedule({ ...schedule, userId: e.target.value })
                    }
                  >
                    <option value="">Choose member</option>
                    {workload.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Scheduled date">
                  <input
                    className={control}
                    required
                    type="date"
                    value={schedule.date}
                    onChange={(e) =>
                      setSchedule({ ...schedule, date: e.target.value })
                    }
                  />
                </Field>
                <Field label="Planned hours">
                  <input
                    className={control}
                    required
                    type="number"
                    min="0.25"
                    max="24"
                    step="0.25"
                    value={schedule.hours}
                    onChange={(e) =>
                      setSchedule({ ...schedule, hours: e.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label="Schedule note">
                <input
                  className={control}
                  value={schedule.note}
                  onChange={(e) =>
                    setSchedule({ ...schedule, note: e.target.value })
                  }
                />
              </Field>
              <Button type="submit" disabled={f.busy}>
                Schedule work
              </Button>
            </form>
          </section>
        )}
        <section className="feature-panel feature-stack">
          <h3>Request time off</h3>
          <form
            className="feature-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void f.run(async () => {
                await api("time-off", "POST", request);
                await load();
              }, "Time off requested");
            }}
          >
            <div className="feature-filters">
              <Field label="Leave from">
                <input
                  className={control}
                  required
                  type="date"
                  value={request.from}
                  onChange={(e) =>
                    setRequest({ ...request, from: e.target.value })
                  }
                />
              </Field>
              <Field label="Leave to">
                <input
                  className={control}
                  required
                  type="date"
                  value={request.to}
                  onChange={(e) =>
                    setRequest({ ...request, to: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Leave note">
              <input
                className={control}
                value={request.note}
                onChange={(e) =>
                  setRequest({ ...request, note: e.target.value })
                }
              />
            </Field>
            <Button type="submit" disabled={f.busy}>
              Request leave
            </Button>
          </form>
        </section>
      </div>
      {isAdmin && (
        <form
          className="feature-panel feature-filters"
          onSubmit={(e) => {
            e.preventDefault();
            void f.run(async () => {
              await api("members/" + memberId, "PATCH", {
                weeklyCapacity: Number(capacity),
              });
              await load();
            }, "Member capacity saved");
          }}
        >
          <Field label="Member capacity">
            <select
              className={control}
              value={memberId}
              required
              onChange={(e) => {
                setMemberId(e.target.value);
                setCapacity(
                  String(
                    workload.find((m) => m.id === e.target.value)
                      ?.weeklyCapacity ?? 40,
                  ),
                );
              }}
            >
              <option value="">Choose member</option>
              {workload.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Weekly working hours">
            <input
              className={control}
              type="number"
              min="0"
              max="168"
              step="0.5"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={f.busy}>
            Save capacity
          </Button>
        </form>
      )}
      <section className="feature-panel">
        <h3>Scheduled work</h3>
        {!allocations.length ? (
          <Empty>Schedule project hours to see upcoming commitments.</Empty>
        ) : (
          <div className="feature-table-wrap">
            <table className="feature-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Project</th>
                  <th>Member</th>
                  <th>Hours</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {allocations.map((a) => (
                  <tr key={a.id}>
                    <td>{a.date.slice(0, 10)}</td>
                    <td>
                      {a.project}
                      <small>{a.note}</small>
                    </td>
                    <td>{a.member}</td>
                    <td>{Number(a.hours).toFixed(1)}</td>
                    <td>
                      {isAdmin && (
                        <Button
                          onClick={() =>
                            void f.run(async () => {
                              await api("allocations/" + a.id, "DELETE", {});
                              await load();
                            }, "Allocation removed")
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="feature-panel">
        <h3>Time-off requests</h3>
        {!leave.length ? (
          <Empty>No time-off requests.</Empty>
        ) : (
          <div className="feature-table-wrap">
            <table className="feature-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Dates</th>
                  <th>Note</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {leave.map((l) => (
                  <tr key={l.id}>
                    <td>{l.member}</td>
                    <td>
                      {l.start_date.slice(0, 10)} — {l.end_date.slice(0, 10)}
                    </td>
                    <td>{l.note}</td>
                    <td>{l.status}</td>
                    <td>
                      <div className="feature-actions">
                        {isAdmin &&
                          l.status === "pending" &&
                          (["approved", "rejected"] as const).map((status) => (
                            <Button
                              key={status}
                              disabled={f.busy}
                              onClick={() =>
                                void f.run(async () => {
                                  await api("time-off/" + l.id, "PATCH", {
                                    status,
                                  });
                                  await load();
                                }, `Leave ${status}`)
                              }
                            >
                              {status === "approved" ? "Approve" : "Reject"}
                            </Button>
                          ))}
                        <Button
                          disabled={f.busy}
                          onClick={() =>
                            void f.run(async () => {
                              await api("time-off/" + l.id, "DELETE", {});
                              await load();
                            }, "Request cancelled")
                          }
                        >
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
