/**
 * Boots the app's own server on each probe port and runs every suite.
 *
 *   npm run verify
 *
 * Each browser suite needs its own port because the app reads PORT once at
 * startup. Starting them here means one command checks everything, and no
 * stale server from a previous run can make a suite pass against stale code.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { platform } from "node:process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_BROWSER = process.argv.includes("--no-browser");

/** Ports per suite, matching each probe's default. */
const SUITES = [
  { name: "core",       port: null,    cmd: ["--test", "test/test.mjs"], node: true },
  { name: "browser",    port: 5199,     cmd: ["test/browser.mjs"] },
  { name: "accessibility", port: 5200,  cmd: ["test/a11y.mjs"] },
  { name: "i18n",       port: 5201,     cmd: ["test/i18n.mjs"] },
  { name: "export",     port: 5202,     cmd: ["test/export.mjs"] },
  // No server: it opens dist/generator.html over file://, which is the whole point.
  { name: "single-file", port: null,    cmd: ["test/single.mjs"], node: true }
];

const run = (cmd, args, env) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [cmd, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: "inherit",
      shell: false
    });
    p.on("exit", (code) => resolve(code ?? 1));
    p.on("error", () => resolve(1));
  });

const up = (port) =>
  fetch(`http://localhost:${port}/`)
    .then((r) => r.ok)
    .catch(() => false);

/** Wait for the server to answer, or give up rather than hang. */
async function waitFor(port, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await up(port)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

let failed = 0;
const summary = [];

for (const suite of SUITES) {
  if (SKIP_BROWSER && suite.port) {
    console.log(`\n--- ${suite.name}: skipped (--no-browser) ---\n`);
    continue;
  }

  console.log(`\n--- ${suite.name} ---`);
  let server = null;

  if (suite.port) {
    server = spawn(process.execPath, ["server.mjs"], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(suite.port) },
      stdio: ["ignore", "pipe", "pipe"],
      // Keep the child's console from interleaving with the test output.
      windowsHide: true
    });
    if (!(await waitFor(suite.port))) {
      console.error(`  server did not start on ${suite.port}`);
      failed++;
      summary.push([suite.name, "no server"]);
      server.kill();
      continue;
    }
  }

  const code = suite.node
    ? await run(suite.cmd[0], suite.cmd.slice(1), {})
    : await run(suite.cmd[0], suite.cmd.slice(1), { WGN_PORT: String(suite.port), PORT: String(suite.port) });

  server?.kill();
  if (code !== 0) {
    failed++;
    summary.push([suite.name, "failed"]);
  } else {
    summary.push([suite.name, "passed"]);
  }
}

console.log(`\n${"=".repeat(46)}`);
for (const [name, state] of summary) {
  console.log(`  ${state === "passed" ? "PASS" : "FAIL"}  ${name}`);
}
console.log(`${"=".repeat(46)}`);
process.exit(failed ? 1 : 0);