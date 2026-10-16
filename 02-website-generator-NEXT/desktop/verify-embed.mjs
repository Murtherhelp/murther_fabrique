/**
 * The build prints the size of what it embedded. It never reads the executable
 * back. That gap is exactly where a stale build hides: dist/ is rebuilt, the
 * resource compiler is handed the file it was given, and if anything between
 * those two points drifts -- a cached resource, a dist written after the embed,
 * a build that skipped step 1 -- the exe ships yesterday's editor and the log
 * still says the right byte count.
 *
 * So this reads the finished file and looks for the payload inside it, byte
 * for byte. It exits 0 with a message when there is no executable yet, because
 * `npm run verify` must not require a Windows build to have been run.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");

const PAYLOADS = [
  ["NEXT", join(repo, "02-website-generator-NEXT", "dist", "generator.html")],
  ["ORIGINAL", join(repo, "01-legacy-generator-ORIGINAL", "index.html")],
];

const exe = process.argv[2] || join(repo, "MutherFabrique.exe");

if (!existsSync(exe)) {
  console.log(`  no executable at ${exe} -- nothing to check (run npm run dist:windows first)`);
  process.exit(0);
}

const bin = readFileSync(exe);
const problems = [];

for (const [name, path] of PAYLOADS) {
  if (!existsSync(path)) {
    problems.push(`${name}: the payload it should contain is missing (${path})`);
    continue;
  }
  const payload = readFileSync(path);
  const at = bin.indexOf(payload);
  if (at < 0) {
    // Say what is actually there, not just that something is wrong.
    const head = payload.subarray(0, 96).toString("utf8");
    const near = bin.indexOf(Buffer.from(head, "utf8"));
    problems.push(
      `${name}: dist/generator.html (${payload.length} bytes) is NOT in the executable. ` +
      (near >= 0
        ? `The first 96 bytes are there at ${near}, so an older, shorter build is embedded.`
        : `Not even its first 96 bytes are present.`)
    );
    continue;
  }
  console.log(`  ${name.padEnd(9)} ${String(payload.length).padStart(7)} bytes, found verbatim at offset ${at}`);
}

if (problems.length) {
  for (const p of problems) console.log(`  FAIL ${p}`);
  console.log("");
  console.log("  The executable does not contain what dist/ holds. Rebuild before shipping.");
  process.exit(1);
}

console.log(`  executable ${bin.length} bytes, both payloads present verbatim`);