import { spawn } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";

const [cliPath, scratchPath, promptPath, outputPath] = process.argv.slice(2);
if (![cliPath, scratchPath, promptPath, outputPath].every(Boolean)) throw new Error("codex CLI host arguments are required");
const prompt = await readFile(promptPath, "utf8");
const child = spawn(cliPath, ["exec", "--json", "--skip-git-repo-check", "-C", scratchPath, "-"], { cwd: scratchPath, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
await writeFile(`${outputPath}.pids.json`, `${JSON.stringify({ hostPid: process.pid, codexPid: child.pid })}\n`);
child.stdout.on("data", (chunk) => { void appendFile(outputPath, chunk); });
child.stderr.on("data", (chunk) => { void appendFile(`${outputPath}.stderr`, chunk); });
child.on("error", (error) => { throw error; });
// `close` waits for every inherited output pipe. A completed Codex root may
// still have a descendant holding one open; Job ownership, not this host,
// closes that descendant. Publish root termination promptly so the supervisor
// can close the complete tree and settle its owned completion.
child.on("exit", (code) => process.exit(code ?? 1));
child.stdin.end(prompt);
