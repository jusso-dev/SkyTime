import { bindings, defineConfig, defineWorker, triggers } from "cf/config";

const databaseId = "20f6aadd-0fc1-4f86-98f5-b0c4da08af38";

export default defineConfig({
  worker: defineWorker({
    name: "skytime-d1-backup",
    entrypoint: "./src/index.ts",
    compatibilityDate: "2026-10-10",
    workersDev: false,
    previewUrls: false,
    observability: {
      enabled: true,
      logs: { enabled: true, invocationLogs: true },
    },
    // 16:00 UTC. 03:00 Sydney during AEDT, 02:00 during AEST.
    triggers: [triggers.scheduled({ schedule: "0 16 * * *" })],
    env: {
      BACKUPS: bindings.r2({ name: "skytime-d1-backups" }),
      DB: bindings.d1({ name: "skytime", id: databaseId }),
    },
  }),
});
