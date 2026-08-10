import crypto from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { atomicWrite } from "./atomic-file.mjs";

const ID = /^[A-Za-z0-9._-]+$/;

export function createProjectTransactionOwnerResolver({ executables = new Map([["node", process.execPath]]), spawnProcess = spawn, jobSupervisor = null } = {}) {
  if (!(executables instanceof Map) || typeof spawnProcess !== "function") fail("PROJECT_TRANSACTION_OWNER_ADAPTER_REGISTRY_INVALID");
  const executableRegistry = new Map(executables);
  return Object.freeze({
    async resolve(ownerId, input) {
      const descriptor = (await loadProjectOwnerConfig(input.projectRoot)).owners.find((item) => item.ownerId === ownerId);
      if (!descriptor || descriptor.capabilityId !== input.capabilityId) return null;
      if (descriptor.adapterId !== "json-command-v1") fail("PROJECT_TRANSACTION_OWNER_ADAPTER_UNAVAILABLE");
      const command = executableRegistry.get(descriptor.config.executableId);
      if (typeof command !== "string" || !path.isAbsolute(command)) fail("PROJECT_TRANSACTION_OWNER_ADAPTER_UNAVAILABLE");
      const entry = await resolveAllowedEntry(input.projectRoot, descriptor.config.allowedDirectory, descriptor.config.entry);
      return (ownerInput, control) => invokeJsonCommandOwner({ ownerInput, control, descriptor, command, entry, spawnProcess, jobSupervisor });
    },
  });
}

