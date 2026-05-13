export type Project = {
  id: string;
  name: string;
  client: string;
  clientId: string | null;
  rate: number;
  color: string;
  status: "Active" | "Paused";
};

export type TimeEntry = {
  id: string;
  projectId: string;
  userId: string | null;
  task: string;
  notes: string;
  startedAt: string;
  durationMs: number;
  billable: boolean;
  locked: boolean;
};

export type BoardStatus = "Backlog" | "Today" | "Doing" | "Done";

export type BoardTask = {
  id: string;
  projectId: string;
  title: string;
  status: BoardStatus;
  estimateHours: number;
};

export type Client = {
  id: string;
  name: string;
  contactName: string;
  contactEmail: string;
  address: string;
  currency: string;
  defaultRate: number;
  notes: string;
  archivedAt: string | null;
};

export type TimesheetPeriodStatus = "draft" | "submitted" | "approved" | "rejected";

export type TimesheetPeriod = {
  id: string;
  userId: string;
  userEmail: string | null;
  periodStart: string;
  periodEnd: string;
  status: TimesheetPeriodStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewerEmail: string | null;
  note: string;
  totalMs: number;
};

export type AuditLogEntry = {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  createdAt: string;
};

export type ErrorLogEntry = {
  id: string;
  level: "error" | "warn" | "info";
  message: string;
  path: string | null;
  method: string | null;
  statusCode: number | null;
  createdAt: string;
};

export type ReminderSettings = {
  enabled: boolean;
  cadenceMinutes: number;
  lastSentAt?: string;
};

export type WorkspaceSettings = {
  reminders: ReminderSettings;
  fyStartMonth: number;
};

export type WorkspacePayload = {
  user: {
    id: string;
    email: string;
    name?: string;
    twoFactorEnabled: boolean;
  };
  organization: {
    id: string;
    name: string;
    role: "admin" | "member";
  };
  clients: Client[];
  projects: Project[];
  entries: TimeEntry[];
  tasks: BoardTask[];
  currentPeriod: TimesheetPeriod | null;
  settings: WorkspaceSettings;
};

export type OrganizationInvite = {
  id: string;
  email: string;
  role: "admin" | "member";
  status: "pending" | "accepted" | "revoked";
  createdAt: string;
  emailSent?: boolean;
  inviteUrl?: string;
};
