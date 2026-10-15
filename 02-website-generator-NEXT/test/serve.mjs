/**
 * The suite's own server.
 *
 * Every probe suite ships as its own npm script - `npm run test:browser`,
 * `test:a11y`, and so on - but all four died with "no server on :5199" unless
 * you remembered that only `npm run verify` starts one. The script promised a
 * thing it could not do alone.
 *
 * The app reads PORT once at startup, so each probe keeps its own port. This
 * boots that server, adopts one that is already answering (so `verify` can
 * still boot them all up front if it wants), and kills only what it started.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const alive = (port) =>
  fetch(`http://localhost:${port}/`).then((r) => r.ok).catch(() => false);

/**
 * Make sure something is serving the app on `port`.
 * @returns {Promise<() => void>} stops the server, unless it was already up.
 */
export async function serve(port) {
  if (await alive(port)) return () => {};

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  // The child's own stderr would interleave with the probe output.
  child.stdout.resume();
  child.stderr.resume();

  const until = Date.now() + 8000;
  while (Date.now() < until) {
    if (await alive(port)) return () => child.kill();
    await new Promise((r) => setTimeout(r, 150));
  }
  child.kill();
  throw new Error(`server did not start on ${port}`);
}