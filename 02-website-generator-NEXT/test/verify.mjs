/**
 * Runs every suite in one command.
 *
 *   npm run verify
 *
 * No server is started here: each browser suite starts the one it needs (see
 * test/serve.mjs), which is also what lets `npm run test:browser` work on its
 * own. Ports still differ per suite, because the app reads PORT once at
 * startup, so no suite can collide with another.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
  { name: "single-file", port: null,    cmd: ["test/single.mjs"], node: true },
  // Serves the archived generator on an ephemeral port, so it has no fixed one.
  // Still a browser suite: --no-browser has to skip it.
  { name: "original",   port: null, browser: true, cmd: ["test/original.mjs"] },
  // Plain HTTP, no browser: --no-browser must still run it.
  { name: "server",     port: 5203, browser: false, cmd: ["test/server.mjs"] }
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

let failed = 0;
const summary = [];

for (const suite of SUITES) {
  if (SKIP_BROWSER && (suite.browser ?? !!suite.port)) {
    console.log(`\n--- ${suite.name}: skipped (--no-browser) ---\n`);
    continue;
  }

  console.log(`\n--- ${suite.name} ---`);
  const code = suite.node
    ? await run(suite.cmd[0], suite.cmd.slice(1), {})
    : await run(suite.cmd[0], suite.cmd.slice(1), { WGN_PORT: String(suite.port) });

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