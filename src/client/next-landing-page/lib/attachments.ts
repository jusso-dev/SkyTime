import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

type R2Object = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
};

type R2Bucket = {
  put: (
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ) => Promise<unknown>;
  get: (key: string) => Promise<R2Object | null>;
  delete: (key: string) => Promise<void>;
};

const globalState = globalThis as unknown as { skytimeAttachments?: R2Bucket };

function onWorkers(): boolean {
  const runtime = (globalThis as { skytimeRuntime?: string }).skytimeRuntime;
  if (runtime) return runtime === "workers";
  const userAgent = globalThis.navigator?.userAgent;
  return typeof userAgent === "string" && userAgent.includes("Cloudflare-Workers");
}

function attachmentKey(organizationId: string) {
  if (!/^[A-Za-z0-9-]+$/.test(organizationId)) {
    throw new Error("Invalid organization id");
  }
  return `branding/${organizationId}/logo`;
}

function localPath(key: string) {
  return path.resolve("data", "attachments", key);
}

async function bucket(): Promise<R2Bucket> {
  if (globalState.skytimeAttachments) return globalState.skytimeAttachments;
  const specifier = "cloudflare:workers";
  const mod = (await import(/* webpackIgnore: true */ specifier)) as {
    env?: { ATTACHMENTS?: R2Bucket };
  };
  const bound = mod.env?.ATTACHMENTS;
  if (!bound) throw new Error("R2 binding ATTACHMENTS is required on Cloudflare Workers");
  globalState.skytimeAttachments = bound;
  return bound;
}

export function sniffImage(bytes: Uint8Array) {
  const png =
    bytes.length >= 8 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71;
  if (png) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216) return "image/jpeg";
  throw new Error("Attachment is not a PNG or JPEG");
}

export async function putLogo(organizationId: string, bytes: Uint8Array, contentType: string) {
  const key = attachmentKey(organizationId);
  if (onWorkers()) {
    await (await bucket()).put(key, bytes, { httpMetadata: { contentType } });
    return key;
  }
  const file = localPath(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return key;
}

export async function getLogo(key: string) {
  if (!/^branding\/[A-Za-z0-9-]+\/logo$/.test(key)) return null;
  if (onWorkers()) {
    const object = await (await bucket()).get(key);
    if (!object) return null;
    const bytes = new Uint8Array(await object.arrayBuffer());
    return {
      bytes,
      contentType: object.httpMetadata?.contentType || sniffImage(bytes),
    };
  }
  try {
    const bytes = new Uint8Array(await readFile(localPath(key)));
    return { bytes, contentType: sniffImage(bytes) };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function deleteLogo(key: string) {
  if (!/^branding\/[A-Za-z0-9-]+\/logo$/.test(key)) return;
  if (onWorkers()) {
    await (await bucket()).delete(key);
    return;
  }
  await rm(localPath(key), { force: true });
}
