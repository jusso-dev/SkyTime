"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  DndContext,
  type DragEndEvent,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import {
  AlarmClock,
  AlertTriangle,
  ArrowDownToLine,
  Bell,
  BriefcaseBusiness,
  Bug,
  Building2,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardCheck,
  Clock3,
  Copy,
  Code2,
  Edit3,
  Ellipsis,
  FileText,
  Fingerprint,
  FolderPlus,
  History,
  KeyRound,
  LayoutDashboard,
  Lock,
  Moon,
  Pause,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  SquareKanban,
  Sun,
  TimerReset,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import {
  ReportsView,
  AutomationView,
  BillingView,
  ProjectBudgets,
  PlanningView,
} from "@/components/workspace-features";
import { cn } from "@/lib/utils";
import { loadGooglePlaces } from "@/lib/google-places";
import type {
  AuditLogEntry,
  BoardStatus,
  BoardTask,
  Client,
  ErrorLogEntry,
  OrganizationInvite,
  Project,
  ReminderSettings,
  TimeEntry,
  TimesheetPeriod,
  WorkspacePayload,
} from "@/lib/workspace-types";

type TimerState = {
  id?: string;
  running: boolean;
  startedAt?: string;
  projectId: string;
  task: string;
  notes: string;
  billable: boolean;
};

type PeriodPreset = "today" | "week" | "month" | "fy" | "annual" | "custom";

type ManualEntryForm = {
  projectId: string;
  task: string;
  date: string;
  duration: string;
  notes: string;
  billable: boolean;
};

type NewProjectForm = {
  name: string;
  client: string;
  clientId: string;
  rate: string;
};

type NewClientForm = {
  name: string;
  contactName: string;
  contactEmail: string;
  address: string;
  currency: string;
  defaultRate: string;
  notes: string;
};

type NewTaskForm = {
  projectId: string;
  title: string;
  estimateHours: string;
};

type AuthState =
  | { kind: "signed-out" }
  | { kind: "needs-org"; user: WorkspacePayload["user"] }
  | { kind: "workspace"; data: WorkspacePayload };

type AuthForm = {
  email: string;
  password: string;
  organizationName: string;
};

type MfaState = {
  signInRequired: boolean;
  signInCode: string;
  signInBackupCode: string;
  signInUseBackupCode: boolean;
  trustDevice: boolean;
  enablePassword: string;
  disablePassword: string;
  setupCode: string;
  setupTotpUri: string;
  backupCodes: string[];
  busy: boolean;
};

type ThemeMode = "light" | "dark";

type ToastTone = "success" | "error" | "info";

type ToastMessage = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ConfirmState = {
  title: string;
  message: string;
  actionLabel: string;
  onConfirm: () => void | Promise<void>;
};

type ProjectTotal = {
  project: Project;
  currency: string;
  durationMs: number;
  billableMs: number;
  amountExGst: number;
  gst: number;
  amountIncGst: number;
};

const AU_GST_RATE = 0.1;
const AU_GST_LABEL = "AU GST 10%";

const columns: BoardStatus[] = ["Backlog", "Today", "Doing", "Done"];

const projectColors = [
  "oklch(0.56 0.13 155)",
  "oklch(0.56 0.11 225)",
  "oklch(0.66 0.12 65)",
  "oklch(0.55 0.12 28)",
];

const initialTimer: TimerState = {
  running: false,
  projectId: "",
  task: "",
  notes: "",
  billable: true,
};

function useStoredState<T>(key: string, initialValue: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") {
      return typeof initialValue === "function"
        ? (initialValue as () => T)()
        : initialValue;
    }

    const stored = window.localStorage.getItem(key);
    if (!stored) {
      return typeof initialValue === "function"
        ? (initialValue as () => T)()
        : initialValue;
    }

    try {
      return JSON.parse(stored) as T;
    } catch {
      return typeof initialValue === "function"
        ? (initialValue as () => T)()
        : initialValue;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

export function SkyTimeWorkspace({
  initialState,
}: {
  initialState: AuthState;
}) {
  const [activeView, setActiveView] = useState("dashboard");
  const initialWorkspace =
    initialState.kind === "workspace" ? initialState.data : null;
  const [authState, setAuthState] = useState(initialState);
  const [projects, setProjects] = useState<Project[]>(
    initialWorkspace?.projects ?? [],
  );
  const [entries, setEntries] = useState<TimeEntry[]>(
    initialWorkspace?.entries ?? [],
  );
  const [tasks, setTasks] = useState<BoardTask[]>(
    initialWorkspace?.tasks ?? [],
  );
  const [clients, setClients] = useState<Client[]>(
    initialWorkspace?.clients ?? [],
  );
  const [currentPeriod, setCurrentPeriod] = useState<TimesheetPeriod | null>(
    initialWorkspace?.currentPeriod ?? null,
  );
  const [periods, setPeriods] = useState<TimesheetPeriod[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [errorLog, setErrorLog] = useState<ErrorLogEntry[]>([]);
  const [submitNote, setSubmitNote] = useState("");
  const [newClient, setNewClient] = useState<NewClientForm>({
    name: "",
    contactName: "",
    contactEmail: "",
    address: "",
    currency: "AUD",
    defaultRate: "0",
    notes: "",
  });
  const [timer, setTimer] = useState<TimerState>(initialTimer);
  const [legacyTimer, setLegacyTimer] = useState<{
    value: TimerState & { startedAt: string };
    stored: string;
  } | null>(null);
  const [recoveringTimer, setRecoveringTimer] = useState(false);
  const timerRevision = useRef(0);
  const timerBusy = useRef(false);
  const [reminders, setReminders] = useState<ReminderSettings>(
    initialWorkspace?.settings.reminders ?? {
      enabled: false,
      cadenceMinutes: 60,
    },
  );
  const [fyStartMonth, setFyStartMonth] = useState(
    initialWorkspace?.settings.fyStartMonth ?? 7,
  );
  const [period, setPeriod] = useState<PeriodPreset>("month");
  const [customStart, setCustomStart] = useState(
    toDateInput(startOfMonth(new Date())),
  );
  const [customEnd, setCustomEnd] = useState(toDateInput(endOfDay(new Date())));
  const [now, setNow] = useState(() => new Date());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [theme, setTheme] = useStoredState<ThemeMode>("skytime-theme", "light");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [isAuthPending, startAuthTransition] = useTransition();
  const [newProject, setNewProject] = useState<NewProjectForm>({
    name: "",
    client: "",
    clientId: "",
    rate: "120",
  });
  const [manualEntry, setManualEntry] = useState({
    projectId: "",
    task: "",
    date: toDateInput(new Date()),
    duration: "1.0",
    notes: "",
    billable: true,
  });
  const [taskForm, setTaskForm] = useState<NewTaskForm>({
    projectId: "",
    title: "",
    estimateHours: "1",
  });
  const [authForm, setAuthForm] = useState<AuthForm>({
    email: "",
    password: "",
    organizationName: "",
  });
  const [mfa, setMfa] = useState<MfaState>({
    signInRequired: false,
    signInCode: "",
    signInBackupCode: "",
    signInUseBackupCode: false,
    trustDevice: true,
    enablePassword: "",
    disablePassword: "",
    setupCode: "",
    setupTotpUri: "",
    backupCodes: [],
    busy: false,
  });
  const [invites, setInvites] = useState<OrganizationInvite[]>([]);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    role: "member" as "admin" | "member",
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!initialWorkspace) return;
    const firstProjectId = initialWorkspace.projects[0]?.id ?? "";
    setTimer((current) => ({
      ...current,
      projectId: current.projectId || firstProjectId,
    }));
    setManualEntry((current) => ({
      ...current,
      projectId: current.projectId || firstProjectId,
    }));
    setTaskForm((current) => ({
      ...current,
      projectId: current.projectId || firstProjectId,
    }));
  }, [initialWorkspace, setTimer]);

  useEffect(() => {
    if (activeView === "settings") {
      loadInvites();
    }
    if (activeView === "approvals") {
      loadPeriods();
    }
    if (activeView === "audit") {
      loadAuditLog();
    }
    if (activeView === "errors") {
      loadErrorLog();
    }
  }, [activeView]);

  useEffect(() => {
    if (authState.kind === "needs-org") {
      void acceptPendingInvite();
    }
  }, [authState.kind]);

  async function acceptPendingInvite() {
    const inviteId = getPendingInviteId();
    if (!inviteId) return false;

    try {
      await api("/api/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ inviteId }),
      });
      window.history.replaceState(null, "", window.location.pathname);
      showToast("Invite accepted", "success");
      await loadWorkspace();
      return true;
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Invite could not be accepted",
        "error",
      );
      return false;
    }
  }

  async function loadWorkspace() {
    try {
      setLoading(true);
      setLoadError("");
      const data = await api<WorkspacePayload>("/api/workspace");
      setAuthState({ kind: "workspace", data });
      setProjects(data.projects);
      setEntries(data.entries);
      setTasks(data.tasks);
      setClients(data.clients);
      setCurrentPeriod(data.currentPeriod);
      setReminders(data.settings.reminders);
      setFyStartMonth(data.settings.fyStartMonth);

      const firstProjectId = data.projects[0]?.id ?? "";
      setTimer((current) => ({
        ...current,
        projectId: current.projectId || firstProjectId,
      }));
      setManualEntry((current) => ({
        ...current,
        projectId: current.projectId || firstProjectId,
      }));
      setTaskForm((current) => ({
        ...current,
        projectId: current.projectId || firstProjectId,
      }));
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.data?.needsOrganization &&
        error.data.user
      ) {
        setAuthState({
          kind: "needs-org",
          user: error.data.user as WorkspacePayload["user"],
        });
        return;
      }
      setLoadError(
        error instanceof Error ? error.message : "Could not load workspace",
      );
    } finally {
      setLoading(false);
    }
  }

  async function submitAuth() {
    startAuthTransition(() => {
      void (async () => {
        try {
          setLoadError("");
          const result = await api<{
            twoFactorRedirect?: boolean;
            twoFactorMethods?: string[];
          }>("/api/auth/sign-in/email", {
            method: "POST",
            body: JSON.stringify({
              email: authForm.email,
              password: authForm.password,
            }),
          });
          if (result.twoFactorRedirect) {
            setMfa((current) => ({
              ...current,
              signInRequired: true,
              signInCode: "",
              signInBackupCode: "",
            }));
            return;
          }
          if (await acceptPendingInvite()) return;
          await loadWorkspace();
        } catch (error) {
          setLoadError(
            error instanceof Error ? error.message : "Authentication failed",
          );
        }
      })();
    });
  }

  async function signInWithPasskey() {
    startAuthTransition(() => {
      void (async () => {
        try {
          setLoadError("");
          const result = await authClient.signIn.passkey();
          if (result.error) {
            setLoadError(result.error.message || "Passkey sign-in failed");
            return;
          }
          if (await acceptPendingInvite()) return;
          await loadWorkspace();
        } catch (error) {
          setLoadError(
            error instanceof Error ? error.message : "Passkey sign-in failed",
          );
        }
      })();
    });
  }

  async function verifyMfaSignIn() {
    const code = mfa.signInUseBackupCode
      ? mfa.signInBackupCode.trim()
      : mfa.signInCode.trim();
    if (!code) {
      setLoadError("Enter your verification code");
      return;
    }

    startAuthTransition(() => {
      void (async () => {
        try {
          setLoadError("");
          const endpoint = mfa.signInUseBackupCode
            ? "/api/auth/two-factor/verify-backup-code"
            : "/api/auth/two-factor/verify-totp";
          await api(endpoint, {
            method: "POST",
            body: JSON.stringify({ code, trustDevice: mfa.trustDevice }),
          });
          setMfa((current) => ({
            ...current,
            signInRequired: false,
            signInCode: "",
            signInBackupCode: "",
          }));
          if (await acceptPendingInvite()) return;
          await loadWorkspace();
        } catch (error) {
          setLoadError(
            error instanceof Error ? error.message : "MFA verification failed",
          );
        }
      })();
    });
  }

  async function startMfaSetup() {
    if (!mfa.enablePassword) {
      showToast("Enter your password to set up MFA", "error");
      return;
    }

    try {
      setMfa((current) => ({ ...current, busy: true }));
      const result = await api<{ totpURI: string; backupCodes: string[] }>(
        "/api/auth/two-factor/enable",
        {
          method: "POST",
          body: JSON.stringify({
            password: mfa.enablePassword,
            issuer: "SkyTime",
          }),
        },
      );
      setMfa((current) => ({
        ...current,
        setupTotpUri: result.totpURI,
        backupCodes: result.backupCodes,
        setupCode: "",
        busy: false,
      }));
      showToast("MFA setup started", "success");
    } catch (error) {
      setMfa((current) => ({ ...current, busy: false }));
      showToast(
        error instanceof Error
          ? error.message
          : "MFA setup could not be started",
        "error",
      );
    }
  }

  async function verifyMfaSetup() {
    if (!mfa.setupCode.trim()) {
      showToast("Enter the code from your authenticator app", "error");
      return;
    }

    try {
      setMfa((current) => ({ ...current, busy: true }));
      await api("/api/auth/two-factor/verify-totp", {
        method: "POST",
        body: JSON.stringify({ code: mfa.setupCode.trim() }),
      });
      setAuthState((current) =>
        current.kind === "workspace"
          ? {
              ...current,
              data: {
                ...current.data,
                user: { ...current.data.user, twoFactorEnabled: true },
              },
            }
          : current,
      );
      setMfa((current) => ({
        ...current,
        enablePassword: "",
        setupCode: "",
        setupTotpUri: "",
        busy: false,
      }));
      showToast("MFA enabled", "success");
    } catch (error) {
      setMfa((current) => ({ ...current, busy: false }));
      showToast(
        error instanceof Error ? error.message : "MFA verification failed",
        "error",
      );
    }
  }

  async function disableMfa() {
    if (!mfa.disablePassword) {
      showToast("Enter your password to disable MFA", "error");
      return;
    }

    askConfirm({
      title: "Disable MFA?",
      message:
        "Your account will only be protected by its password after this change.",
      actionLabel: "Disable MFA",
      onConfirm: async () => {
        try {
          setMfa((current) => ({ ...current, busy: true }));
          await api("/api/auth/two-factor/disable", {
            method: "POST",
            body: JSON.stringify({ password: mfa.disablePassword }),
          });
          setAuthState((current) =>
            current.kind === "workspace"
              ? {
                  ...current,
                  data: {
                    ...current.data,
                    user: { ...current.data.user, twoFactorEnabled: false },
                  },
                }
              : current,
          );
          setMfa((current) => ({
            ...current,
            disablePassword: "",
            backupCodes: [],
            setupTotpUri: "",
            busy: false,
          }));
          showToast("MFA disabled", "success");
        } catch (error) {
          setMfa((current) => ({ ...current, busy: false }));
          showToast(
            error instanceof Error
              ? error.message
              : "MFA could not be disabled",
            "error",
          );
        }
      },
    });
  }

  async function regenerateBackupCodes() {
    if (!mfa.enablePassword) {
      showToast("Enter your password to regenerate backup codes", "error");
      return;
    }

    try {
      setMfa((current) => ({ ...current, busy: true }));
      const result = await api<{ backupCodes: string[] }>(
        "/api/auth/two-factor/generate-backup-codes",
        {
          method: "POST",
          body: JSON.stringify({ password: mfa.enablePassword }),
        },
      );
      setMfa((current) => ({
        ...current,
        backupCodes: result.backupCodes,
        enablePassword: "",
        busy: false,
      }));
      showToast("Backup codes regenerated", "success");
    } catch (error) {
      setMfa((current) => ({ ...current, busy: false }));
      showToast(
        error instanceof Error
          ? error.message
          : "Backup codes could not be regenerated",
        "error",
      );
    }
  }

  async function createOrganization() {
    startAuthTransition(() => {
      void (async () => {
        try {
          setLoadError("");
          await api("/api/organizations", {
            method: "POST",
            body: JSON.stringify({ name: authForm.organizationName }),
          });
          await loadWorkspace();
        } catch (error) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Organization could not be created",
          );
        }
      })();
    });
  }

  async function loadInvites() {
    if (
      authState.kind !== "workspace" ||
      authState.data.organization.role !== "admin"
    )
      return;
    try {
      setInvites(await api<OrganizationInvite[]>("/api/invitations"));
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Invites could not be loaded",
        "error",
      );
    }
  }

  async function createInvite() {
    try {
      const invite = await api<OrganizationInvite>("/api/invitations", {
        method: "POST",
        body: JSON.stringify(inviteForm),
      });
      setInvites((current) => [
        invite,
        ...current.filter((item) => item.id !== invite.id),
      ]);
      setInviteForm({ email: "", role: "member" });
      showToast(
        invite.emailSent
          ? "Invite sent"
          : "Invite created. Email did not send.",
        invite.emailSent ? "success" : "info",
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Invite could not be created",
        "error",
      );
    }
  }

  async function revokeInvite(id: string) {
    const invite = invites.find((item) => item.id === id);
    askConfirm({
      title: "Revoke invite?",
      message: invite
        ? `${invite.email} will no longer be able to join this organization from that invite.`
        : "This invite will be revoked.",
      actionLabel: "Revoke invite",
      onConfirm: async () => {
        try {
          await api(`/api/invitations/${id}`, { method: "DELETE" });
          setInvites((current) =>
            current.map((invite) =>
              invite.id === id ? { ...invite, status: "revoked" } : invite,
            ),
          );
          showToast("Invite revoked", "success");
        } catch (error) {
          showToast(
            error instanceof Error
              ? error.message
              : "Invite could not be revoked",
            "error",
          );
        }
      },
    });
  }

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!reminders.enabled) return;

    const cadenceMs = reminders.cadenceMinutes * 60 * 1000;
    const id = window.setInterval(
      () => {
        const lastSent = reminders.lastSentAt
          ? new Date(reminders.lastSentAt).getTime()
          : 0;
        if (Date.now() - lastSent < cadenceMs) return;

        sendReminder(
          "Track the last hour",
          "Add a quick SkyTime entry while the work is still fresh.",
        );
        const next = { ...reminders, lastSentAt: new Date().toISOString() };
        setReminders(next);
        saveSettings({ reminders: next });
      },
      Math.min(cadenceMs, 60 * 1000),
    );

    return () => window.clearInterval(id);
  }, [
    reminders.enabled,
    reminders.cadenceMinutes,
    reminders.lastSentAt,
    setReminders,
  ]);

  const activeProject =
    projects.find((project) => project.id === timer.projectId) ?? projects[0];
  const elapsedMs =
    timer.running && timer.startedAt
      ? now.getTime() - new Date(timer.startedAt).getTime()
      : 0;
  const periodRange = useMemo(
    () => getPeriodRange(period, fyStartMonth, customStart, customEnd),
    [customEnd, customStart, fyStartMonth, period],
  );
  const filteredEntries = useMemo(
    () =>
      entries.filter((entry) =>
        isInsideRange(
          new Date(entry.startedAt),
          periodRange.start,
          periodRange.end,
        ),
      ),
    [entries, periodRange],
  );
  const totals = useMemo(
    () => getTotals(filteredEntries, projects),
    [filteredEntries, projects],
  );
  const todayMs = useMemo(() => {
    const range = getPeriodRange("today", fyStartMonth, customStart, customEnd);
    return entries
      .filter((entry) =>
        isInsideRange(new Date(entry.startedAt), range.start, range.end),
      )
      .reduce((sum, entry) => sum + entry.durationMs, 0);
  }, [customEnd, customStart, entries, fyStartMonth]);

  useEffect(() => {
    if (authState.kind !== "workspace") return;
    try {
      const stored = window.localStorage.getItem("skytime-timer");
      const value = stored ? JSON.parse(stored) : null;
      // Old timers were browser-wide. Offer recovery only in the workspace
      // containing their project, and leave the original untouched until saved.
      if (
        stored &&
        value?.running === true &&
        typeof value.startedAt === "string" &&
        Number.isFinite(Date.parse(value.startedAt)) &&
        typeof value.task === "string" &&
        typeof value.notes === "string" &&
        typeof value.billable === "boolean" &&
        projects.some((project) => project.id === value.projectId)
      ) {
        setLegacyTimer({ value, stored });
      } else setLegacyTimer(null);
    } catch {
      // Keep malformed or inaccessible browser data available for recovery.
    }
  }, [authState.kind, projects]);

  async function recoverLegacyTimer() {
    if (!legacyTimer || timerBusy.current) return;
    timerBusy.current = true;
    timerRevision.current++;
    setRecoveringTimer(true);
    try {
      const saved = legacyTimer.value;
      const task = saved.task.trim() || "Unlabelled work";
      const remote = await api<TimerState | null>("/api/v1/timer");
      // A previous recovery may have succeeded even if its response was lost.
      const matches =
        remote &&
        remote.projectId === saved.projectId &&
        remote.startedAt &&
        Date.parse(remote.startedAt) === Date.parse(saved.startedAt) &&
        remote.task === task &&
        remote.notes === saved.notes &&
        remote.billable === saved.billable;
      if (remote && !matches)
        throw new Error(
          "Stop and save the current timer before recovering this browser timer. Your browser timer is still saved.",
        );
      const recovered =
        remote ??
        (await api<TimerState>("/api/v1/timer", {
          method: "POST",
          body: JSON.stringify({
            projectId: saved.projectId,
            startedAt: saved.startedAt,
            task,
            notes: saved.notes,
            billable: saved.billable,
          }),
        }));
      setTimer(recovered);
      // Do not remove a different timer written by another browser tab.
      if (window.localStorage.getItem("skytime-timer") === legacyTimer.stored)
        window.localStorage.removeItem("skytime-timer");
      setLegacyTimer(null);
      showToast(
        "Browser timer recovered with its original start time",
        "success",
      );
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Could not recover timer. Your browser timer is still saved.",
        "error",
      );
    } finally {
      timerBusy.current = false;
      timerRevision.current++;
      setRecoveringTimer(false);
    }
  }

  useEffect(() => {
    if (authState.kind !== "workspace") return;
    let active = true;
    const sync = async () => {
      if (timerBusy.current) return;
      const revision = timerRevision.current;
      try {
        const remote = await api<TimerState | null>("/api/v1/timer");
        if (!active || timerBusy.current || revision !== timerRevision.current)
          return;
        setTimer((current) =>
          remote
            ? remote.id === current.id
              ? { ...current, running: true, startedAt: remote.startedAt }
              : remote
            : {
                ...current,
                id: undefined,
                running: false,
                startedAt: undefined,
              },
        );
        const nextEntries = await api<TimeEntry[]>("/api/time-entries");
        if (active) setEntries(nextEntries);
      } catch {
        /* Existing timer stays visible during a temporary network failure. */
      }
    };
    void sync();
    const interval = window.setInterval(sync, 15000);
    window.addEventListener("focus", sync);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", sync);
    };
  }, [authState.kind]);

  async function startTimer() {
    if (timerBusy.current) return;
    if (!timer.projectId) {
      showToast("Create a project before starting the timer", "error");
      return;
    }

    timerBusy.current = true;
    timerRevision.current++;
    try {
      const next = await api<TimerState>("/api/v1/timer", {
        method: "POST",
        body: JSON.stringify({
          projectId: timer.projectId,
          task: timer.task.trim() || "Unlabelled work",
          notes: timer.notes,
          billable: timer.billable,
        }),
      });
      setTimer(next);
      showToast("Timer started", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Could not start timer",
        "error",
      );
    } finally {
      timerBusy.current = false;
      timerRevision.current++;
    }
  }

  async function stopTimer() {
    if (!timer.id || timerBusy.current) return;
    timerBusy.current = true;
    timerRevision.current++;
    try {
      const entry = await api<TimeEntry>("/api/v1/timer/stop", {
        method: "POST",
        body: JSON.stringify({
          id: timer.id,
          projectId: timer.projectId,
          task: timer.task.trim() || "Unlabelled work",
          notes: timer.notes,
          billable: timer.billable,
        }),
      });
      setEntries((current) => [
        entry,
        ...current.filter((item) => item.id !== entry.id),
      ]);
      setTimer((current) => ({
        ...current,
        id: undefined,
        running: false,
        startedAt: undefined,
        task: "",
        notes: "",
      }));
      showToast("Entry saved", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Could not stop timer",
        "error",
      );
    } finally {
      timerBusy.current = false;
      timerRevision.current++;
    }
  }

  async function addProject() {
    if (!newProject.name.trim()) {
      showToast("Project name is required", "error");
      return;
    }

    try {
      const project = await api<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: newProject.name.trim(),
          clientId: newProject.clientId || undefined,
          client: newProject.client.trim() || undefined,
          rate: Number(newProject.rate) || 0,
          color: projectColors[projects.length % projectColors.length],
          status: "Active",
        }),
      });

      setProjects((current) => [project, ...current]);
      setTimer((current) => ({ ...current, projectId: project.id }));
      setManualEntry((current) => ({ ...current, projectId: project.id }));
      setTaskForm((current) => ({ ...current, projectId: project.id }));
      setNewProject({ name: "", client: "", clientId: "", rate: "120" });
      showToast("Project created", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Project could not be created",
        "error",
      );
    }
  }

  async function addClient() {
    if (!newClient.name.trim()) {
      showToast("Client name is required", "error");
      return;
    }
    try {
      const client = await api<Client>("/api/clients", {
        method: "POST",
        body: JSON.stringify({
          name: newClient.name.trim(),
          contactName: newClient.contactName.trim(),
          contactEmail: newClient.contactEmail.trim(),
          address: newClient.address.trim(),
          currency: newClient.currency.trim().toUpperCase() || "AUD",
          defaultRate: Number(newClient.defaultRate) || 0,
          notes: newClient.notes.trim(),
        }),
      });
      setClients((current) => [
        client,
        ...current.filter((item) => item.id !== client.id),
      ]);
      setNewClient({
        name: "",
        contactName: "",
        contactEmail: "",
        address: "",
        currency: "AUD",
        defaultRate: "0",
        notes: "",
      });
      showToast("Client created", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Client could not be created",
        "error",
      );
    }
  }

  async function archiveClient(id: string) {
    const client = clients.find((item) => item.id === id);
    askConfirm({
      title: "Archive client?",
      message: client
        ? `${client.name} will be hidden from project creation. Existing projects keep the reference.`
        : "This client will be archived.",
      actionLabel: "Archive client",
      onConfirm: async () => {
        try {
          await api(`/api/clients/${id}`, { method: "DELETE" });
          setClients((current) =>
            current.map((item) =>
              item.id === id
                ? { ...item, archivedAt: new Date().toISOString() }
                : item,
            ),
          );
          showToast("Client archived", "success");
        } catch (error) {
          showToast(
            error instanceof Error
              ? error.message
              : "Client could not be archived",
            "error",
          );
        }
      },
    });
  }

  async function loadPeriods() {
    if (authState.kind !== "workspace") return;
    const scope = authState.data.organization.role === "admin" ? "all" : "own";
    try {
      const data = await api<TimesheetPeriod[]>(
        `/api/timesheets?scope=${scope}`,
      );
      setPeriods(data);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Could not load timesheets",
        "error",
      );
    }
  }

  async function submitCurrentPeriod() {
    if (!currentPeriod) return;
    if (currentPeriod.status === "approved") {
      showToast("This week is already approved", "info");
      return;
    }
    try {
      const updated = await api<TimesheetPeriod>(
        `/api/timesheets/${currentPeriod.id}`,
        {
          method: "POST",
          body: JSON.stringify({ action: "submit", note: submitNote }),
        },
      );
      setCurrentPeriod(updated);
      setPeriods((current) => upsertPeriod(current, updated));
      setSubmitNote("");
      showToast("Timesheet submitted for review", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Could not submit timesheet",
        "error",
      );
    }
  }

  async function reviewPeriod(
    id: string,
    action: "approve" | "reject" | "reopen",
    note = "",
  ) {
    try {
      const updated = await api<TimesheetPeriod>(`/api/timesheets/${id}`, {
        method: "POST",
        body: JSON.stringify({ action, note }),
      });
      setPeriods((current) => upsertPeriod(current, updated));
      if (currentPeriod && currentPeriod.id === id) setCurrentPeriod(updated);
      // Approved/rejected/reopened affects entry locks; refresh entries.
      await loadEntries();
      showToast(
        action === "approve"
          ? "Timesheet approved"
          : action === "reject"
            ? "Timesheet rejected"
            : "Timesheet reopened",
        action === "reject" ? "info" : "success",
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Could not review timesheet",
        "error",
      );
    }
  }

  async function loadEntries() {
    try {
      const data = await api<TimeEntry[]>("/api/time-entries");
      setEntries(data);
    } catch (error) {
      // Non-fatal — leave existing entries in place.
      console.warn("Could not refresh time entries", error);
    }
  }

  async function loadAuditLog() {
    if (
      authState.kind !== "workspace" ||
      authState.data.organization.role !== "admin"
    )
      return;
    try {
      const data = await api<AuditLogEntry[]>("/api/audit-log?limit=100");
      setAuditLog(data);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Could not load audit log",
        "error",
      );
    }
  }

  async function loadErrorLog() {
    if (
      authState.kind !== "workspace" ||
      authState.data.organization.role !== "admin"
    )
      return;
    try {
      const data = await api<ErrorLogEntry[]>("/api/error-log?limit=100");
      setErrorLog(data);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Could not load error log",
        "error",
      );
    }
  }

  async function addManualEntry() {
    const durationHours = Math.max(0.05, Number(manualEntry.duration) || 0);
    if (!manualEntry.task.trim()) {
      showToast("Task name is required", "error");
      return;
    }

    const entry = await createEntry({
      projectId: manualEntry.projectId,
      task: manualEntry.task.trim(),
      notes: manualEntry.notes.trim(),
      startedAt: new Date(`${manualEntry.date}T09:00:00`).toISOString(),
      durationMs: Math.round(durationHours * 60 * 60 * 1000),
      billable: manualEntry.billable,
    });

    if (!entry) return;
    setManualEntry((current) => ({ ...current, task: "", notes: "" }));
    showToast("Manual entry added", "success");
  }

  async function createEntry(
    payload: Omit<TimeEntry, "id" | "userId" | "locked">,
  ) {
    try {
      const entry = await api<TimeEntry>("/api/time-entries", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setEntries((current) => [entry, ...current]);
      return entry;
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Entry could not be saved",
        "error",
      );
      return null;
    }
  }

  async function deleteEntry(id: string) {
    const entry = entries.find((item) => item.id === id);
    askConfirm({
      title: "Delete time entry?",
      message: entry
        ? `"${entry.task}" will be removed from this timesheet.`
        : "This time entry will be removed from the timesheet.",
      actionLabel: "Delete entry",
      onConfirm: async () => {
        try {
          await api(`/api/time-entries/${id}`, { method: "DELETE" });
          setEntries((current) => current.filter((entry) => entry.id !== id));
          showToast("Entry deleted", "success");
        } catch (error) {
          showToast(
            error instanceof Error
              ? error.message
              : "Entry could not be deleted",
            "error",
          );
        }
      },
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const overId = String(event.over?.id ?? "");
    const taskId = String(event.active.id);
    if (!columns.includes(overId as BoardStatus)) return;

    const previous = tasks;
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, status: overId as BoardStatus } : task,
      ),
    );

    try {
      const updated = await api<BoardTask>(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: overId }),
      });
      setTasks((current) =>
        current.map((task) => (task.id === taskId ? updated : task)),
      );
    } catch (error) {
      setTasks(previous);
      showToast(
        error instanceof Error ? error.message : "Task could not be moved",
        "error",
      );
    }
  }

  async function addTask() {
    if (!taskForm.title.trim()) {
      showToast("Task title is required", "error");
      return;
    }

    try {
      const task = await api<BoardTask>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: taskForm.projectId,
          title: taskForm.title.trim(),
          estimateHours: Number(taskForm.estimateHours) || 1,
          status: "Backlog",
        }),
      });
      setTasks((current) => [...current, task]);
      setTaskForm((current) => ({ ...current, title: "" }));
      showToast("Task created", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Task could not be created",
        "error",
      );
    }
  }

  async function deleteTask(id: string) {
    const task = tasks.find((item) => item.id === id);
    askConfirm({
      title: "Delete task?",
      message: task
        ? `"${task.title}" will be removed from the board.`
        : "This task will be removed from the board.",
      actionLabel: "Delete task",
      onConfirm: async () => {
        try {
          await api(`/api/tasks/${id}`, { method: "DELETE" });
          setTasks((current) => current.filter((task) => task.id !== id));
          showToast("Task deleted", "success");
        } catch (error) {
          showToast(
            error instanceof Error
              ? error.message
              : "Task could not be deleted",
            "error",
          );
        }
      },
    });
  }

  async function updateProject(id: string, patch: Partial<Project>) {
    try {
      const project = await api<Project>(`/api/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setProjects((current) =>
        current.map((item) => (item.id === id ? project : item)),
      );
      showToast("Project updated", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Project could not be updated",
        "error",
      );
    }
  }

  async function deleteProject(id: string) {
    const project = projects.find((item) => item.id === id);
    askConfirm({
      title: "Delete project?",
      message: project
        ? `${project.name}, its time entries, and its board tasks will be permanently removed.`
        : "This project and its related work will be permanently removed.",
      actionLabel: "Delete project",
      onConfirm: async () => {
        try {
          await api(`/api/projects/${id}`, { method: "DELETE" });
          setProjects((current) =>
            current.filter((project) => project.id !== id),
          );
          setEntries((current) =>
            current.filter((entry) => entry.projectId !== id),
          );
          setTasks((current) =>
            current.filter((task) => task.projectId !== id),
          );
          showToast("Project deleted", "success");
        } catch (error) {
          showToast(
            error instanceof Error
              ? error.message
              : "Project could not be deleted",
            "error",
          );
        }
      },
    });
  }

  async function saveSettings(settings: {
    reminders?: ReminderSettings;
    fyStartMonth?: number;
  }) {
    try {
      const updated = await api<{
        reminders: ReminderSettings;
        fyStartMonth: number;
      }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      setReminders(updated.reminders);
      setFyStartMonth(updated.fyStartMonth);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Settings could not be saved",
        "error",
      );
    }
  }

  function requestNotifications() {
    if (!("Notification" in window)) {
      showToast("This browser does not support notifications", "error");
      return;
    }

    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        showToast("Notifications enabled", "success");
        return;
      }
      showToast("Notifications were not enabled", "error");
    });
  }

  function sendReminder(
    title = "SkyTime reminder",
    body = "Log what you have been working on.",
  ) {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, tag: "skytime-reminder" });
    } else {
      showToast(body);
    }
  }

  function showToast(message: string, tone: ToastTone = "info") {
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
    setToasts((current) => [...current, { id, message, tone }].slice(-4));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3600);
  }

  function askConfirm(confirm: ConfirmState) {
    setConfirmState(confirm);
  }

  const isAdmin =
    authState.kind === "workspace" &&
    authState.data.organization.role === "admin";
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "clients", label: "Clients", icon: Building2 },
    { id: "projects", label: "Projects", icon: BriefcaseBusiness },
    { id: "board", label: "Board", icon: SquareKanban },
    { id: "timesheets", label: "Timesheets", icon: FileText },
    { id: "reports", label: "Reports", icon: CalendarRange },
    { id: "planning", label: "Planning", icon: CalendarRange },
    { id: "billing", label: "Billing", icon: BriefcaseBusiness },
    { id: "automation", label: "API & MCP", icon: Code2 },
    { id: "approvals", label: "Approvals", icon: ClipboardCheck },
    ...(isAdmin
      ? [
          { id: "audit", label: "Audit log", icon: History },
          { id: "errors", label: "Error log", icon: Bug },
        ]
      : []),
    { id: "settings", label: "Settings", icon: Settings2 },
  ];

  if (authState.kind === "signed-out") {
    return (
      <AuthScreen
        authForm={authForm}
        isPending={isAuthPending || loading}
        loadError={loadError}
        mfa={mfa}
        setMfa={setMfa}
        setAuthForm={setAuthForm}
        submitAuth={submitAuth}
        signInWithPasskey={signInWithPasskey}
        theme={theme}
        toggleTheme={() => setTheme(theme === "light" ? "dark" : "light")}
        verifyMfaSignIn={verifyMfaSignIn}
      />
    );
  }

  if (authState.kind === "needs-org") {
    return (
      <OrganizationOnboarding
        authForm={authForm}
        isPending={isAuthPending || loading}
        loadError={loadError}
        setAuthForm={setAuthForm}
        submit={createOrganization}
        theme={theme}
        toggleTheme={() => setTheme(theme === "light" ? "dark" : "light")}
        userEmail={authState.user.email}
      />
    );
  }

  if (loading) {
    return (
      <div className="auth-frame text-[var(--text)]">
        <div className="sky-panel w-full max-w-sm p-6">
          <Brand />
          <p className="mt-5 text-sm text-[var(--muted)]">Loading workspace…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="auth-frame text-[var(--text)]">
        <div className="sky-panel w-full max-w-md p-6">
          <Brand />
          <h1 className="mt-5 text-lg font-semibold">Database is not ready</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{loadError}</p>
          <p className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--muted)]">
            Run docker compose up -d, then npm run db:migrate from the Next app
            folder.
          </p>
          <div className="mt-4">
            <Button tone="neutral" onClick={loadWorkspace}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh text-[var(--text)]">
      <aside className="sky-glass fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-[var(--border)] px-4 py-5 lg:flex lg:flex-col">
        <Brand />
        <nav
          className="mt-8 min-h-0 flex-1 space-y-1 overflow-y-auto"
          aria-label="Primary"
          data-testid="desktop-nav"
        >
          {navItems.map((item) => (
            <NavButton
              key={item.id}
              active={activeView === item.id}
              icon={item.icon}
              label={item.label}
              onClick={() => setActiveView(item.id)}
            />
          ))}
        </nav>
        <div className="mt-4 shrink-0 rounded-2xl border border-[var(--border)] bg-[var(--raised)] p-4 shadow-[var(--soft-shadow)]">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
            Today
          </p>
          <p className="mt-2 text-2xl font-bold tabular">
            {formatDuration(todayMs + elapsedMs)}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {timer.running
              ? `Running on ${activeProject?.name}`
              : "No active timer"}
          </p>
        </div>
      </aside>

      <header className="sky-glass sticky top-0 z-10 border-b border-[var(--border)] px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4 lg:hidden">
        <div className="flex items-center gap-2">
          <Brand compact />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <select
              aria-label="Workspace section"
              value={activeView}
              onChange={(event) => setActiveView(event.target.value)}
              className="h-11 min-w-0 flex-1 truncate rounded-xl border border-[var(--border)] bg-[var(--raised)] px-3 text-sm font-semibold"
            >
              {navItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <ThemeToggle
              theme={theme}
              onToggle={() => setTheme(theme === "light" ? "dark" : "light")}
            />
          </div>
        </div>
      </header>

      <main className="min-w-0 lg:pl-64">
        <div className="mx-auto min-w-0 max-w-7xl px-3 pb-[calc(env(safe-area-inset-bottom)+6.25rem)] pt-4 sm:px-6 lg:px-8 lg:py-7">
          <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--raised)_72%,transparent)] p-3 shadow-[var(--soft-shadow)] backdrop-blur sm:p-5 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
                Workspace
              </p>
              <h1 className="mt-1 min-w-0 text-xl font-bold leading-tight sm:text-[30px]">
                {activeView === "dashboard"
                  ? "Track time without losing the workday."
                  : navItems.find((item) => item.id === activeView)?.label}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="hidden lg:block">
                <ThemeToggle
                  theme={theme}
                  onToggle={() =>
                    setTheme(theme === "light" ? "dark" : "light")
                  }
                />
              </div>
              <Pill>
                <Bell className="size-3.5" />
                {reminders.enabled
                  ? `${reminders.cadenceMinutes} min reminders`
                  : "Reminders off"}
              </Pill>
            </div>
          </div>

          {legacyTimer && (
            <section
              aria-label="Recover browser timer"
              className="sky-panel mb-5 p-4 sm:p-5"
            >
              <h2 className="font-semibold">Recover your running timer</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                This browser has a timer from before server sync was enabled.
                Recover it to keep tracking from its original start time.
              </p>
              <p className="mt-2 text-sm font-semibold">
                {
                  projects.find(
                    (project) => project.id === legacyTimer.value.projectId,
                  )?.name
                }
                {" · "}
                {legacyTimer.value.task || "Unlabelled work"}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Started {formatLongDate(new Date(legacyTimer.value.startedAt))}{" "}
                at {formatClock(new Date(legacyTimer.value.startedAt))}
              </p>
              {legacyTimer.value.notes && (
                <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--muted)]">
                  {legacyTimer.value.notes}
                </p>
              )}
              <div className="mt-3">
                <Button onClick={recoverLegacyTimer} disabled={recoveringTimer}>
                  {recoveringTimer ? "Recovering timer…" : "Recover timer"}
                </Button>
              </div>
            </section>
          )}

          {activeView === "dashboard" && (
            <DashboardView
              activeProject={activeProject}
              clients={clients}
              elapsedMs={elapsedMs}
              entries={entries}
              manualEntry={manualEntry}
              projects={projects}
              setManualEntry={setManualEntry}
              setTimer={setTimer}
              startTimer={startTimer}
              stopTimer={stopTimer}
              timer={timer}
              todayMs={todayMs}
              addManualEntry={addManualEntry}
              deleteEntry={deleteEntry}
            />
          )}

          {activeView === "projects" && (
            <>
              <ProjectBudgets projects={projects} onChange={loadWorkspace} />
              <ProjectsView
                clients={clients}
                entries={entries}
                newProject={newProject}
                projects={projects}
                setNewProject={setNewProject}
                addProject={addProject}
                deleteProject={deleteProject}
                updateProject={updateProject}
              />
            </>
          )}

          {activeView === "clients" && (
            <ClientsView
              clients={clients}
              projects={projects}
              entries={entries}
              newClient={newClient}
              setNewClient={setNewClient}
              addClient={addClient}
              archiveClient={archiveClient}
            />
          )}

          {activeView === "approvals" && (
            <ApprovalsView
              isAdmin={authState.data.organization.role === "admin"}
              currentPeriod={currentPeriod}
              periods={periods}
              submitNote={submitNote}
              setSubmitNote={setSubmitNote}
              currentUserId={authState.data.user.id}
              submitCurrentPeriod={submitCurrentPeriod}
              reviewPeriod={reviewPeriod}
              reload={loadPeriods}
            />
          )}

          {activeView === "audit" &&
            authState.data.organization.role === "admin" && (
              <AuditLogView entries={auditLog} reload={loadAuditLog} />
            )}

          {activeView === "errors" &&
            authState.data.organization.role === "admin" && (
              <ErrorLogView entries={errorLog} reload={loadErrorLog} />
            )}

          {activeView === "board" && (
            <BoardView
              tasks={tasks}
              projects={projects}
              onDragEnd={handleDragEnd}
              taskForm={taskForm}
              setTaskForm={setTaskForm}
              addTask={addTask}
              deleteTask={deleteTask}
            />
          )}

          {activeView === "timesheets" && (
            <TimesheetsView
              customEnd={customEnd}
              customStart={customStart}
              entries={filteredEntries}
              fyStartMonth={fyStartMonth}
              period={period}
              periodRange={periodRange}
              projects={projects}
              setCustomEnd={setCustomEnd}
              setCustomStart={setCustomStart}
              setPeriod={setPeriod}
              totals={totals}
              deleteEntry={deleteEntry}
              onCsv={() =>
                exportCsv(filteredEntries, projects, periodRange, showToast)
              }
              onPdf={() =>
                exportPdf(
                  filteredEntries,
                  projects,
                  periodRange,
                  authState.data.user,
                  authState.data.organization,
                  showToast,
                )
              }
            />
          )}

          {activeView === "planning" && (
            <PlanningView projects={projects} isAdmin={isAdmin} />
          )}
          {activeView === "reports" && (
            <ReportsView projects={projects} clients={clients} />
          )}
          {activeView === "billing" && (
            <BillingView
              projects={projects}
              clients={clients}
              isAdmin={isAdmin}
            />
          )}
          {activeView === "automation" && <AutomationView isAdmin={isAdmin} />}
          {activeView === "settings" && (
            <SettingsView
              fyStartMonth={fyStartMonth}
              reminders={reminders}
              requestNotifications={requestNotifications}
              sendReminder={() => sendReminder()}
              setFyStartMonth={setFyStartMonth}
              setReminders={setReminders}
              saveSettings={saveSettings}
              organization={authState.data.organization}
              invites={invites}
              inviteForm={inviteForm}
              setInviteForm={setInviteForm}
              createInvite={createInvite}
              revokeInvite={revokeInvite}
              mfa={mfa}
              setMfa={setMfa}
              startMfaSetup={startMfaSetup}
              verifyMfaSetup={verifyMfaSetup}
              disableMfa={disableMfa}
              regenerateBackupCodes={regenerateBackupCodes}
              user={authState.data.user}
            />
          )}
        </div>
      </main>

      <MobileBottomNav
        activeView={activeView}
        items={navItems}
        onChange={setActiveView}
      />
      <ToastStack
        toasts={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((toast) => toast.id !== id))
        }
      />
      <ConfirmDialog
        confirm={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img
        src="/skytime-mark.svg"
        alt=""
        className={cn(
          "rounded-2xl shadow-[0_10px_24px_color-mix(in_oklch,var(--accent)_20%,transparent)]",
          compact ? "size-9" : "size-11",
        )}
      />
      {!compact && (
        <div>
          <img
            src="/skytime-wordmark.svg"
            alt="SkyTime"
            className="h-7 w-auto"
          />
          <p className="mt-1 text-xs text-[var(--muted)]">
            Timesheets that stay tidy.
          </p>
        </div>
      )}
    </div>
  );
}

function NavButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof LayoutDashboard;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus:ring-3 focus:ring-[var(--accent-subtle)]",
        active
          ? "bg-[var(--accent-subtle)] text-[var(--accent-strong)] shadow-sm"
          : "text-[var(--muted)] hover:bg-[color-mix(in_oklch,var(--raised)_78%,transparent)] hover:text-[var(--text)]",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );
}

const mobilePrimary = [
  { id: "dashboard", short: "Home" },
  { id: "timesheets", short: "Time" },
  { id: "projects", short: "Work" },
  { id: "approvals", short: "Review" },
] as const;

function MobileBottomNav({
  activeView,
  items,
  onChange,
}: {
  activeView: string;
  items: { id: string; label: string; icon: typeof LayoutDashboard }[];
  onChange: (view: string) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = mobilePrimary.flatMap((slot) => {
    const item = items.find((entry) => entry.id === slot.id);
    return item ? [{ ...item, short: slot.short }] : [];
  });
  const moreItems = items.filter(
    (item) => !mobilePrimary.some((slot) => slot.id === item.id),
  );
  const moreActive =
    moreOpen || moreItems.some((item) => item.id === activeView);

  function pick(id: string) {
    setMoreOpen(false);
    onChange(id);
  }

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[color-mix(in_oklch,var(--background)_72%,transparent)]"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
          />
          <nav
            aria-label="More sections"
            className="absolute inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] max-h-[min(70dvh,28rem)] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--raised)] p-2 shadow-[var(--shadow)]"
          >
            {moreItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => pick(item.id)}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-3 whitespace-nowrap rounded-xl px-3 text-sm font-semibold focus:outline-none focus:ring-3 focus:ring-[var(--accent-subtle)]",
                    active
                      ? "bg-[var(--accent-subtle)] text-[var(--accent-strong)]"
                      : "text-[var(--text)]",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      )}
      <nav
        className="sky-glass fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border)] px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 lg:hidden"
        aria-label="Primary"
        data-testid="mobile-nav"
      >
        <div className="grid grid-cols-5 gap-1">
          {primary.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                onClick={() => pick(item.id)}
                className={cn(
                  "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-2xl px-1 py-1.5 text-[11px] font-semibold focus:outline-none focus:ring-3 focus:ring-[var(--accent-subtle)]",
                  active
                    ? "bg-[var(--accent-subtle)] text-[var(--accent-strong)]"
                    : "text-[var(--muted)] active:bg-[var(--surface)]",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                {item.short}
              </button>
            );
          })}
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-label="More sections"
            onClick={() => setMoreOpen((open) => !open)}
            className={cn(
              "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-2xl px-1 py-1.5 text-[11px] font-semibold focus:outline-none focus:ring-3 focus:ring-[var(--accent-subtle)]",
              moreActive
                ? "bg-[var(--accent-subtle)] text-[var(--accent-strong)]"
                : "text-[var(--muted)] active:bg-[var(--surface)]",
            )}
          >
            <Ellipsis className="size-5 shrink-0" aria-hidden />
            More
          </button>
        </div>
      </nav>
    </>
  );
}

function ThemeToggle({
  onToggle,
  theme,
}: {
  onToggle: () => void;
  theme: ThemeMode;
}) {
  const Icon = theme === "light" ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--raised)] px-3 text-sm font-semibold text-[var(--text)] shadow-sm transition-colors hover:bg-[var(--surface)] focus:outline-none focus:ring-3 focus:ring-[var(--accent-subtle)]"
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      <Icon className="size-4 text-[var(--accent-strong)]" aria-hidden />
      <span className="hidden sm:inline">
        {theme === "light" ? "Light" : "Dark"}
      </span>
    </button>
  );
}

function ToastStack({
  onDismiss,
  toasts,
}: {
  onDismiss: (id: string) => void;
  toasts: ToastMessage[];
}) {
  return (
    <div
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] z-40 grid gap-2 lg:inset-x-auto lg:bottom-5 lg:right-5 lg:w-[min(360px,calc(100%-2rem))]"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "flex items-start gap-3 rounded-2xl border bg-[var(--raised)] p-3 text-sm shadow-[var(--shadow)]",
            toast.tone === "success" &&
              "border-[color-mix(in_oklch,var(--success)_45%,var(--border))]",
            toast.tone === "error" &&
              "border-[color-mix(in_oklch,var(--error)_55%,var(--border))]",
            toast.tone === "info" &&
              "border-[color-mix(in_oklch,var(--accent)_38%,var(--border))]",
          )}
        >
          <span
            className={cn(
              "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
              toast.tone === "success" &&
                "bg-[var(--success-soft)] text-[var(--success)]",
              toast.tone === "error" &&
                "bg-[var(--error-soft)] text-[var(--error)]",
              toast.tone === "info" &&
                "bg-[var(--accent-subtle)] text-[var(--accent-strong)]",
            )}
            aria-hidden
          >
            {toast.tone === "error" ? (
              <AlertTriangle className="size-3.5" />
            ) : (
              <Check className="size-3.5" />
            )}
          </span>
          <p className="min-w-0 flex-1 font-semibold text-[var(--text)]">
            {toast.message}
          </p>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="rounded-lg p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)] focus:outline-none focus:ring-3 focus:ring-[var(--accent-subtle)]"
            aria-label="Dismiss notification"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

function ConfirmDialog({
  confirm,
  onClose,
}: {
  confirm: ConfirmState | null;
  onClose: () => void;
}) {
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!confirm) setIsPending(false);
  }, [confirm]);

  if (!confirm) return null;

  return (
    <div
      className="fixed inset-0 z-[60] grid items-end bg-[color-mix(in_oklch,var(--background)_72%,transparent)] px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-4 backdrop-blur-sm sm:place-items-center sm:p-4"
      role="presentation"
    >
      <section
        className="sky-panel max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[var(--error-soft)] text-[var(--error)]">
            <AlertTriangle className="size-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="text-lg font-semibold">
              {confirm.title}
            </h2>
            <p
              id="confirm-message"
              className="mt-1 text-sm text-[var(--muted)]"
            >
              {confirm.message}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)] focus:outline-none focus:ring-3 focus:ring-[var(--accent-subtle)]"
            aria-label="Close confirmation"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button tone="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="danger"
            disabled={isPending}
            onClick={() => {
              if (isPending) return;
              setIsPending(true);
              void Promise.resolve(confirm.onConfirm()).finally(() => {
                setIsPending(false);
                onClose();
              });
            }}
          >
            <Trash2 className="size-4" />
            {isPending ? "Working..." : confirm.actionLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}

function ForgotPassword({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function sendReset() {
    setPending(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!response.ok) {
        setError(data.message || "Could not send the reset email");
        return;
      }
      setMessage("If that email has an account, a reset link is on the way.");
    } catch {
      setError("Could not send the reset email");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="justify-self-start text-sm font-semibold text-[var(--accent-strong)]"
        onClick={() => setOpen(true)}
      >
        Forgot password
      </button>
    );
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        className="justify-self-start text-sm font-semibold text-[var(--accent-strong)] disabled:opacity-60"
        disabled={pending || !email}
        onClick={() => void sendReset()}
      >
        {pending ? "Sending..." : "Email me a reset link"}
      </button>
      {message && <p className="text-sm text-[var(--muted)]">{message}</p>}
      {error && <p className="text-sm text-[var(--error)]">{error}</p>}
    </div>
  );
}

function AuthScreen({
  authForm,
  isPending,
  loadError,
  mfa,
  setMfa,
  setAuthForm,
  submitAuth,
  signInWithPasskey,
  theme,
  toggleTheme,
  verifyMfaSignIn,
}: {
  authForm: AuthForm;
  isPending: boolean;
  loadError: string;
  mfa: MfaState;
  setMfa: Dispatch<SetStateAction<MfaState>>;
  setAuthForm: Dispatch<SetStateAction<AuthForm>>;
  submitAuth: () => void;
  signInWithPasskey: () => void;
  theme: ThemeMode;
  toggleTheme: () => void;
  verifyMfaSignIn: () => void;
}) {
  const [passkeyReady, setPasskeyReady] = useState(false);
  useEffect(() => {
    setPasskeyReady(
      typeof PublicKeyCredential !== "undefined" &&
        typeof PublicKeyCredential === "function",
    );
  }, []);

  return (
    <div className="auth-frame text-[var(--text)]">
      <div className="fixed right-4 top-[max(1rem,env(safe-area-inset-top))] z-10">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
      <section className="sky-panel w-full max-w-md p-5 sm:p-6">
        <Brand />
        <p className="mt-6 text-sm text-[var(--muted)]">
          Sign in to your organization.
        </p>
        <div className="mt-5 grid gap-3">
          <Field label="Email">
            <Input
              type="email"
              autoComplete="username webauthn"
              value={authForm.email}
              onChange={(event) =>
                setAuthForm((current) => ({
                  ...current,
                  email: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password webauthn"
              value={authForm.password}
              onChange={(event) =>
                setAuthForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
            />
          </Field>
          <ForgotPassword email={authForm.email} />
          {mfa.signInRequired && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck
                  className="size-5 text-[var(--accent-strong)]"
                  aria-hidden
                />
                <p className="font-semibold">Verify your sign in</p>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Enter your authenticator code or use a backup code.
              </p>
              <div className="mt-4 grid gap-3">
                {mfa.signInUseBackupCode ? (
                  <Field label="Backup code">
                    <Input
                      value={mfa.signInBackupCode}
                      onChange={(event) =>
                        setMfa((current) => ({
                          ...current,
                          signInBackupCode: event.target.value,
                        }))
                      }
                    />
                  </Field>
                ) : (
                  <Field label="Authenticator code">
                    <Input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={mfa.signInCode}
                      onChange={(event) =>
                        setMfa((current) => ({
                          ...current,
                          signInCode: event.target.value,
                        }))
                      }
                    />
                  </Field>
                )}
                <Toggle
                  checked={mfa.trustDevice}
                  label="Trust this device for 30 days"
                  onChange={(trustDevice) =>
                    setMfa((current) => ({ ...current, trustDevice }))
                  }
                />
                <button
                  type="button"
                  className="justify-self-start text-sm font-semibold text-[var(--accent-strong)]"
                  onClick={() =>
                    setMfa((current) => ({
                      ...current,
                      signInUseBackupCode: !current.signInUseBackupCode,
                    }))
                  }
                >
                  {mfa.signInUseBackupCode
                    ? "Use authenticator code"
                    : "Use backup code"}
                </button>
                <Button onClick={verifyMfaSignIn}>
                  <ShieldCheck className="size-4" />
                  {isPending ? "Verifying..." : "Verify"}
                </Button>
              </div>
            </div>
          )}
          {loadError && (
            <p className="rounded-xl border border-[var(--error)] bg-[var(--error-soft)] p-3 text-sm text-[var(--error)]">
              {loadError}
            </p>
          )}
          {!mfa.signInRequired && (
            <Button onClick={submitAuth}>
              <Clock3 className="size-4" />
              {isPending ? "Working..." : "Sign in"}
            </Button>
          )}
          {passkeyReady && !mfa.signInRequired && (
            <Button tone="neutral" onClick={signInWithPasskey} disabled={isPending}>
              <Fingerprint className="size-4" />
              Use a passkey
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

function OrganizationOnboarding({
  authForm,
  isPending,
  loadError,
  setAuthForm,
  submit,
  theme,
  toggleTheme,
  userEmail,
}: {
  authForm: AuthForm;
  isPending: boolean;
  loadError: string;
  setAuthForm: Dispatch<SetStateAction<AuthForm>>;
  submit: () => void;
  theme: ThemeMode;
  toggleTheme: () => void;
  userEmail: string;
}) {
  return (
    <div className="auth-frame text-[var(--text)]">
      <div className="fixed right-4 top-[max(1rem,env(safe-area-inset-top))] z-10">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
      <section className="sky-panel w-full max-w-md p-5 sm:p-6">
        <Brand />
        <h1 className="mt-6 text-lg font-semibold">Create your organization</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {userEmail} will become the admin. You can invite teammates after the
          workspace opens.
        </p>
        <div className="mt-5 grid gap-3">
          <Field label="Organization name">
            <Input
              value={authForm.organizationName}
              onChange={(event) =>
                setAuthForm((current) => ({
                  ...current,
                  organizationName: event.target.value,
                }))
              }
            />
          </Field>
          {loadError && (
            <p className="rounded-xl border border-[var(--error)] bg-[var(--error-soft)] p-3 text-sm text-[var(--error)]">
              {loadError}
            </p>
          )}
          <Button onClick={submit}>
            <BriefcaseBusiness className="size-4" />
            {isPending ? "Creating..." : "Create organization"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail: string;
  icon: typeof Clock3;
  label: string;
  value: string;
}) {
  return (
    <article className="sky-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
            {label}
          </p>
          <p className="mt-2 truncate text-2xl font-bold leading-none tracking-tight tabular">
            {value}
          </p>
        </div>
        <div className="grid size-10 place-items-center rounded-2xl bg-[var(--accent-subtle)] text-[var(--accent-strong)]">
          <Icon className="size-5" aria-hidden />
        </div>
      </div>
      <p className="mt-3 text-sm text-[var(--muted)]">{detail}</p>
    </article>
  );
}

function EmptyState({
  icon: Icon,
  message,
  title,
}: {
  icon: typeof Clock3;
  message: string;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[color-mix(in_oklch,var(--raised)_70%,transparent)] p-6 text-center md:col-span-2">
      <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--accent-subtle)] text-[var(--accent-strong)]">
        <Icon className="size-6" aria-hidden />
      </div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--muted)]">
        {message}
      </p>
    </div>
  );
}

function DashboardView({
  activeProject,
  clients,
  elapsedMs,
  entries,
  manualEntry,
  projects,
  setManualEntry,
  setTimer,
  startTimer,
  stopTimer,
  timer,
  todayMs,
  addManualEntry,
  deleteEntry,
}: {
  activeProject?: Project;
  clients: Client[];
  elapsedMs: number;
  entries: TimeEntry[];
  manualEntry: ManualEntryForm;
  projects: Project[];
  setManualEntry: Dispatch<SetStateAction<ManualEntryForm>>;
  setTimer: Dispatch<SetStateAction<TimerState>>;
  startTimer: () => void;
  stopTimer: () => void;
  timer: TimerState;
  todayMs: number;
  addManualEntry: () => void;
  deleteEntry: (id: string) => void;
}) {
  const weekRange = getPeriodRange(
    "week",
    7,
    toDateInput(new Date()),
    toDateInput(new Date()),
  );
  const weekMs = entries
    .filter((entry) =>
      isInsideRange(new Date(entry.startedAt), weekRange.start, weekRange.end),
    )
    .reduce((sum, entry) => sum + entry.durationMs, 0);
  const billableMs = entries
    .filter((entry) => entry.billable)
    .reduce((sum, entry) => sum + entry.durationMs, 0);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_390px] xl:gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:col-span-2 xl:grid-cols-4">
        <StatCard
          icon={Clock3}
          label="Today"
          value={formatDuration(todayMs + elapsedMs)}
          detail="Tracked so far"
        />
        <StatCard
          icon={CalendarRange}
          label="This week"
          value={formatDuration(weekMs + elapsedMs)}
          detail="Across all projects"
        />
        <StatCard
          icon={BriefcaseBusiness}
          label="Billable"
          value={formatDuration(billableMs + (timer.billable ? elapsedMs : 0))}
          detail="Ready for timesheets"
        />
        <StatCard
          icon={Play}
          label="Active project"
          value={activeProject?.name ?? "None"}
          detail={timer.running ? "Timer running" : "Ready to start"}
        />
      </div>

      <section className="timer-panel p-4 sm:p-6" data-running={timer.running}>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
              Current timer
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-5xl font-bold leading-none tracking-tight tabular sm:text-7xl">
                {formatDuration(elapsedMs)}
              </p>
              <Pill tone={timer.running ? "accent" : "neutral"}>
                {timer.running ? (
                  <Pause className="size-3.5" />
                ) : (
                  <Circle className="size-3.5" />
                )}
                {timer.running ? "Running" : "Ready"}
              </Pill>
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--raised)_78%,transparent)] px-4 py-3 text-sm shadow-sm">
            <span className="text-[var(--muted)]">Today total</span>
            <strong className="ml-2 tabular">
              {formatDuration(todayMs + elapsedMs)}
            </strong>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-[1fr_1fr]">
          <Field label="Project">
            <Select
              value={timer.projectId}
              onChange={(value) =>
                setTimer((current) => ({ ...current, projectId: value }))
              }
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Task">
            <Input
              value={timer.task}
              placeholder="What are you working on?"
              onChange={(event) =>
                setTimer((current) => ({
                  ...current,
                  task: event.target.value,
                }))
              }
            />
          </Field>
          <Field className="md:col-span-2" label="Notes">
            <Input
              value={timer.notes}
              placeholder="Optional note for the timesheet"
              onChange={(event) =>
                setTimer((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Toggle
            checked={timer.billable}
            label="Billable"
            onChange={(checked) =>
              setTimer((current) => ({ ...current, billable: checked }))
            }
          />
          <Button
            tone={timer.running ? "neutral" : "primary"}
            onClick={timer.running ? stopTimer : startTimer}
          >
            {timer.running ? (
              <TimerReset className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
            {timer.running ? "Stop and save" : "Start timer"}
          </Button>
        </div>

        {activeProject && (
          <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--raised)_72%,transparent)] p-4 shadow-sm">
            <p className="text-sm font-semibold">{activeProject.name}</p>
            <p className="text-sm text-[var(--muted)]">
              {activeProject.client},{" "}
              {activeProject.rate > 0
                ? `${formatCurrency(activeProject.rate, currencyForProject(activeProject, clients))}/hr ex GST`
                : "Non-billable"}
            </p>
          </div>
        )}
      </section>

      <section className="sky-panel p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Quick add</h2>
          <Pill>Manual</Pill>
        </div>
        <div className="mt-4 grid gap-3">
          <Field label="Project">
            <Select
              value={manualEntry.projectId}
              onChange={(value) =>
                setManualEntry((current) => ({ ...current, projectId: value }))
              }
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Task">
            <Input
              value={manualEntry.task}
              onChange={(event) =>
                setManualEntry((current) => ({
                  ...current,
                  task: event.target.value,
                }))
              }
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date">
              <Input
                type="date"
                value={manualEntry.date}
                onChange={(event) =>
                  setManualEntry((current) => ({
                    ...current,
                    date: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Hours">
              <Input
                inputMode="decimal"
                value={manualEntry.duration}
                onChange={(event) =>
                  setManualEntry((current) => ({
                    ...current,
                    duration: event.target.value,
                  }))
                }
              />
            </Field>
          </div>
          <Toggle
            checked={manualEntry.billable}
            label="Billable entry"
            onChange={(checked) =>
              setManualEntry((current) => ({ ...current, billable: checked }))
            }
          />
          <Button onClick={addManualEntry} tone="neutral">
            <Plus className="size-4" />
            Add entry
          </Button>
        </div>
      </section>

      <section className="content-auto xl:col-span-2">
        <SectionHeader
          title="Recent entries"
          action={`${entries.length} saved`}
        />
        <EntryTable
          entries={entries.slice(0, 6)}
          projects={projects}
          onDelete={deleteEntry}
        />
      </section>
    </div>
  );
}

function ProjectsView({
  addProject,
  clients,
  entries,
  newProject,
  projects,
  setNewProject,
  deleteProject,
  updateProject,
}: {
  addProject: () => void;
  clients: Client[];
  entries: TimeEntry[];
  newProject: NewProjectForm;
  projects: Project[];
  setNewProject: Dispatch<SetStateAction<NewProjectForm>>;
  deleteProject: (id: string) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
}) {
  const activeClients = clients.filter((client) => !client.archivedAt);
  return (
    <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
      <section className="sky-panel p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <FolderPlus
            className="size-5 text-[var(--accent-strong)]"
            aria-hidden
          />
          <h2 className="text-lg font-semibold">Create project</h2>
        </div>
        <div className="mt-4 grid gap-3">
          <Field label="Project name">
            <Input
              value={newProject.name}
              onChange={(event) =>
                setNewProject((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Client">
            {activeClients.length > 0 ? (
              <select
                value={newProject.clientId}
                onChange={(event) => {
                  const id = event.target.value;
                  const match = activeClients.find(
                    (client) => client.id === id,
                  );
                  setNewProject((current) => ({
                    ...current,
                    clientId: id,
                    client: match?.name ?? current.client,
                    rate:
                      match && match.defaultRate > 0
                        ? String(match.defaultRate)
                        : current.rate,
                  }));
                }}
                className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--raised)] px-3 text-sm text-[var(--text)] focus:outline-none focus:ring-3 focus:ring-[var(--accent-subtle)]"
              >
                <option value="">No client</option>
                {activeClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={newProject.client}
                onChange={(event) =>
                  setNewProject((current) => ({
                    ...current,
                    client: event.target.value,
                    clientId: "",
                  }))
                }
                placeholder="Free-form client name"
              />
            )}
          </Field>
          <Field label="Hourly rate">
            <Input
              inputMode="decimal"
              value={newProject.rate}
              onChange={(event) =>
                setNewProject((current) => ({
                  ...current,
                  rate: event.target.value,
                }))
              }
            />
          </Field>
          <Button onClick={addProject}>
            <Plus className="size-4" />
            Create project
          </Button>
        </div>
      </section>

      <section>
        <SectionHeader title="Projects" action={`${projects.length} total`} />
        <div className="grid gap-3 md:grid-cols-2">
          {projects.length === 0 && (
            <EmptyState
              icon={FolderPlus}
              title="No projects yet"
              message="Create a project to start organizing tracked time by client, workstream, or internal effort."
            />
          )}
          {projects.map((project) => {
            const projectMs = entries
              .filter((entry) => entry.projectId === project.id)
              .reduce((sum, entry) => sum + entry.durationMs, 0);
            return (
              <article key={project.id} className="sky-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ background: project.color }}
                      />
                      <h3 className="font-semibold">{project.name}</h3>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {project.client}
                    </p>
                  </div>
                  <Pill
                    tone={project.status === "Active" ? "success" : "warning"}
                  >
                    {project.status}
                  </Pill>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-[var(--muted)]">Tracked</dt>
                    <dd className="mt-1 font-semibold tabular">
                      {formatDuration(projectMs)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Rate</dt>
                    <dd className="mt-1 font-semibold tabular">
                      {project.rate > 0
                        ? `${formatCurrency(project.rate, currencyForProject(project, clients))}/hr ex GST`
                        : "Internal"}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    tone="neutral"
                    onClick={() =>
                      updateProject(project.id, {
                        status:
                          project.status === "Active" ? "Paused" : "Active",
                      })
                    }
                  >
                    <Edit3 className="size-4" />
                    {project.status === "Active" ? "Pause" : "Activate"}
                  </Button>
                  <Button
                    tone="neutral"
                    onClick={() => deleteProject(project.id)}
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function BoardView({
  addTask,
  deleteTask,
  onDragEnd,
  projects,
  setTaskForm,
  taskForm,
  tasks,
}: {
  addTask: () => void;
  deleteTask: (id: string) => void;
  onDragEnd: (event: DragEndEvent) => void;
  projects: Project[];
  setTaskForm: Dispatch<SetStateAction<NewTaskForm>>;
  taskForm: NewTaskForm;
  tasks: BoardTask[];
}) {
  return (
    <section>
      <div className="sky-panel mb-4 p-4">
        <SectionHeader title="Task board" action="Drag tasks between columns" />
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px_auto]">
          <Field label="Project">
            <Select
              value={taskForm.projectId}
              onChange={(value) =>
                setTaskForm((current) => ({ ...current, projectId: value }))
              }
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Task">
            <Input
              value={taskForm.title}
              onChange={(event) =>
                setTaskForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Estimate">
            <Input
              inputMode="decimal"
              value={taskForm.estimateHours}
              onChange={(event) =>
                setTaskForm((current) => ({
                  ...current,
                  estimateHours: event.target.value,
                }))
              }
            />
          </Field>
          <div className="flex items-end">
            <Button onClick={addTask}>
              <Plus className="size-4" />
              Add task
            </Button>
          </div>
        </div>
      </div>
      <DndContext onDragEnd={onDragEnd}>
        <div className="kanban-scroll grid min-w-0 auto-cols-[minmax(min(17rem,100%),1fr)] grid-flow-col gap-3 overflow-x-auto pb-3 lg:grid-flow-row lg:grid-cols-4 lg:overflow-visible lg:pb-0">
          {columns.map((column) => (
            <BoardColumn
              key={column}
              column={column}
              tasks={tasks.filter((task) => task.status === column)}
              projects={projects}
              deleteTask={deleteTask}
            />
          ))}
        </div>
      </DndContext>
    </section>
  );
}

function BoardColumn({
  column,
  deleteTask,
  projects,
  tasks,
}: {
  column: BoardStatus;
  deleteTask: (id: string) => void;
  projects: Project[];
  tasks: BoardTask[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-64 rounded-2xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--surface)_82%,var(--raised))] p-3 transition-colors",
        isOver && "bg-[var(--accent-subtle)]",
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{column}</h3>
        <Pill>{tasks.length}</Pill>
      </div>
      <div className="space-y-2">
        {tasks.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--border)] bg-[color-mix(in_oklch,var(--raised)_58%,transparent)] p-4 text-sm text-[var(--muted)]">
            Drop tasks here.
          </div>
        )}
        {tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            project={projects.find((project) => project.id === task.projectId)}
            deleteTask={deleteTask}
          />
        ))}
      </div>
    </div>
  );
}

function BoardCard({
  deleteTask,
  project,
  task,
}: {
  deleteTask: (id: string) => void;
  project?: Project;
  task: BoardTask;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id });
  const style: CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "touch-none rounded-xl border border-[var(--border)] bg-[var(--raised)] p-3 shadow-sm transition-shadow",
        isDragging && "relative z-20 shadow-[var(--shadow)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold leading-snug">{task.title}</p>
        <button
          type="button"
          className="rounded-xl p-1 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            deleteTask(task.id);
          }}
          aria-label={`Delete ${task.title}`}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: project?.color ?? "var(--border)" }}
          />
          <span className="truncate">{project?.name ?? "Project"}</span>
        </span>
        <span className="tabular">{task.estimateHours}h</span>
      </div>
    </article>
  );
}

function TimesheetsView({
  customEnd,
  customStart,
  entries,
  fyStartMonth,
  period,
  periodRange,
  projects,
  setCustomEnd,
  setCustomStart,
  setPeriod,
  totals,
  deleteEntry,
  onCsv,
  onPdf,
}: {
  customEnd: string;
  customStart: string;
  entries: TimeEntry[];
  fyStartMonth: number;
  period: PeriodPreset;
  periodRange: { start: Date; end: Date };
  projects: Project[];
  setCustomEnd: (value: string) => void;
  setCustomStart: (value: string) => void;
  setPeriod: (value: PeriodPreset) => void;
  totals: ProjectTotal[];
  deleteEntry: (id: string) => void;
  onCsv: () => void;
  onPdf: () => void;
}) {
  const currencyTotals = totals.reduce(
    (map, total) => {
      const group = map.get(total.currency) ?? {
        amountExGst: 0,
        gst: 0,
        amountIncGst: 0,
      };
      group.amountExGst += total.amountExGst;
      group.gst += total.gst;
      group.amountIncGst += total.amountIncGst;
      map.set(total.currency, group);
      return map;
    },
    new Map<string, { amountExGst: number; gst: number; amountIncGst: number }>(),
  );
  const mixedCurrencies = currencyTotals.size > 1;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section>
        <div className="sky-panel p-4 sm:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Timesheets</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {formatDate(periodRange.start)} to {formatDate(periodRange.end)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button tone="neutral" onClick={onCsv}>
                <ArrowDownToLine className="size-4" />
                CSV
              </Button>
              <Button onClick={onPdf}>
                <FileText className="size-4" />
                PDF
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(
              [
                ["today", "Today"],
                ["week", "Week"],
                ["month", "Month"],
                ["fy", "FY"],
                ["annual", "Annual"],
                ["custom", "Custom"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                className={cn(
                  "min-h-11 whitespace-nowrap rounded-xl border px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-3 focus:ring-[var(--accent-subtle)]",
                  period === value
                    ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent-strong)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)]",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {period === "custom" && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Start">
                <Input
                  type="date"
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                />
              </Field>
              <Field label="End">
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(event) => setCustomEnd(event.target.value)}
                />
              </Field>
            </div>
          )}

          <div className="mt-5">
            <EntryTable
              entries={entries}
              projects={projects}
              onDelete={deleteEntry}
            />
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="timer-panel p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
            Period total
          </p>
          <p className="mt-2 text-4xl font-bold tabular">
            {formatDuration(
              entries.reduce((sum, entry) => sum + entry.durationMs, 0),
            )}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            FY starts in {monthName(fyStartMonth)}
          </p>
          <dl className="mt-4 grid gap-2 rounded-2xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--raised)_68%,transparent)] p-3 text-sm">
            {[...currencyTotals.entries()].map(([currency, total]) => (
              <div key={currency} className="grid gap-2">
                {mixedCurrencies && (
                  <p className="text-xs font-semibold text-[var(--muted)]">
                    {currency}
                  </p>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--muted)]">Ex GST</dt>
                  <dd className="font-semibold tabular">
                    {formatCurrency(total.amountExGst, currency)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--muted)]">{AU_GST_LABEL}</dt>
                  <dd className="font-semibold tabular">
                    {formatCurrency(total.gst, currency)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-[var(--border)] pt-2">
                  <dt className="font-semibold">Inc GST</dt>
                  <dd className="font-bold tabular">
                    {formatCurrency(total.amountIncGst, currency)}
                  </dd>
                </div>
              </div>
            ))}
          </dl>
        </section>

        <section className="sky-panel p-4">
          <h3 className="font-semibold">Project totals</h3>
          <div className="mt-3 space-y-3">
            {totals.length === 0 && (
              <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
                No project totals in this range.
              </p>
            )}
            {totals.map((total) => (
              <div
                key={total.project.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{total.project.name}</p>
                  <span className="tabular">
                    {formatDuration(total.durationMs)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[var(--muted)] tabular">
                  Billable {formatDuration(total.billableMs)},{" "}
                  {formatCurrency(total.amountExGst, total.currency)} ex GST
                </p>
                <p className="mt-1 text-xs text-[var(--muted)] tabular">
                  GST {formatCurrency(total.gst, total.currency)}, total{" "}
                  {formatCurrency(total.amountIncGst, total.currency)}
                </p>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

type ReportBranding = {
  companyName: string;
  logoDataUrl: string | null;
  accentColor: string;
};

function ReportBrandingSettings() {
  const [accentColor, setAccentColor] = useState("#2563eb");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoChanged, setLogoChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void api<ReportBranding>("/api/v1/branding")
      .then((branding) => {
        if (cancelled) return;
        setAccentColor(branding.accentColor || "#2563eb");
        setLogoDataUrl(branding.logoDataUrl);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load branding");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
      setError("Use a hex color like #2563eb");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body: { accentColor: string; logoDataUrl?: string | null } = {
        accentColor,
      };
      if (logoChanged) body.logoDataUrl = logoDataUrl;
      const saved = await api<ReportBranding>("/api/v1/branding", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setAccentColor(saved.accentColor);
      setLogoDataUrl(saved.logoDataUrl);
      setLogoChanged(false);
      setMessage("PDF branding saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save branding");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sky-panel p-4 sm:p-5 xl:col-span-2">
      <div className="flex items-center gap-2">
        <FileText className="size-5 text-[var(--accent-strong)]" aria-hidden />
        <h2 className="text-lg font-semibold">PDF reports</h2>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
        Time reports and invoices use this logo and color.
      </p>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <Field label="Accent color">
            <div className="flex min-w-0 items-center gap-2">
              <input
                aria-label="Accent color picker"
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : "#2563eb"}
                onChange={(event) => setAccentColor(event.target.value)}
                className="h-11 w-14 shrink-0 cursor-pointer rounded-xl border border-[var(--border)] bg-[var(--raised)] p-1"
              />
              <div className="min-w-0 flex-1">
                <Input
                  aria-label="Accent color hex"
                  value={accentColor}
                  spellCheck={false}
                  onChange={(event) => setAccentColor(event.target.value)}
                />
              </div>
            </div>
          </Field>
          <Field label="Company logo">
            <input
              aria-label="Company logo"
              type="file"
              accept="image/png,image/jpeg"
              className="block w-full max-w-full overflow-hidden text-sm text-[var(--muted)] file:mr-3 file:whitespace-nowrap file:rounded-lg file:border-0 file:bg-[var(--accent-subtle)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--accent-strong)]"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 1_000_000) {
                  setError("Choose a logo smaller than 1 MB");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  setLogoDataUrl(String(reader.result));
                  setLogoChanged(true);
                  setError("");
                  setMessage("Logo ready. Save to use it on PDFs.");
                };
                reader.onerror = () => setError("Could not read that logo");
                reader.readAsDataURL(file);
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={busy}>
              <Check className="size-4" />
              {busy ? "Saving..." : "Save PDF branding"}
            </Button>
            <Button
              tone="neutral"
              disabled={busy}
              onClick={() => {
                setLogoDataUrl(null);
                setLogoChanged(true);
                setMessage("SkyTime logo will return after you save.");
              }}
            >
              Use SkyTime logo
            </Button>
          </div>
          {message && <p className="text-sm text-[var(--muted)]">{message}</p>}
          {error && <p className="text-sm text-[var(--error)]">{error}</p>}
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
            Preview
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-[var(--border)] bg-white">
            <div className="h-2" style={{ background: accentColor }} />
            <div className="flex min-h-24 items-center px-4 py-3">
              {logoDataUrl ? (
                <img
                  src={logoDataUrl}
                  alt="Company logo preview"
                  className="max-h-12 max-w-[180px] object-contain"
                />
              ) : (
                <p className="text-sm font-semibold text-slate-900">SkyTime</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type StoredPasskey = {
  id: string;
  name?: string | null;
};

function passkeyLabel(name?: string | null) {
  const trimmed = name?.trim();
  return trimmed || "Passkey";
}

function PasskeySettings({ email }: { email: string }) {
  const [rows, setRows] = useState<StoredPasskey[]>([]);
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingRemove, setPendingRemove] = useState("");

  async function refresh() {
    const result = await authClient.passkey.listUserPasskeys();
    if (result.error) {
      setError(result.error.message || "Could not load passkeys");
      return;
    }
    setRows(result.data ?? []);
  }

  useEffect(() => {
    setSupported(typeof PublicKeyCredential !== "undefined");
    void refresh();
  }, []);

  async function addPasskey() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await authClient.passkey.addPasskey({
        name: "This device",
      });
      if (result.error) {
        setError(result.error.message || "Could not add that passkey");
        return;
      }
      setMessage("Passkey added");
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not add that passkey",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(id: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await authClient.passkey.deletePasskey({ id });
      if (result.error) {
        setError(result.error.message || "Could not remove that passkey");
        return;
      }
      setPendingRemove("");
      setMessage("Passkey removed");
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not remove that passkey",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sky-panel p-4 sm:p-5 xl:col-span-2">
      <div className="flex items-center gap-2">
        <Fingerprint
          className="size-5 text-[var(--accent-strong)]"
          aria-hidden
        />
        <h2 className="text-lg font-semibold">Passkeys</h2>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
        Add a passkey for {email}. It signs this account in without the
        password. Password sign-in still asks for the authenticator code when
        that is turned on.
      </p>
      <div className="mt-5 grid gap-3">
        {supported ? (
          <Button onClick={() => void addPasskey()} disabled={busy}>
            <Fingerprint className="size-4" />
            {busy ? "Working..." : "Add passkey"}
          </Button>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            This browser cannot store a passkey.
          </p>
        )}
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No passkey on this account yet.
          </p>
        ) : (
          rows.map((row) => {
            const label = passkeyLabel(row.name);
            return (
              <div
                key={row.id}
                className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="min-w-0 font-semibold">{label}</p>
                {pendingRemove === row.id ? (
                  <Button
                    tone="neutral"
                    disabled={busy}
                    onClick={() => void removePasskey(row.id)}
                  >
                    Remove passkey
                  </Button>
                ) : (
                  <Button
                    tone="neutral"
                    disabled={busy}
                    onClick={() => setPendingRemove(row.id)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            );
          })
        )}
        {message && <p className="text-sm text-[var(--muted)]">{message}</p>}
        {error && <p className="text-sm text-[var(--error)]">{error}</p>}
      </div>
    </section>
  );
}

function SettingsView({
  disableMfa,
  fyStartMonth,
  reminders,
  regenerateBackupCodes,
  requestNotifications,
  sendReminder,
  saveSettings,
  setFyStartMonth,
  setMfa,
  setReminders,
  startMfaSetup,
  organization,
  invites,
  inviteForm,
  setInviteForm,
  createInvite,
  revokeInvite,
  verifyMfaSetup,
  mfa,
  user,
}: {
  disableMfa: () => void;
  fyStartMonth: number;
  reminders: ReminderSettings;
  regenerateBackupCodes: () => void;
  requestNotifications: () => void;
  sendReminder: () => void;
  saveSettings: (settings: {
    reminders?: ReminderSettings;
    fyStartMonth?: number;
  }) => void;
  setFyStartMonth: (value: number) => void;
  setMfa: Dispatch<SetStateAction<MfaState>>;
  setReminders: Dispatch<SetStateAction<ReminderSettings>>;
  startMfaSetup: () => void;
  organization: WorkspacePayload["organization"];
  invites: OrganizationInvite[];
  inviteForm: { email: string; role: "admin" | "member" };
  setInviteForm: Dispatch<
    SetStateAction<{ email: string; role: "admin" | "member" }>
  >;
  createInvite: () => void;
  revokeInvite: (id: string) => void;
  verifyMfaSetup: () => void;
  mfa: MfaState;
  user: WorkspacePayload["user"];
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="sky-panel p-4 sm:p-5 xl:col-span-2">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
              Organization
            </p>
            <h2 className="mt-1 text-lg font-semibold">{organization.name}</h2>
          </div>
          <Pill tone={organization.role === "admin" ? "accent" : "neutral"}>
            {organization.role}
          </Pill>
        </div>

        {organization.role === "admin" && (
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
            <div className="grid gap-3">
              <Field label="Invite email">
                <Input
                  type="email"
                  value={inviteForm.email}
                  onChange={(event) =>
                    setInviteForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Role">
                <Select
                  value={inviteForm.role}
                  onChange={(value) =>
                    setInviteForm((current) => ({
                      ...current,
                      role: value === "admin" ? "admin" : "member",
                    }))
                  }
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </Select>
              </Field>
              <Button onClick={createInvite}>
                <Plus className="size-4" />
                Create invite
              </Button>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              {invites.length === 0 && (
                <p className="p-4 text-sm text-[var(--muted)]">
                  No invites yet. Add someone by email to bring them into this
                  organization.
                </p>
              )}
              {invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex flex-col gap-3 border-t border-[var(--border)] p-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold">{invite.email}</p>
                    <p className="text-sm text-[var(--muted)]">
                      {invite.role}, {invite.status}
                    </p>
                  </div>
                  {invite.status === "pending" && (
                    <Button
                      tone="neutral"
                      onClick={() => revokeInvite(invite.id)}
                    >
                      <Trash2 className="size-4" />
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {organization.role === "admin" && <ReportBrandingSettings />}

      <PasskeySettings email={user.email} />

      <section className="sky-panel p-4 sm:p-5 xl:col-span-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck
                className="size-5 text-[var(--accent-strong)]"
                aria-hidden
              />
              <h2 className="text-lg font-semibold">
                Multi-factor authentication
              </h2>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
              Protect {user.email} with an authenticator app and backup codes.
            </p>
          </div>
          <Pill tone={user.twoFactorEnabled ? "success" : "warning"}>
            {user.twoFactorEnabled ? "Enabled" : "Off"}
          </Pill>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
          <div className="grid gap-3">
            {!user.twoFactorEnabled && (
              <>
                <Field label="Current password">
                  <Input
                    type="password"
                    value={mfa.enablePassword}
                    onChange={(event) =>
                      setMfa((current) => ({
                        ...current,
                        enablePassword: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Button onClick={startMfaSetup}>
                  <KeyRound className="size-4" />
                  {mfa.busy ? "Starting..." : "Set up authenticator"}
                </Button>
              </>
            )}

            {user.twoFactorEnabled && (
              <>
                <Field label="Password for backup codes">
                  <Input
                    type="password"
                    value={mfa.enablePassword}
                    onChange={(event) =>
                      setMfa((current) => ({
                        ...current,
                        enablePassword: event.target.value,
                      }))
                    }
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button tone="neutral" onClick={regenerateBackupCodes}>
                    <KeyRound className="size-4" />
                    Regenerate backup codes
                  </Button>
                </div>
                <Field label="Password to disable">
                  <Input
                    type="password"
                    value={mfa.disablePassword}
                    onChange={(event) =>
                      setMfa((current) => ({
                        ...current,
                        disablePassword: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Button tone="neutral" onClick={disableMfa}>
                  <ShieldCheck className="size-4" />
                  Disable MFA
                </Button>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            {mfa.setupTotpUri ? (
              <div className="grid gap-3">
                <p className="font-semibold">
                  Add this account to your authenticator app
                </p>
                <p className="break-all rounded-xl border border-[var(--border)] bg-[var(--raised)] p-3 text-xs text-[var(--muted)]">
                  {mfa.setupTotpUri}
                </p>
                <Field label="Authenticator code">
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={mfa.setupCode}
                    onChange={(event) =>
                      setMfa((current) => ({
                        ...current,
                        setupCode: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Button onClick={verifyMfaSetup}>
                  <Check className="size-4" />
                  {mfa.busy ? "Verifying..." : "Verify and enable"}
                </Button>
              </div>
            ) : (
              <div className="grid gap-2 text-sm text-[var(--muted)]">
                <p className="font-semibold text-[var(--text)]">
                  Authenticator app setup
                </p>
                <p>
                  SkyTime uses Better Auth TOTP codes. After setup, sign-in will
                  require your password plus a six-digit code.
                </p>
              </div>
            )}

            {mfa.backupCodes.length > 0 && (
              <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--raised)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Backup codes</p>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-strong)]"
                    onClick={() => {
                      void navigator.clipboard?.writeText(
                        mfa.backupCodes.join("\n"),
                      );
                    }}
                  >
                    <Copy className="size-3.5" />
                    Copy
                  </button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {mfa.backupCodes.map((code) => (
                    <code
                      key={code}
                      className="rounded-lg bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text)]"
                    >
                      {code}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="sky-panel p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <AlarmClock
            className="size-5 text-[var(--accent-strong)]"
            aria-hidden
          />
          <h2 className="text-lg font-semibold">Reminder cadence</h2>
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Browser reminders can prompt you to capture the last block of work.
        </p>

        <div className="mt-5 grid gap-4">
          <Toggle
            checked={reminders.enabled}
            label="Enable reminders"
            onChange={(enabled) => {
              const next = { ...reminders, enabled };
              setReminders(next);
              saveSettings({ reminders: next });
            }}
          />
          <Field label="Every">
            <Select
              value={String(reminders.cadenceMinutes)}
              onChange={(value) => {
                const next = { ...reminders, cadenceMinutes: Number(value) };
                setReminders(next);
                saveSettings({ reminders: next });
              }}
            >
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="120">2 hours</option>
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button tone="neutral" onClick={requestNotifications}>
              <Bell className="size-4" />
              Allow notifications
            </Button>
            <Button tone="neutral" onClick={sendReminder}>
              <Check className="size-4" />
              Test now
            </Button>
          </div>
        </div>
      </section>

      <section className="sky-panel p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <CalendarRange
            className="size-5 text-[var(--accent-strong)]"
            aria-hidden
          />
          <h2 className="text-lg font-semibold">Export defaults</h2>
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Financial year presets use this start month for reports and exports.
        </p>
        <div className="mt-5 max-w-sm">
          <Field label="Financial year starts">
            <Select
              value={String(fyStartMonth)}
              onChange={(value) => {
                const next = Number(value);
                setFyStartMonth(next);
                saveSettings({ fyStartMonth: next });
              }}
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map(
                (month) => (
                  <option key={month} value={month}>
                    {monthName(month)}
                  </option>
                ),
              )}
            </Select>
          </Field>
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
            <p className="font-semibold">Tax code</p>
            <p className="mt-1 text-[var(--muted)]">
              {AU_GST_LABEL}. Project rates are treated as ex GST and exports
              add 10% GST.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function EntryTable({
  entries,
  onDelete,
  projects,
}: {
  entries: TimeEntry[];
  onDelete?: (id: string) => void;
  projects: Project[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--raised)] shadow-[var(--soft-shadow)]">
      <div className="grid gap-2 p-3 md:hidden">
        {entries.length === 0 && (
          <div className="mx-auto grid max-w-sm justify-items-center gap-2 px-4 py-8 text-center text-[var(--muted)]">
            <Clock3
              className="size-8 text-[var(--accent-strong)]"
              aria-hidden
            />
            <p className="font-semibold text-[var(--text)]">
              No time entries yet
            </p>
            <p className="text-sm">
              Start your first timer and SkyTime will begin building your
              timesheet automatically.
            </p>
          </div>
        )}
        {entries.map((entry) => {
          const project = projects.find((item) => item.id === entry.projectId);
          return (
            <article
              key={entry.id}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    {formatDate(new Date(entry.startedAt))}
                  </p>
                  <p className="mt-1 truncate font-semibold">{entry.task}</p>
                  <p className="mt-1 flex min-w-0 items-center gap-2 text-sm text-[var(--muted)]">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: project?.color ?? "var(--border)" }}
                    />
                    <span className="truncate">
                      {project?.name ?? "Unknown project"}
                    </span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular">
                    {formatDuration(entry.durationMs)}
                  </p>
                  <div className="mt-1">
                    {entry.billable ? (
                      <Pill tone="success">Billable</Pill>
                    ) : (
                      <Pill>Internal</Pill>
                    )}
                  </div>
                </div>
              </div>
              {entry.notes && (
                <p className="mt-3 text-sm text-[var(--muted)]">
                  {entry.notes}
                </p>
              )}
              {entry.locked && (
                <p className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--muted)]">
                  <Lock className="size-3.5" aria-hidden /> Locked by approved
                  week
                </p>
              )}
              {onDelete && !entry.locked && (
                <button
                  type="button"
                  onClick={() => onDelete(entry.id)}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--raised)] px-3 text-sm font-semibold text-[var(--muted)]"
                >
                  <Trash2 className="size-4" />
                  Delete entry
                </button>
              )}
            </article>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-[var(--surface)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Project</th>
              <th className="px-4 py-3 font-semibold">Task</th>
              <th className="px-4 py-3 font-semibold">Duration</th>
              <th className="px-4 py-3 font-semibold">Billable</th>
              {onDelete && <th className="px-4 py-3 font-semibold">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td
                  className="px-4 py-10 text-center text-[var(--muted)]"
                  colSpan={onDelete ? 6 : 5}
                >
                  <div className="mx-auto grid max-w-sm justify-items-center gap-2">
                    <Clock3
                      className="size-8 text-[var(--accent-strong)]"
                      aria-hidden
                    />
                    <p className="font-semibold text-[var(--text)]">
                      No time entries yet
                    </p>
                    <p className="text-sm">
                      Start your first timer and SkyTime will begin building
                      your timesheet automatically.
                    </p>
                  </div>
                </td>
              </tr>
            )}
            {entries.map((entry) => {
              const project = projects.find(
                (item) => item.id === entry.projectId,
              );
              return (
                <tr
                  key={entry.id}
                  className="border-t border-[var(--border)] transition-colors hover:bg-[var(--accent-subtle)]"
                >
                  <td className="whitespace-nowrap px-4 py-3 tabular">
                    {formatDate(new Date(entry.startedAt))}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="size-2 rounded-full"
                        style={{
                          background: project?.color ?? "var(--border)",
                        }}
                      />
                      {project?.name ?? "Unknown project"}
                    </span>
                  </td>
                  <td className="max-w-sm px-4 py-3">
                    <p className="font-semibold">{entry.task}</p>
                    {entry.notes && (
                      <p className="truncate text-xs text-[var(--muted)]">
                        {entry.notes}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold tabular">
                    {formatDuration(entry.durationMs)}
                  </td>
                  <td className="px-4 py-3">
                    {entry.billable ? (
                      <Pill tone="success">Yes</Pill>
                    ) : (
                      <Pill>No</Pill>
                    )}
                  </td>
                  {onDelete && (
                    <td className="px-4 py-3">
                      {entry.locked ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--muted)]">
                          <Lock className="size-3.5" aria-hidden /> Locked
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onDelete(entry.id)}
                          className="inline-flex items-center gap-1 rounded-xl border border-[var(--border)] px-2 py-1 text-xs font-semibold text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionHeader({ action, title }: { action?: string; title: string }) {
  return (
    <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      {action && <p className="text-sm text-[var(--muted)]">{action}</p>}
    </div>
  );
}

function Field({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--raised)] px-3 text-base outline-none transition-colors placeholder:text-[color-mix(in_oklch,var(--muted)_68%,transparent)] hover:border-[color-mix(in_oklch,var(--sky)_58%,var(--border))] focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent-subtle)] sm:text-sm",
        props.className,
      )}
    />
  );
}

function AddressInput({
  onChange,
  placeholder,
  value,
}: {
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const load = loadGooglePlaces();
    if (!load) return;

    let cancelled = false;
    let listener: { remove?: () => void } | null = null;

    load
      .then((google) => {
        if (cancelled || !inputRef.current) return;
        const autocomplete = new google.maps.places.Autocomplete(
          inputRef.current,
          {
            fields: ["formatted_address"],
            types: ["address"],
          },
        );
        listener = autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          if (place.formatted_address)
            onChangeRef.current(place.formatted_address);
        });
      })
      .catch(() => {
        // Silently fall back to a plain text input.
      });

    return () => {
      cancelled = true;
      listener?.remove?.();
    };
  }, []);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--raised)] px-3 text-base outline-none transition-colors placeholder:text-[color-mix(in_oklch,var(--muted)_68%,transparent)] hover:border-[color-mix(in_oklch,var(--sky)_58%,var(--border))] focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent-subtle)] sm:text-sm"
    />
  );
}

function Select({
  children,
  onChange,
  value,
}: {
  children: React.ReactNode;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <span className="relative block">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--raised)] px-3 pr-9 text-base outline-none transition-colors hover:border-[color-mix(in_oklch,var(--sky)_58%,var(--border))] focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent-subtle)] sm:text-sm"
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-3 size-4 text-[var(--muted)]"
        aria-hidden
      />
    </span>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl text-left text-sm font-semibold focus:outline-none focus:ring-3 focus:ring-[var(--accent-subtle)]"
    >
      <span
        className={cn(
          "relative h-6 w-11 rounded-full border border-[var(--border)] transition-colors",
          checked ? "bg-[var(--accent)] shadow-sm" : "bg-[var(--surface)]",
        )}
        aria-hidden
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-[var(--raised)] shadow-sm transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </span>
      {label}
    </button>
  );
}

function Button({
  children,
  onClick,
  disabled = false,
  tone = "primary",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "primary" | "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-4 text-sm font-semibold transition-colors focus:outline-none focus:ring-3 focus:ring-[var(--accent-subtle)] disabled:cursor-wait disabled:opacity-60 max-sm:w-full",
        tone === "primary" &&
          "border-[var(--accent-strong)] bg-[var(--accent)] text-[var(--raised)] shadow-[0_10px_24px_color-mix(in_oklch,var(--accent)_24%,transparent)] hover:bg-[var(--accent-strong)]",
        tone === "neutral" &&
          "border-[var(--border)] bg-[var(--raised)] text-[var(--text)] shadow-sm hover:bg-[var(--surface)]",
        tone === "danger" &&
          "border-[var(--error)] bg-[var(--error)] text-[var(--raised)] shadow-[0_10px_24px_color-mix(in_oklch,var(--error)_24%,transparent)] hover:bg-[color-mix(in_oklch,var(--error)_88%,var(--text))]",
      )}
    >
      {children}
    </button>
  );
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "error";
}) {
  const tones = {
    accent:
      "border-[color-mix(in_oklch,var(--accent)_45%,var(--border))] bg-[var(--accent-subtle)] text-[var(--accent-strong)] shadow-sm",
    error:
      "border-[color-mix(in_oklch,var(--error)_45%,var(--border))] bg-[var(--error-soft)] text-[var(--error)]",
    neutral: "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]",
    success:
      "border-[color-mix(in_oklch,var(--success)_45%,var(--border))] bg-[var(--success-soft)] text-[var(--success)]",
    warning:
      "border-[color-mix(in_oklch,var(--warning)_45%,var(--border))] bg-[var(--warning-soft)] text-[var(--warning)]",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

function getPeriodRange(
  preset: PeriodPreset,
  fyStartMonth: number,
  customStart: string,
  customEnd: string,
) {
  const now = new Date();

  if (preset === "today") return { start: startOfDay(now), end: endOfDay(now) };
  if (preset === "week") return { start: startOfWeek(now), end: endOfDay(now) };
  if (preset === "month")
    return { start: startOfMonth(now), end: endOfDay(now) };
  if (preset === "annual")
    return { start: new Date(now.getFullYear(), 0, 1), end: endOfDay(now) };
  if (preset === "custom")
    return {
      start: startOfDay(new Date(`${customStart}T00:00:00`)),
      end: endOfDay(new Date(`${customEnd}T00:00:00`)),
    };

  const fyMonthIndex = fyStartMonth - 1;
  const year =
    now.getMonth() >= fyMonthIndex ? now.getFullYear() : now.getFullYear() - 1;
  return { start: new Date(year, fyMonthIndex, 1), end: endOfDay(now) };
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return next;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isInsideRange(date: Date, start: Date, end: Date) {
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

function toDateInput(date: Date) {
  // Inputs and period boundaries use the browser's local calendar, not UTC.
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "full" }).format(date);
}

function formatClock(date: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
  })
    .format(date)
    .toLowerCase();
}

function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function formatDurationWords(ms: number) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours} hr ${minutes} min`;
  if (hours) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${minutes} min`;
}

function formatDecimalHours(ms: number) {
  return (ms / 3600000).toFixed(2);
}

function formatCurrency(value: number, currency = "AUD") {
  // Intl throws RangeError for non-ISO codes; legacy rows may carry anything.
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "AUD";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: code,
  }).format(value);
}

function currencyForProject(project: Project, clients: Client[]) {
  return (
    clients.find((client) => client.id === project.clientId)?.currency ?? "AUD"
  );
}

function monthName(month: number) {
  return new Intl.DateTimeFormat("en-AU", { month: "long" }).format(
    new Date(2026, month - 1, 1),
  );
}

function getTotals(entries: TimeEntry[], projects: Project[]) {
  const totals = new Map<string, { durationMs: number; billableMs: number }>();

  entries.forEach((entry) => {
    const current = totals.get(entry.projectId) ?? {
      durationMs: 0,
      billableMs: 0,
    };
    current.durationMs += entry.durationMs;
    if (entry.billable) current.billableMs += entry.durationMs;
    totals.set(entry.projectId, current);
  });

  return projects.flatMap((project) => {
    const total = totals.get(project.id);
    if (!total) return [];
    // Entries snapshot their currency when recorded; never sum across
    // currencies without saying which one the amounts are in.
    const currency =
      entries.find((entry) => entry.projectId === project.id && entry.currency)
        ?.currency ?? "AUD";
    const amountExGst = entries
      .filter((entry) => entry.projectId === project.id && entry.billable)
      .reduce(
        (sum, entry) =>
          sum +
          Math.round(
            (entry.durationMs / 3600000) *
              (entry.hourlyRate ?? project.rate) *
              100,
          ) /
            100,
        0,
      );
    const gst = amountExGst * AU_GST_RATE;

    return [
      {
        project,
        currency,
        durationMs: total.durationMs,
        billableMs: total.billableMs,
        amountExGst,
        gst,
        amountIncGst: amountExGst + gst,
      },
    ];
  });
}

class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;

  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(
      typeof data.error === "string" ? data.error : "Request failed",
      response.status,
      data,
    );
  }

  return data as T;
}

function getPendingInviteId() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("invite") ?? "";
}

async function exportCsv(
  entries: TimeEntry[],
  projects: Project[],
  range: { start: Date; end: Date },
  showToast: (message: string, tone?: "success" | "error") => void,
) {
  try {
    const params = new URLSearchParams({
      from: toDateInput(range.start),
      to: toDateInput(range.end),
      format: "csv",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    const response = await fetch(`/api/v1/reports/export?${params}`);
    if (!response.ok)
      throw new Error((await response.json()).error || "Export failed");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `skytime-${toDateInput(range.start)}-${toDateInput(range.end)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("CSV exported", "success");
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : "CSV export failed",
      "error",
    );
  }
}

async function exportPdf(
  entries: TimeEntry[],
  projects: Project[],
  range: { start: Date; end: Date },
  user: WorkspacePayload["user"],
  organization: WorkspacePayload["organization"],
  showToast: (message: string, tone?: "success" | "error") => void,
) {
  try {
    const params = new URLSearchParams({
      from: toDateInput(range.start),
      to: toDateInput(range.end),
      format: "pdf",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    const response = await fetch(`/api/v1/reports/export?${params}`);
    if (!response.ok)
      throw new Error((await response.json()).error || "Export failed");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `skytime-${toDateInput(range.start)}-${toDateInput(range.end)}.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("PDF exported", "success");
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : "PDF export failed",
      "error",
    );
  }
}

function upsertPeriod(list: TimesheetPeriod[], next: TimesheetPeriod) {
  const index = list.findIndex((item) => item.id === next.id);
  if (index === -1) return [next, ...list];
  const copy = list.slice();
  copy[index] = next;
  return copy;
}

function ClientsView({
  addClient,
  archiveClient,
  clients,
  entries,
  newClient,
  projects,
  setNewClient,
}: {
  addClient: () => void;
  archiveClient: (id: string) => void;
  clients: Client[];
  entries: TimeEntry[];
  newClient: NewClientForm;
  projects: Project[];
  setNewClient: Dispatch<SetStateAction<NewClientForm>>;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
      <section className="sky-panel p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Building2
            className="size-5 text-[var(--accent-strong)]"
            aria-hidden
          />
          <h2 className="text-lg font-semibold">Create client</h2>
        </div>
        <div className="mt-4 grid gap-3">
          <Field label="Client name">
            <Input
              value={newClient.name}
              onChange={(event) =>
                setNewClient((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Primary contact">
            <Input
              value={newClient.contactName}
              onChange={(event) =>
                setNewClient((current) => ({
                  ...current,
                  contactName: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Contact email">
            <Input
              type="email"
              value={newClient.contactEmail}
              onChange={(event) =>
                setNewClient((current) => ({
                  ...current,
                  contactEmail: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Address">
            <AddressInput
              value={newClient.address}
              onChange={(address) =>
                setNewClient((current) => ({ ...current, address }))
              }
              placeholder="Start typing to search…"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Currency">
              <Input
                value={newClient.currency}
                onChange={(event) =>
                  setNewClient((current) => ({
                    ...current,
                    currency: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Default rate">
              <Input
                inputMode="decimal"
                value={newClient.defaultRate}
                onChange={(event) =>
                  setNewClient((current) => ({
                    ...current,
                    defaultRate: event.target.value,
                  }))
                }
              />
            </Field>
          </div>
          <Field label="Notes">
            <Input
              value={newClient.notes}
              onChange={(event) =>
                setNewClient((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
            />
          </Field>
          <Button onClick={addClient}>
            <Plus className="size-4" />
            Create client
          </Button>
        </div>
      </section>

      <section>
        <SectionHeader
          title="Clients"
          action={`${clients.filter((client) => !client.archivedAt).length} active`}
        />
        <div className="grid gap-3 md:grid-cols-2">
          {clients.length === 0 && (
            <EmptyState
              icon={Users}
              title="No clients yet"
              message="Create your first client to capture contact, address, currency, and default rate. Projects can then point at the client by reference."
            />
          )}
          {clients.map((client) => {
            const clientProjects = projects.filter(
              (project) =>
                project.clientId === client.id ||
                project.client === client.name,
            );
            const clientMs = entries
              .filter((entry) =>
                clientProjects.some(
                  (project) => project.id === entry.projectId,
                ),
              )
              .reduce((sum, entry) => sum + entry.durationMs, 0);
            return (
              <article
                key={client.id}
                className={cn(
                  "sky-panel p-4",
                  client.archivedAt && "opacity-60",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{client.name}</h3>
                    {client.contactName && (
                      <p className="mt-1 text-sm text-[var(--muted)] truncate">
                        {client.contactName}
                      </p>
                    )}
                    {client.contactEmail && (
                      <p className="text-sm text-[var(--muted)] truncate">
                        {client.contactEmail}
                      </p>
                    )}
                  </div>
                  <Pill tone={client.archivedAt ? "warning" : "success"}>
                    {client.archivedAt ? "Archived" : "Active"}
                  </Pill>
                </div>
                {client.address && (
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    {client.address}
                  </p>
                )}
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-[var(--muted)]">Default rate</dt>
                    <dd className="mt-1 font-semibold tabular">
                      {client.defaultRate > 0
                        ? `${formatCurrency(client.defaultRate, client.currency)}/hr`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--muted)]">Tracked</dt>
                    <dd className="mt-1 font-semibold tabular">
                      {formatDuration(clientMs)}
                    </dd>
                  </div>
                </dl>
                {client.notes && (
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    {client.notes}
                  </p>
                )}
                {!client.archivedAt && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      tone="neutral"
                      onClick={() => archiveClient(client.id)}
                    >
                      <Trash2 className="size-4" />
                      Archive
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ApprovalsView({
  currentPeriod,
  currentUserId,
  isAdmin,
  periods,
  reload,
  reviewPeriod,
  setSubmitNote,
  submitCurrentPeriod,
  submitNote,
}: {
  currentPeriod: TimesheetPeriod | null;
  currentUserId: string;
  isAdmin: boolean;
  periods: TimesheetPeriod[];
  reload: () => void;
  reviewPeriod: (
    id: string,
    action: "approve" | "reject" | "reopen",
    note?: string,
  ) => void;
  setSubmitNote: Dispatch<SetStateAction<string>>;
  submitCurrentPeriod: () => void;
  submitNote: string;
}) {
  const myPeriods = periods.filter((period) => period.userId === currentUserId);
  const reviewQueue = periods.filter((period) => period.status === "submitted");
  const others = periods.filter((period) => period.userId !== currentUserId);

  return (
    <div className="grid gap-5">
      <section className="sky-panel p-4 sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">This week</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {currentPeriod
                ? `${currentPeriod.periodStart} → ${currentPeriod.periodEnd}`
                : "No active period."}
            </p>
          </div>
          {currentPeriod && <PeriodStatusPill status={currentPeriod.status} />}
        </div>
        {currentPeriod && (
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat
              label="Total tracked"
              value={formatDuration(currentPeriod.totalMs)}
            />
            <Stat label="Status" value={currentPeriod.status} />
            <Stat
              label="Submitted"
              value={
                currentPeriod.submittedAt
                  ? formatDate(new Date(currentPeriod.submittedAt))
                  : "—"
              }
            />
          </dl>
        )}
        {currentPeriod && currentPeriod.status !== "approved" && (
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <Field label="Note for reviewer (optional)">
              <Input
                value={submitNote}
                onChange={(event) => setSubmitNote(event.target.value)}
              />
            </Field>
            <Button onClick={submitCurrentPeriod}>
              <CheckCircle2 className="size-4" />
              Submit for review
            </Button>
          </div>
        )}
        {currentPeriod && currentPeriod.note && (
          <p className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--muted)]">
            Reviewer note: {currentPeriod.note}
          </p>
        )}
      </section>

      {isAdmin && (
        <section className="sky-panel p-4 sm:p-5">
          <SectionHeader
            title="Awaiting your review"
            action={`${reviewQueue.length} pending`}
          />
          {reviewQueue.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
              No timesheets are waiting for approval right now.
            </p>
          ) : (
            <div className="grid gap-3">
              {reviewQueue.map((period) => (
                <PeriodCard
                  key={period.id}
                  period={period}
                  isAdmin
                  onApprove={() => reviewPeriod(period.id, "approve")}
                  onReject={() => reviewPeriod(period.id, "reject")}
                  onReopen={() => reviewPeriod(period.id, "reopen")}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <SectionHeader
          title="My timesheets"
          action={`${myPeriods.length} weeks`}
        />
        {myPeriods.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
            Your previous timesheet weeks will appear here once you submit one.
          </p>
        ) : (
          <div className="grid gap-3">
            {myPeriods.map((period) => (
              <PeriodCard key={period.id} period={period} isAdmin={false} />
            ))}
          </div>
        )}
      </section>

      {isAdmin && others.length > 0 && (
        <section>
          <SectionHeader
            title="Team history"
            action={`${others.length} weeks`}
          />
          <div className="grid gap-3">
            {others.map((period) => (
              <PeriodCard
                key={period.id}
                period={period}
                isAdmin
                onApprove={
                  period.status === "submitted"
                    ? () => reviewPeriod(period.id, "approve")
                    : undefined
                }
                onReject={
                  period.status === "submitted"
                    ? () => reviewPeriod(period.id, "reject")
                    : undefined
                }
                onReopen={
                  period.status === "approved" || period.status === "rejected"
                    ? () => reviewPeriod(period.id, "reopen")
                    : undefined
                }
              />
            ))}
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={reload}
        className="justify-self-start rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:text-[var(--text)]"
      >
        Refresh
      </button>
    </div>
  );
}

function PeriodStatusPill({ status }: { status: TimesheetPeriod["status"] }) {
  if (status === "approved") return <Pill tone="success">Approved</Pill>;
  if (status === "submitted") return <Pill tone="accent">Submitted</Pill>;
  if (status === "rejected") return <Pill tone="error">Rejected</Pill>;
  return <Pill>Draft</Pill>;
}

function PeriodCard({
  isAdmin,
  onApprove,
  onReject,
  onReopen,
  period,
}: {
  isAdmin: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onReopen?: () => void;
  period: TimesheetPeriod;
}) {
  return (
    <article className="sky-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
            {period.periodStart} → {period.periodEnd}
          </p>
          <p className="mt-1 font-semibold">
            {period.userEmail ?? period.userId}
          </p>
          <p className="mt-1 text-sm tabular text-[var(--muted)]">
            {formatDuration(period.totalMs)} tracked
            {period.submittedAt
              ? ` · submitted ${formatDate(new Date(period.submittedAt))}`
              : ""}
            {period.reviewedAt && period.reviewerEmail
              ? ` · reviewed by ${period.reviewerEmail}`
              : ""}
          </p>
          {period.note && (
            <p className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 text-sm text-[var(--muted)]">
              {period.note}
            </p>
          )}
        </div>
        <PeriodStatusPill status={period.status} />
      </div>
      {isAdmin && (onApprove || onReject || onReopen) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {onApprove && (
            <Button onClick={onApprove}>
              <CheckCircle2 className="size-4" /> Approve
            </Button>
          )}
          {onReject && (
            <Button tone="neutral" onClick={onReject}>
              <X className="size-4" /> Reject
            </Button>
          )}
          {onReopen && (
            <Button tone="neutral" onClick={onReopen}>
              <Edit3 className="size-4" /> Reopen
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-2 text-lg font-bold tabular">{value}</p>
    </div>
  );
}

function AuditLogView({
  entries,
  reload,
}: {
  entries: AuditLogEntry[];
  reload: () => void;
}) {
  return (
    <section className="sky-panel p-4 sm:p-5">
      <SectionHeader
        title="Audit log"
        action={`${entries.length} recent events`}
      />
      <div className="mb-3">
        <button
          type="button"
          onClick={reload}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:text-[var(--text)]"
        >
          Refresh
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
          No audit events yet. Mutations on projects, time entries, clients,
          tasks, invites, and timesheets will appear here.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--raised)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-[var(--surface)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">When</th>
                  <th className="px-4 py-3 font-semibold">Actor</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                  <th className="px-4 py-3 font-semibold">Entity</th>
                  <th className="px-4 py-3 font-semibold">Summary</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="whitespace-nowrap px-4 py-3 tabular">
                      {formatDate(new Date(entry.createdAt))}
                    </td>
                    <td className="px-4 py-3">
                      {entry.userEmail ?? entry.userId ?? "system"}
                    </td>
                    <td className="px-4 py-3">
                      <Pill>{entry.action}</Pill>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {entry.entityType}
                    </td>
                    <td className="px-4 py-3">{entry.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function ErrorLogView({
  entries,
  reload,
}: {
  entries: ErrorLogEntry[];
  reload: () => void;
}) {
  return (
    <section className="sky-panel p-4 sm:p-5">
      <SectionHeader
        title="Error log"
        action={`${entries.length} recent events`}
      />
      <div className="mb-3">
        <button
          type="button"
          onClick={reload}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:text-[var(--text)]"
        >
          Refresh
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
          No captured errors. Unhandled API exceptions and validation failures
          will appear here for triage.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--raised)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-[var(--surface)] text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">When</th>
                  <th className="px-4 py-3 font-semibold">Level</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Endpoint</th>
                  <th className="px-4 py-3 font-semibold">Message</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="whitespace-nowrap px-4 py-3 tabular">
                      {formatDate(new Date(entry.createdAt))}
                    </td>
                    <td className="px-4 py-3">
                      <Pill
                        tone={
                          entry.level === "error"
                            ? "error"
                            : entry.level === "warn"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {entry.level}
                      </Pill>
                    </td>
                    <td className="px-4 py-3 tabular">
                      {entry.statusCode ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                      {entry.method ?? ""} {entry.path ?? ""}
                    </td>
                    <td className="px-4 py-3">{entry.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
