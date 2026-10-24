import { spawn } from "node:child_process";
import {withHistoricalScopeEffect} from './historical-disposition.mjs';
import { projectCommandFile, commandError } from "./project-command-snapshot.mjs";

/** A fixed project declaration, never a client-supplied command or shell. */
export async function executeProjectCommand(context, command, input) {
  const script = await projectCommandFile(context, command.path);
  const started=await withHistoricalScopeEffect(()=>({completion:new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...command.args], { cwd: context.projectRoot, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", failure = null;
    const timer = setTimeout(() => { failure = commandError("PROJECT_COMMAND_TIMEOUT"); child.kill(); }, command.timeoutMs);
    child.stdout.on("data", chunk => { stdout += chunk; if (Buffer.byteLength(stdout) > 1024 * 1024) { failure = commandError("PROJECT_COMMAND_OUTPUT_LIMIT"); child.kill(); } });
    child.stderr.on("data", chunk => { if (stderr.length < 16384) stderr += chunk; });
    child.stdin.on("error", () => {});
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (code !== 0) return reject(commandError("PROJECT_COMMAND_FAILED", stderr || `Project command exited ${code}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(commandError("PROJECT_COMMAND_RESULT_INVALID")); }
    });
    child.stdin.end(JSON.stringify(input));
  })}),context);
  return started.completion;
}

