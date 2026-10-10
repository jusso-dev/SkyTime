// CI dependency audit gate: fails on any high or critical advisory, except
// advisories explicitly accepted below. Each exception must say why it is
// accepted and be removed as soon as a patched release exists.
import { execFileSync } from "node:child_process";

const ACCEPTED = new Map([
  [
    // braces <= 3.0.3 stack-exhaustion DoS on deeply nested patterns. No
    // patched release exists. It is reached only at build time
    // (vinext > vite-plugin-commonjs > vite-plugin-dynamic-import > fast-glob
    // > micromatch) to expand glob patterns written in our own source, never
    // with request input. See jusso-dev/SkyTime#2.
    "GHSA-vfj7-8cjw-p6xm",
    "no patched braces release; build-time only, no untrusted input",
  ],
]);
const BLOCKING = new Set(["high", "critical"]);

let raw;
try {
  raw = execFileSync("npm", ["audit", "--json"], { encoding: "utf8" });
} catch (error) {
  // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
  raw = error.stdout;
  if (!raw) throw error;
}
const report = JSON.parse(raw);
// Fail closed: a registry, network or lockfile error still prints JSON, but
// with an `error` object and no vulnerability report.
if (report.error || !report.vulnerabilities || typeof report.vulnerabilities !== "object") {
  console.error("npm audit did not return a usable report:", JSON.stringify(report.error ?? report));
  process.exit(1);
}
const advisories = new Map();
for (const [name, vuln] of Object.entries(report.vulnerabilities)) {
  for (const via of vuln.via ?? []) {
    if (typeof via === "string") continue;
    const id = String(via.url ?? "").split("/").pop() || String(via.source);
    advisories.set(id, { name, severity: via.severity, title: via.title });
  }
}
const blocking = [];
for (const [id, a] of advisories) {
  if (!BLOCKING.has(a.severity)) continue;
  if (ACCEPTED.has(id)) {
    console.log(`accepted ${a.severity} ${id} (${a.name}): ${ACCEPTED.get(id)}`);
  } else {
    blocking.push(`${a.severity} ${id} (${a.name}): ${a.title}`);
  }
}
for (const id of ACCEPTED.keys()) {
  if (!advisories.has(id)) {
    console.log(`note: accepted advisory ${id} no longer reported; remove it from scripts/audit.mjs`);
  }
}
if (blocking.length) {
  console.error("High or critical advisories:\n" + blocking.join("\n"));
  process.exit(1);
}
console.log("No unaccepted high or critical advisories.");
