import { z } from "zod";
import { TIME_ENTRY_TASK_MAX } from "@/lib/validation";
export const id = z.string().uuid();
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );
export const text = z.string().trim().min(1).max(200);
export const money = z.number().finite().min(0).max(99999999).multipleOf(0.01);
export const currency = z.string().regex(/^[A-Z]{3}$/);
export const entryTask = z.string().trim().min(1).max(TIME_ENTRY_TASK_MAX);
export const tags = z.array(z.string().trim().min(1).max(60)).max(20);
export const entry = z.object({
  projectId: id,
  task: entryTask,
  notes: z.string().max(5000).optional(),
  startedAt: z.string().datetime({ offset: true }),
  durationMs: z.number().int().positive().max(2147483647),
  billable: z.boolean().optional(),
  tags: tags.optional(),
  taskId: id.nullable().optional(),
});
export const project = z.object({
  name: text,
  clientId: id.nullable().optional(),
  client: z.string().max(200).optional(),
  rate: money.optional(),
  costRate: money.optional(),
  color: z.string().max(80).optional(),
  status: z.enum(["Active", "Paused"]).optional(),
  budgetHours: money.optional(),
  budgetAmount: money.optional(),
  deadline: date.nullable().optional(),
  notes: z.string().max(5000).optional(),
});
export const client = z.object({
  name: text,
  contactName: z.string().max(200).optional(),
  contactEmail: z.union([z.string().email(), z.literal("")]).optional(),
  address: z.string().max(500).optional(),
  currency: currency.optional(),
  defaultRate: money.optional(),
  notes: z.string().max(5000).optional(),
  archived: z.boolean().optional(),
});
export const task = z.object({
  projectId: id,
  title: text,
  status: z.enum(["Backlog", "Today", "Doing", "Done"]).optional(),
  estimateHours: money.optional(),
});
export const filters = z.object({
  from: date.optional(),
  to: date.optional(),
  projectId: id.optional(),
  clientId: id.optional(),
  userId: z.string().max(200).optional(),
  tag: z.string().max(60).optional(),
  search: z.string().max(200).optional(),
  billable: z.boolean().optional(),
  invoiced: z.boolean().optional(),
  groupBy: z.enum(["project", "client", "member", "day", "tag"]).optional(),
  roundMinutes: z.number().int().min(0).max(60).optional(),
  timezone: z.string().max(100).optional(),
});
export const branding = z.object({
  companyName: z.string().max(200).optional(),
  address: z.string().max(1000).optional(),
  email: z.union([z.string().email(), z.literal("")]).optional(),
  taxId: z.string().max(100).optional(),
  footer: z.string().max(1000).optional(),
  logoDataUrl: z
    .string()
    .max(1400000)
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/)
    .nullable()
    .optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  taxPercent: z.number().min(0).max(100).multipleOf(0.01).optional(),
  currency: currency.optional(),
  timezone: z.string().max(100).optional(),
});
