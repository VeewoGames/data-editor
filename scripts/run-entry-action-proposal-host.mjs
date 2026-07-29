import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";

const options = parseArgs(process.argv.slice(2));
for (const key of ["codex", "scratch", "prompt", "reply", "events", "diagnostics", "model", "reasoning", "verbosity"]) {
  if (!options[key]) throw new Error(`Missing --${key}`);
}
await mkdir(path.dirname(path.resolve(options.reply)), { recursive: true });
const prompt = await readFile(path.resolve(options.prompt), "utf8");
const eventsStream = createWriteStream(path.resolve(options.events), { flags: "w" });
const diagnosticsStream = createWriteStream(path.resolve(options.diagnostics), { flags: "w" });
const child = spawn(path.resolve(options.codex), [
  "exec",
  "--ignore-user-config",
  "--ignore-rules",
  "--ephemeral",
  "--json",
  "--skip-git-repo-check",
  "--sandbox",
  "read-only",
  "-m",
  options.model,
  "-c",
  `model_reasoning_effort=${JSON.stringify(options.reasoning)}`,
  "-c",
  `model_verbosity=${JSON.stringify(options.verbosity)}`,
  "-C",
  path.resolve(options.scratch),
  "-o",
  path.resolve(options.reply),
  "-",
], {
  cwd: path.resolve(options.scratch),
  shell: false,
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
});
child.stdout.pipe(eventsStream);
child.stderr.pipe(diagnosticsStream);
child.stdin.end(prompt);
const exitCode = await new Promise((resolve, reject) => {
  child.once("error", (error) => {
    eventsStream.end();
    diagnosticsStream.end();
    reject(error);
  });
  child.once("exit", resolve);
});
await Promise.all([finished(eventsStream), finished(diagnosticsStream)]);
process.exitCode = Number.isInteger(exitCode) ? exitCode : 1;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, "");
    if (key) result[key] = argv[index + 1];
  }
  return result;
}
