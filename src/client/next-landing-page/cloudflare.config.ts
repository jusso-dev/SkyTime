import { bindings, defineConfig, defineWorker } from "cf/config";

const d1Id = process.env.CLOUDFLARE_D1_ID;

export default defineConfig({
  worker: defineWorker({
    name: "skytime",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-10-10",
    compatibilityFlags: ["nodejs_compat"],
    assets: { notFoundHandling: "none" },
    domains: ["skytime.yarndigi.com.au"],
    workersDev: true,
    env: {
      ASSETS: bindings.assets(),
      DB: bindings.d1({
        name: "skytime",
        ...(d1Id ? { id: d1Id } : {}),
      }),
      ATTACHMENTS: bindings.r2({ name: "skytime-attachments" }),
      EMAIL: bindings.sendEmail({
        allowedSenderAddresses: ["noreply@yarndigi.au"],
      }),
    },
  }),
});