export async function loadProjectOwnerConfig(projectRoot) {
  let value;
  try { value = JSON.parse(await readFile(path.join(path.resolve(projectRoot), ".data-editor", "project-transaction-owners.json"), "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return { version: 1, owners: [] }; throw error; }
  exact(value, ["owners", "version"]); if (value.version !== 1 || !Array.isArray(value.owners)) fail("PROJECT_TRANSACTION_OWNER_CONFIG_INVALID");
  const ids = new Set();
  const owners = value.owners.map((item) => {
    exact(item, ["adapterId", "capabilityId", "config", "ownerId"]);
    if (!ID.test(item.ownerId) || !ID.test(item.capabilityId) || item.adapterId !== "json-command-v1" || ids.has(item.ownerId)) fail("PROJECT_TRANSACTION_OWNER_CONFIG_INVALID");
    ids.add(item.ownerId); const config = item.config; exact(config, ["allowedDirectory", "entry", "executableId", "fixedArgs"]);
    if (!ID.test(config.executableId) || typeof config.allowedDirectory !== "string" || !config.allowedDirectory || typeof config.entry !== "string" || !config.entry || !Array.isArray(config.fixedArgs) || config.fixedArgs.some((arg) => typeof arg !== "string" || arg.includes("\0"))) fail("PROJECT_TRANSACTION_OWNER_CONFIG_INVALID");
    return structuredClone(item);
  });
  return { version: 1, owners };
}

export async function recoverProjectTransactionOwnerResults({ projectContext, publish }) {
  if (typeof publish !== "function") fail("PROJECT_TRANSACTION_RECOVERY_INVALID");
  const directory = path.join(path.resolve(projectContext.projectRoot), ".data-editor", "runtime", "project-transactions");
  let names; try { names = await readdir(directory); } catch (error) { if (error?.code === "ENOENT") return { recovered: [], pending: [] }; throw error; }
  const recovered = []; const pending = [];
  for (const name of names.filter((item) => item.endsWith(".json") && !item.endsWith(".result.json")).sort()) {
    const journalPath = path.join(directory, name); const journal = await readJournal(journalPath);
    if (!journal || !["started", "pending", "completed"].includes(journal.state)) continue;
    const result = journal.state === "completed" ? journal.result : await readJournal(path.join(directory, `${journal.runId}.result.json`)); if (!result) continue;
    if (result.runId !== journal.runId || result.ownerId !== journal.ownerId || result.capabilityId !== journal.capabilityId || result.subjectDigest !== journal.subjectDigest || typeof result.changed !== "boolean" || !plain(result.receipt)) fail("PROJECT_TRANSACTION_OWNER_RECEIPT_INVALID");
    if (journal.state !== "completed") await atomicWrite(journalPath, `${JSON.stringify({ ...journal, state: "completed", result }, null, 2)}\n`);
    await publish({ runId: journal.runId, actionId: journal.actionId, changed: result.changed, receipt: result.receipt, message: journal.message });
    await atomicWrite(journalPath, `${JSON.stringify({ ...journal, state: "published", result, publishedAt: new Date().toISOString() }, null, 2)}\n`);
    recovered.push(journal.runId);
  }
  for (const name of names.filter((item) => item.endsWith(".json") && !item.endsWith(".result.json")).sort()) { const journal = await readJournal(path.join(directory, name)); if (journal && ["started", "pending"].includes(journal.state)) pending.push(journal.runId); }
  return { recovered, pending };
}

async function invokeJsonCommandOwner({ ownerInput, control, descriptor, command, entry, spawnProcess, jobSupervisor }) {
  const journalPath = transactionJournalPath(ownerInput.projectRoot, ownerInput.runId);
  const resultPath = transactionResultPath(ownerInput.projectRoot, ownerInput.runId);
  await mkdir(path.dirname(journalPath), { recursive: true });
  const requestDigest = digest(stable(envelope(ownerInput, null)));
  const existing = await readJournal(journalPath);
  if (existing) {
    if (existing.requestDigest !== requestDigest || existing.ownerId !== ownerInput.ownerId || existing.capabilityId !== ownerInput.capabilityId) fail("PROJECT_TRANSACTION_IDEMPOTENCY_CONFLICT");
    if (["completed", "published"].includes(existing.state)) return existing.result;
    if (existing.state === "terminal") fail(existing.errorCode || "PROJECT_TRANSACTION_OWNER_FAILED");
    const recovered = await readJournal(resultPath);
    if (recovered) { validateCommandResult(recovered, ownerInput); await atomicWrite(journalPath, `${JSON.stringify({ ...existing, state: "completed", result: recovered }, null, 2)}\n`); return recovered; }
    return { pending: true, receipt: { version: 1, state: "recovery_required", journalDigest: digest(stable(existing)) } };
  }
  const started = { version: 1, state: "started", runId: ownerInput.runId, actionId: ownerInput.actionId, ownerId: ownerInput.ownerId, capabilityId: ownerInput.capabilityId, requestDigest, subjectDigest: ownerInput.subjectDigest, deadline: control.deadline, message: ownerInput.message };
  try { await writeFile(journalPath, `${JSON.stringify(started, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); }
  catch (error) { if (error?.code === "EEXIST") return invokeJsonCommandOwner({ ownerInput, control, descriptor, command, entry, spawnProcess }); throw error; }
  let result;
  try { result = await runJsonCommand({ command, args: [entry, ...descriptor.config.fixedArgs], cwd: ownerInput.projectRoot, input: envelope(ownerInput, control.deadline, resultPath), signal: control.signal, spawnProcess, jobSupervisor, runId: ownerInput.runId, resultPath }); }
  catch (error) { if (["PROJECT_TRANSACTION_ABORT_ACKNOWLEDGED", "PROJECT_TRANSACTION_OWNER_FAILED"].includes(error?.code)) await atomicWrite(journalPath, `${JSON.stringify({ ...started, state: "terminal", outcome: "failed", errorCode: error.code, terminalAt: new Date().toISOString() }, null, 2)}\n`); throw error; }
  if (result?.pending === true) { await atomicWrite(journalPath, `${JSON.stringify({ ...started, state: "pending", recovery: result.receipt }, null, 2)}\n`); return result; }
  validateCommandResult(result, ownerInput);
  const durableResult = await readJournal(resultPath); if (!durableResult || stable(durableResult) !== stable(result)) fail("PROJECT_TRANSACTION_OWNER_RECEIPT_INVALID");
  await atomicWrite(journalPath, `${JSON.stringify({ ...started, state: "completed", result }, null, 2)}\n`);
  return result;
}

async function runJsonCommand(options) {
  if (options.jobSupervisor) return runSupervisedJsonCommand(options);
  return runDirectJsonCommand(options);
}

async function runSupervisedJsonCommand({ command, args, cwd, input, signal, jobSupervisor, runId, resultPath }) {
  const inputPath = path.join(path.dirname(resultPath), `${runId}.input.json`); await atomicWrite(inputPath, `${JSON.stringify(input)}\n`);
  const hostPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "run-project-transaction-owner-host.mjs");
  const handle = await jobSupervisor.start({ id: runId, command: process.execPath, args: [hostPath, "--command", command, "--entry", args[0], "--input", inputPath, ...args.slice(1).flatMap((arg) => ["--fixed-arg", arg])], cwd, timeoutMs: Math.max(1, input.deadline - Date.now()) });
  let termination = null;
  let wakeAbort;
  const abortRequested = new Promise((resolve) => { wakeAbort = resolve; });
  const completionObserved = Promise.resolve(handle.completion).then(
    (terminal) => ({ kind: "completion", terminal, error: null }),
    (error) => ({ kind: "completion-error", terminal: null, error }),
  );
  const requestTermination = () => {
    termination ??= Promise.resolve().then(() => handle.terminate("timeout")).then(
      (terminal) => ({ confirmed: confirmedTerminal(terminal), terminal, error: null }),
      (error) => ({ confirmed: false, terminal: null, error }),
    );
    return termination;
  };
  const abort = () => { void requestTermination(); wakeAbort({ kind: "abort", terminal: null, error: null }); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) abort();
    const observed = signal.aborted ? { kind: "abort", terminal: null, error: null } : await Promise.race([completionObserved, abortRequested]);
    if (observed.kind === "abort") {
      const confirmation = await requestTermination();
      if (!confirmation.confirmed) return pendingTermination("termination_unconfirmed", confirmation.error);
      const durable = await readJournal(resultPath); if (durable) return durable;
      throw abortAcknowledged();
    }
    if (observed.kind === "completion-error") return pendingTermination("ownership_or_completion_lost", observed.error);
    const terminal = observed.terminal;
    if (terminal.timedOut) {
      if (!confirmedTerminal(terminal)) return pendingTermination("termination_unconfirmed", null);
      const durable = await readJournal(resultPath); if (durable) return durable;
      throw abortAcknowledged();
    }
    if (terminal.exitCode !== 0) fail("PROJECT_TRANSACTION_OWNER_FAILED");
    const result = await readJournal(resultPath); if (!result) fail("PROJECT_TRANSACTION_OWNER_RECEIPT_INVALID"); return result;
  } finally { signal.removeEventListener("abort", abort); }
}

function confirmedTerminal(value) { return plain(value) && Number.isInteger(value.exitCode); }
function abortAcknowledged() { return Object.assign(new Error("Project owner acknowledged termination."), { code: "PROJECT_TRANSACTION_ABORT_ACKNOWLEDGED" }); }
function pendingTermination(state, error) { return { pending: true, receipt: { version: 1, state, ...(typeof error?.code === "string" ? { code: error.code } : {}) } }; }

function runDirectJsonCommand({ command, args, cwd, input, signal, spawnProcess }) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let aborted = signal.aborted;
    const abort = () => { aborted = true; try { child.kill(); } catch {} };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; if (Buffer.byteLength(stdout, "utf8") > 1024 * 1024) child.kill(); });
    child.stderr.on("data", (chunk) => { stderr += chunk; if (Buffer.byteLength(stderr, "utf8") > 64 * 1024) child.kill(); });
    child.once("error", reject);
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (aborted) return reject(Object.assign(new Error("Project owner acknowledged termination."), { code: "PROJECT_TRANSACTION_ABORT_ACKNOWLEDGED" }));
      if (code !== 0) return reject(Object.assign(new Error(`Project owner exited with code ${code}: ${stderr}`), { code: "PROJECT_TRANSACTION_OWNER_FAILED" }));
      try { resolve(JSON.parse(stdout)); } catch { reject(Object.assign(new Error("Project owner returned invalid JSON."), { code: "PROJECT_TRANSACTION_RESULT_INVALID" })); }
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

async function resolveAllowedEntry(projectRoot, allowedDirectory, entry) {
  const root = await realpath(path.resolve(projectRoot)); const allowed = await realpath(path.resolve(root, allowedDirectory)); const target = await realpath(path.resolve(root, entry));
  if (!inside(root, allowed) || !inside(allowed, target)) fail("PROJECT_TRANSACTION_OWNER_ENTRY_FORBIDDEN");
  return target;
}
function envelope(input, deadline, resultPath = null) { return { version: 1, runId: input.runId, projectId: input.projectId, actionId: input.actionId, ownerId: input.ownerId, capabilityId: input.capabilityId, subject: input.subject, subjectDigest: input.subjectDigest, payload: input.payload, ...(deadline === null ? {} : { deadline, resultPath }), fencingDigest: digest(`${input.runId}:${input.subjectDigest}`) }; }
function validateCommandResult(value, input) { exact(value, ["capabilityId", "changed", "ownerId", "receipt", "runId", "subjectDigest", "version"], "PROJECT_TRANSACTION_RESULT_INVALID"); if (value.version !== 1 || value.runId !== input.runId || value.ownerId !== input.ownerId || value.capabilityId !== input.capabilityId || value.subjectDigest !== input.subjectDigest || typeof value.changed !== "boolean" || !plain(value.receipt)) fail("PROJECT_TRANSACTION_RESULT_INVALID"); }
function transactionJournalPath(projectRoot, runId) { if (!ID.test(runId)) fail("PROJECT_TRANSACTION_RESULT_INVALID"); return path.join(path.resolve(projectRoot), ".data-editor", "runtime", "project-transactions", `${runId}.json`); }
function transactionResultPath(projectRoot, runId) { if (!ID.test(runId)) fail("PROJECT_TRANSACTION_RESULT_INVALID"); return path.join(path.resolve(projectRoot), ".data-editor", "runtime", "project-transactions", `${runId}.result.json`); }
async function readJournal(target) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { return JSON.parse(await readFile(target, "utf8")); }
    catch (error) { if (error?.code === "ENOENT") return null; if (!(error instanceof SyntaxError) || attempt === 5) throw error; await delay(10 * (attempt + 1)); }
  }
  return null;
}
function inside(root, target) { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function exact(value, fields, code = "PROJECT_TRANSACTION_OWNER_CONFIG_INVALID") { if (!plain(value) || Object.keys(value).sort().join(",") !== [...fields].sort().join(",")) fail(code); }
function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (plain(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function digest(value) { return crypto.createHash("sha256").update(value, "utf8").digest("hex"); }
function fail(code) { throw Object.assign(new Error(code), { code }); }
