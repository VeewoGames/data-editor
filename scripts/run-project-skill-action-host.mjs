import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";

const options = parseArgs(process.argv.slice(2));
for (const key of ["codex", "workspace-root", "output-root", "prompt", "reply", "events", "diagnostics", "model", "reasoning", "verbosity"]) {
  if (!options[key]) throw new Error(`Missing --${key}`);
}
const workspaceRoot = await realpath(path.resolve(options["workspace-root"]));
const outputRoot = await realpath(path.resolve(options["output-root"]));
for (const key of ["prompt", "reply", "events", "diagnostics"]) assertInside(outputRoot, path.resolve(options[key]));
await mkdir(path.dirname(path.resolve(options.reply)), { recursive: true });
const prompt = await readFile(path.resolve(options.prompt), "utf8");
const events = createWriteStream(path.resolve(options.events), { flags: "w" });
const diagnostics = createWriteStream(path.resolve(options.diagnostics), { flags: "w" });
const child = spawn(path.resolve(options.codex), [
  "exec", "--ignore-user-config", ...(options["ignore-rules"] ? ["--ignore-rules"] : []), "--ephemeral", "--json", "--skip-git-repo-check", "--sandbox", "danger-full-access",
  "-c", 'approval_policy="never"',
  "-m", options.model,
  "-c", `model_reasoning_effort=${JSON.stringify(options.reasoning)}`,
  "-c", `model_verbosity=${JSON.stringify(options.verbosity)}`,
  "-C", workspaceRoot, "-o", path.resolve(options.reply), "-",
], { cwd: workspaceRoot, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
child.stdout.pipe(events); child.stderr.pipe(diagnostics); child.stdin.end(prompt);
const exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
await Promise.all([finished(events), finished(diagnostics)]);
process.exitCode = Number.isInteger(exitCode) ? exitCode : 1;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]?.replace(/^--/, "");
    if (!key) continue;
    if (key === "ignore-rules") {
      result[key] = true;
      continue;
    }
    result[key] = argv[index + 1];
    index += 1;
  }
  return result;
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative === ".") return;
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Project-skill output path escapes output-root.");
}
