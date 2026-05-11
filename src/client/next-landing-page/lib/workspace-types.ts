export type Project = {
  id: string;
  name: string;
  client: string;
  rate: number;
  color: string;
  status: "Active" | "Paused";
};

export type TimeEntry = {
  id: string;
  projectId: string;
  task: string;
  notes: string;
  startedAt: string;
  durationMs: number;
  billable: boolean;
};

export type BoardStatus = "Backlog" | "Today" | "Doing" | "Done";

export type BoardTask = {
  id: string;
  projectId: string;
  title: string;
  status: BoardStatus;
  estimateHours: number;
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
  projects: Project[];
  entries: TimeEntry[];
  tasks: BoardTask[];
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
