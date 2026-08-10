import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";

const options = parseArgs(process.argv.slice(2));
for (const key of ["codex", "input-root", "output-root", "prompt", "reply", "events", "diagnostics", "model", "reasoning", "verbosity"]) {
  if (!options[key]) throw new Error(`Missing --${key}`);
}
const inputRoot = await realpath(path.resolve(options["input-root"]));
const outputRoot = await realpath(path.resolve(options["output-root"]));
assertDisjoint(inputRoot, outputRoot);
for (const key of ["prompt", "reply", "events", "diagnostics"]) assertInside(outputRoot, path.resolve(options[key]));
await mkdir(path.dirname(path.resolve(options.reply)), { recursive: true });
const prompt = await readFile(path.resolve(options.prompt), "utf8");
const events = createWriteStream(path.resolve(options.events), { flags: "w" });
const diagnostics = createWriteStream(path.resolve(options.diagnostics), { flags: "w" });
const child = spawn(path.resolve(options.codex), [
  "exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write",
  "-c", 'approval_policy="never"',
  "-m", options.model,
  "-c", `model_reasoning_effort=${JSON.stringify(options.reasoning)}`,
  "-c", `model_verbosity=${JSON.stringify(options.verbosity)}`,
  "-C", outputRoot, "-o", path.resolve(options.reply), "-",
], { cwd: outputRoot, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
child.stdout.pipe(events); child.stderr.pipe(diagnostics); child.stdin.end(prompt);
const exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
await Promise.all([finished(events), finished(diagnostics)]);
process.exitCode = Number.isInteger(exitCode) ? exitCode : 1;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, "");
    if (key) result[key] = argv[index + 1];
  }
  return result;
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative === ".") return;
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Project-skill output path escapes output-root.");
}

function assertDisjoint(left, right) {
  const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  const a = normalize(left); const b = normalize(right);
  const nested = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);
  if (nested(a, b) || nested(b, a)) throw new Error("Project-skill input-root and output-root must be disjoint.");
}
