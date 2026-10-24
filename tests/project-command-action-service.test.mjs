import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { startProjectCommandEntryAction, executeProjectCommand } from "../src/project-command-action-service.mjs";
import { submitFreshEntryActionProposal } from "../src/entry-action-service.mjs";
import { commandDigest } from "../src/project-command-snapshot.mjs";
import { createProjectContext } from "../src/project-context.mjs";
import { rowDigest } from "../src/row-digest.mjs";
import { readEntryActionResult, findActiveEntryActionRuns } from "../src/entry-actions.mjs";
import { assertOrdinarySaveFieldPolicy, ordinarySaveBlockingRuns } from "../src/field-write-policy.mjs";
import { createDocumentCommitCoordinator } from "../src/document-commit-coordinator.mjs";
import { canonicalFileIdentity } from "../src/canonical-file-identity.mjs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { recoverProjectCommandRun } from "../src/project-command-recovery.mjs";
import { serviceProcessIsAlive, readServiceProcessIdentity } from "../src/service-process-identity.mjs";
import net from "node:net";
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
async function fixture(t, extra = "") {
  const root = await mkdtemp(path.join(os.tmpdir(), "editor-command-"));
  const ownedChildren = [];
  t.after(async () => {
    for (const { child, exit } of ownedChildren) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exit;
    }
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 30 });
  });
  await mkdir(path.join(root, "data")); await mkdir(path.join(root, ".data-editor"));
  const row = { __entry_id: "row-1", source: "x", generated: "old", description_sources: {} };
  const command = { path: "command.mjs", args: [], readDependencies: ["dependency.json"], timeoutMs: 3000 };
  await writeFile(path.join(root, "command.mjs"), `let text='';for await(const part of process.stdin)text+=part;const input=JSON.parse(text);${extra};console.log(JSON.stringify({kind:'entry-action-proposal',changes:[{field:'generated',beforeExists:true,before:input.entry.row.generated,afterExists:true,after:'new'}],summary:'updated',evidence:[]}));`);
  await writeFile(path.join(root, "data/items.json"), JSON.stringify([row]));
  await writeFile(path.join(root, "dependency.json"), "{}");
  await writeFile(path.join(root, ".data-editor/automation-profile.json"), JSON.stringify({ rules: [{ id: "compile", label: "Compile", icon: "refresh", enabled: true, targets: [{ file: "data/items.json", collection: "$" }], payload: { includeRow: true, includeNeighbors: false }, execution: { kind: "project-command", resultPolicy: "proposal", command, allowConcurrentSave: true }, contractId: "fixture.command.v1" }] }));
  const contract = { contractId: "fixture.command.v1", version: 1, predicate: { all: [] }, writableFields: ["generated"], legalTransitions: [], textArtifactPolicy: {}, evidencePolicy: {}, resultPolicy: "proposal", createAuthority: null };
  await writeFile(path.join(root, ".data-editor/entry-action-contracts.json"), JSON.stringify({ version: 1, contracts: [{ ...contract, digest: commandDigest(canonical(contract)) }] }));
  const context = createProjectContext(root);
  const request = { actionId: "compile", sourcePath: "data/items.json", collectionPath: "$", rowId: "row-1", expectedRowDigest: rowDigest(row), locales: ["zh"] };
  return { root, row, context, command, request, ownChild: (child, exit) => ownedChildren.push({ child, exit }), input: { projectContext: context, project: { id: "fixture" }, request } };
}
test("fixed project command commits through the existing row journal", async t => {
  const f = await fixture(t); const started = await startProjectCommandEntryAction(f.input);
  await started.completion;
  assert.equal(JSON.parse(await readFile(path.join(f.root, "data/items.json"), "utf8"))[0].generated, "new");
  assert.equal((await readEntryActionResult(f.context, started.runId)).outcome, "completed_with_writeback");
});

async function crashedFixture(t, stage, setup) {
  const f = await fixture(t, stage === "running" ? "await new Promise(resolve=>setTimeout(resolve,600))" : "");
  if (setup) await setup(f);
  const driver = path.join(f.root, "service-fixture.mjs");
  const moduleUrl = name => pathToFileURL(path.resolve("src", name)).href;
  await writeFile(driver, `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
    const open=fs.open;fs.open=async function(file,...args){const handle=await open(file,...args);if(${JSON.stringify(stage)}==='published'&&file.endsWith('.result.json')){const close=handle.close.bind(handle);handle.close=async()=>{await close();process.send({stage:'paused'});await new Promise(()=>{});};}return handle;};
    const rename=fs.rename;fs.rename=async function(from,to){
      const match=(${JSON.stringify(stage)}==='intent'||${JSON.stringify(stage)}==='replaced')?to===${JSON.stringify(path.join(f.root,"data/items.json"))}:${JSON.stringify(stage)}==='published'&&to.endsWith('.result.json');
      if(match&&${JSON.stringify(stage)}==='intent'){process.send({stage:'paused'});await new Promise(()=>{});}
      await rename(from,to);if(match){process.send({stage:'paused'});await new Promise(()=>{});}};syncBuiltinESMExports();
    const {startProjectCommandEntryAction}=await import(${JSON.stringify(moduleUrl("project-command-action-service.mjs"))});
    const {createProjectContext}=await import(${JSON.stringify(moduleUrl("project-context.mjs"))});
    const started=await startProjectCommandEntryAction({projectContext:createProjectContext(${JSON.stringify(f.root)}),project:{id:'fixture'},request:${JSON.stringify(f.request)}});
    process.send({runId:started.runId});await started.completion;`);
  const child = spawn(process.execPath, [driver], { stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  let runId, stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once("exit", resolve));
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Crash stage timeout ${stage}: ${stderr}`)), 15000);
    child.on("message", message => {
      if (message.runId) runId = message.runId;
      if ((stage === "running" && runId) || message.stage === "paused") { clearTimeout(timer); resolve(); }
    });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(`Service exited before crash ${stderr}`)); });
  });
  child.kill(); await exited;
  if (stage === "running") await new Promise(resolve => setTimeout(resolve, 700));
  return { ...f, runId };
}
for (const stage of ["running", "intent", "replaced", "published"]) {
  test(`real writer crash at ${stage} recovers the original run without re-execution`, async t => {
    const f = await crashedFixture(t, stage);
    const before = await readFile(path.join(f.root, "data/items.json"), "utf8");
    const recovered = await recoverProjectCommandRun(f.context, f.runId);
    assert.equal(recovered.recovered, true);
    const result = await readEntryActionResult(f.context, f.runId);
    assert.equal(result.outcome, ["running", "intent"].includes(stage) ? "failed" : "completed_with_writeback");
    assert.equal(await readFile(path.join(f.root, "data/items.json"), "utf8"), before);
    await recoverProjectCommandRun(f.context, f.runId);
    assert.deepEqual(await readEntryActionResult(f.context, f.runId), result);
    assert.equal((await findActiveEntryActionRuns(f.context, f.request.sourcePath)).runs.length, 0);
  });
}
test("post-replace crash with an external edit remains recoverable and never overwrites it", async t => {
  const f = await crashedFixture(t, "replaced");
  const file = path.join(f.root, "data/items.json");
  const changed = JSON.stringify([{ ...f.row, generated: "new", source: "newer edit" }]);
  await writeFile(file, changed);
  await assert.rejects(recoverProjectCommandRun(f.context, f.runId), { code: "PROJECT_COMMAND_RECOVERY_REQUIRED" });
  assert.equal(await readFile(file, "utf8"), changed);
  await assert.rejects(readEntryActionResult(f.context, f.runId), { code: "ENOENT" });
});
test("recovery cannot adopt a new dependency baseline after replacement", async t => {
  const f = await crashedFixture(t, "replaced");
  await writeFile(path.join(f.root, "dependency.json"), '{"new":true}');
  await assert.rejects(recoverProjectCommandRun(f.context, f.runId), { code: "PROJECT_COMMAND_RECOVERY_REQUIRED" });
  assert.equal(JSON.parse(await readFile(path.join(f.root, "data/items.json"), "utf8"))[0].generated, "new");
});
test("writer identity distinguishes live processes, PID reuse and missing proof", async () => {
  const identity = await readServiceProcessIdentity();
  assert.equal(await serviceProcessIsAlive(identity), true);
  assert.equal(await serviceProcessIsAlive({ ...identity, creationTime: identity.creationTime + "0" }), false);
  assert.equal(await serviceProcessIsAlive(null), null);
});

async function recoveryProcess(f, pauseBeforeCleanup = false) {
  const url = name => pathToFileURL(path.resolve("src", name)).href;
  const code = `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
    if(${JSON.stringify(pauseBeforeCleanup)}==='before_release'){const rmdir=fs.rmdir;fs.rmdir=async file=>{if(file.endsWith('admission.lock')){process.send('paused');await new Promise(()=>{});}return rmdir(file);};syncBuiltinESMExports();}
    if(${JSON.stringify(pauseBeforeCleanup)}){const unlink=fs.unlink;fs.unlink=async file=>{if(file.endsWith('claim.json')){if(${JSON.stringify(pauseBeforeCleanup)}==='after_metadata')await unlink(file);process.send('paused');await new Promise(()=>{});}return unlink(file);};syncBuiltinESMExports();}
    const {recoverProjectCommandRun}=await import(${JSON.stringify(url("project-command-recovery.mjs"))});
    const {createProjectContext}=await import(${JSON.stringify(url("project-context.mjs"))});
    console.log(JSON.stringify(await recoverProjectCommandRun(createProjectContext(${JSON.stringify(f.root)}),${JSON.stringify(f.runId)})));`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once("exit", code => resolve({ code, stdout, stderr })));
  return { child, exited };
}
test("two independent recovery processes serialize the same original run", async t => {
  const f = await crashedFixture(t, "replaced");
  const processes = await Promise.all([recoveryProcess(f), recoveryProcess(f)]);
  t.after(() => { for (const p of processes) if (p.child.exitCode === null) p.child.kill(); });
  const results = await Promise.all(processes.map(p => p.exited));
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  assert.equal((await readEntryActionResult(f.context, f.runId)).outcome, "completed_with_writeback");
});
for (const cleanupStage of ["before_release", true, "after_metadata"]) test(`recovery crash at cleanup ${cleanupStage} leaves admission usable`, async t => {
  const f = await crashedFixture(t, "replaced");
  const recovering = await recoveryProcess(f, cleanupStage);
  t.after(() => { if (recovering.child.exitCode === null) recovering.child.kill(); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Recovery pause timeout")), 15000);
    recovering.child.once("message", () => { clearTimeout(timer); resolve(); });
    recovering.child.once("exit", () => { clearTimeout(timer); reject(new Error("Recovery exited early")); });
  });
  recovering.child.kill(); await recovering.exited;
  await recoverProjectCommandRun(f.context, f.runId);
  const row = JSON.parse(await readFile(path.join(f.root, "data/items.json"), "utf8"))[0];
  const script = path.join(f.root, "command.mjs");
  await writeFile(script, (await readFile(script, "utf8")).replace("after:'new'", "after:'next'"));
  const next = await startProjectCommandEntryAction({ ...f.input, request: { ...f.request, expectedRowDigest: rowDigest(row) } });
  await next.completion;
  assert.equal((await readEntryActionResult(f.context, next.runId)).outcome, "completed_with_writeback");
});

test("actual HTTP service restart recovers the original running action and allows explicit regeneration", { timeout: 30000 }, async t => {
  const f = await fixture(t, "await new Promise(resolve=>setTimeout(resolve,600))");
  const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const home = path.join(f.root, "registry");
  const base = `http://127.0.0.1:${port}`;
  const start = async () => {
    const child = spawn(process.execPath, [path.resolve("server.mjs"), "--project", f.root, "--registry-home", home, "--port", String(port), "--bridge-port", "1"], { windowsHide: true, stdio: "pipe", env: { ...process.env, DATA_EDITOR_HOME: home } });
    const exit = new Promise(resolve => child.once("exit", resolve));
    f.ownChild(child, exit);
    t.after(async () => { if (child.exitCode === null) child.kill(); await exit; });
    let error = ""; child.stderr.on("data", chunk => { error += chunk; });
    const deadline = Date.now() + 10000;
    while (true) {
      try { if ((await fetch(base + "/api/health")).ok) break; } catch {}
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`HTTP startup failed ${error}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return { child, exit };
  };
  const first = await start();
  const registry = await (await fetch(base + "/api/projects")).json();
  const projectId = registry.activeProjectId;
  const generate = async () => {
    const response = await fetch(base + "/api/entry-actions/run", { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ ...f.request, projectId }) });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  const accepted = await generate(); first.child.kill(); await first.exit;
  await new Promise(resolve => setTimeout(resolve, 700));
  await start();
  const scope = new URLSearchParams({ projectId, actionId: "compile", sourcePath: f.request.sourcePath, collectionPath: "$", rowId: "row-1" });
  const latest = await (await fetch(base + "/api/entry-actions/latest?" + scope)).json();
  assert.equal(latest.run.runId, accepted.runId); assert.equal(latest.run.outcome, "failed");
  const active = await (await fetch(base + "/api/entry-actions/active?" + scope)).json(); assert.deepEqual(active.runs, []);
  const next = await generate(); assert.notEqual(next.runId, accepted.runId);
  let result;
  for (let n = 0; n < 100; n++) {
    result = await (await fetch(base + "/api/entry-actions/result?" + new URLSearchParams({ projectId, runId: next.runId }))).json();
    if (result.phase === "terminal") break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(result.outcome, "completed_with_writeback");
  assert.equal(JSON.parse(await readFile(path.join(f.root, "data/items.json"), "utf8"))[0].generated, "new");
});
test("same-file save is admitted during opt-in generation but invalidates its original baseline", async t => {
  const f = await fixture(t, "await new Promise(resolve=>setTimeout(resolve,200))");
  const started = await startProjectCommandEntryAction(f.input);
  const done = assert.rejects(started.completion, { code: "PROJECT_COMMAND_DOCUMENT_STALE" });
  const active = await findActiveEntryActionRuns(f.context, f.request.sourcePath);
  assert.equal(active.runs.length, 1); assert.deepEqual(await ordinarySaveBlockingRuns(f.context, active.runs), []);
  await writeFile(path.join(f.root, "data/items.json"), JSON.stringify([{ ...f.row, source: "edited" }]));
  await done;
  assert.equal((await readEntryActionResult(f.context, started.runId)).outcome, "conflicted");
});
test("declared dependency edit rejects the old result", async t => {
  const f = await fixture(t, "await new Promise(resolve=>setTimeout(resolve,200))");
  const started = await startProjectCommandEntryAction(f.input);
  const done = assert.rejects(started.completion, { code: "PROJECT_COMMAND_DEPENDENCY_STALE" });
  await writeFile(path.join(f.root, "dependency.json"), '{"changed":true}'); await done;
});
test("ordinary save protects migrated fields, including source-marker removal", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, ".data-editor/field-write-policy.json"), JSON.stringify({ version: 1, policies: [{ file: "data/items.json", collection: "$", requiresFields: ["description_sources"], fields: ["generated"] }] }));
  await assert.rejects(assertOrdinarySaveFieldPolicy({ context: f.context, sourcePath: f.request.sourcePath, beforeRoot: [f.row], afterRoot: [{ __entry_id: "row-1", generated: "tampered" }] }), { code: "FIELD_WRITE_POLICY_FORBIDDEN" });
  const legacy = { __entry_id: "row-2", generated: "legacy" };
  await assertOrdinarySaveFieldPolicy({ context: f.context, sourcePath: f.request.sourcePath, beforeRoot: [legacy], afterRoot: [{ ...legacy, generated: "editable" }] });
});
test("fresh external proposal cannot impersonate a project-command execution", async t => {
  const f = await fixture(t);
  await assert.rejects(submitFreshEntryActionProposal({ ...f.input, result: {} }), { code: "PROJECT_COMMAND_ADMISSION_REQUIRED" });
});
test("project command rejects escaping paths and terminates on timeout", async t => {
  const f = await fixture(t);
  await assert.rejects(executeProjectCommand(f.context, { ...f.command, path: "../outside.mjs" }, {}));
  await writeFile(path.join(f.root, "hang.mjs"), "setInterval(()=>{},1000)");
  await assert.rejects(executeProjectCommand(f.context, { ...f.command, path: "hang.mjs", timeoutMs: 50 }, {}), { code: "PROJECT_COMMAND_TIMEOUT" });
});
test("no-change execution publishes a terminal lifecycle without entering commit", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, "command.mjs"), "process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({kind:'project-command-result',status:'no_changes',summary:'already current',evidence:[]})))");
  const started = await startProjectCommandEntryAction(f.input); await started.completion;
  assert.equal((await readEntryActionResult(f.context, started.runId)).outcome, "completed_without_changes");
  assert.equal((await findActiveEntryActionRuns(f.context, f.request.sourcePath)).runs.length, 0);
});
test("the action holds every input identity through replacement, blocking a same-service dependency save", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, "data/stats.json"), '{"value":1}');
  const profileFile = path.join(f.root, ".data-editor/automation-profile.json");
  const profile = JSON.parse(await readFile(profileFile, "utf8"));
  profile.rules[0].execution.command.readDependencies.push("data/stats.json");
  await writeFile(profileFile, JSON.stringify(profile));
  const coordinator = createDocumentCommitCoordinator();
  let unlock, signalEntered;
  const entered = new Promise(resolve => { signalEntered = resolve; });
  const continueCommit = new Promise(resolve => { unlock = resolve; });
  const dependencyKey = (await canonicalFileIdentity(f.context, "data/stats.json")).canonicalFileKey;
  const instrumented = {
    withCommit: (...args) => coordinator.withCommit(...args),
    withIdentities: (identities, operation) => coordinator.withIdentities(identities, async locked => {
      assert.ok(locked.some(identity => identity.canonicalFileKey === dependencyKey));
      signalEntered(); await continueCommit; return operation(locked);
    }),
  };
  const started = await startProjectCommandEntryAction({ ...f.input, documentCommitCoordinator: instrumented });
  const actionCompletion = started.completion;
  await entered;
  let dependencySaveEntered = false;
  const dependencySave = coordinator.withCommit({ projectContext: f.context, sourcePath: "data/stats.json" }, async () => {
    dependencySaveEntered = true;
    assert.equal(JSON.parse(await readFile(path.join(f.root, "data/items.json"), "utf8"))[0].generated, "new");
    assert.equal((await readEntryActionResult(f.context, started.runId)).outcome, "completed_with_writeback");
    await writeFile(path.join(f.root, "data/stats.json"), '{"value":2}');
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(dependencySaveEntered, false);
  unlock(); await actionCompletion; await dependencySave;
  assert.equal(dependencySaveEntered, true);
});
test("a dependency save that wins the shared coordinator invalidates the running action", async t => {
  const f = await fixture(t, "await new Promise(resolve=>setTimeout(resolve,200))");
  await writeFile(path.join(f.root, "data/stats.json"), '{"value":1}');
  const profileFile = path.join(f.root, ".data-editor/automation-profile.json");
  const profile = JSON.parse(await readFile(profileFile, "utf8"));
  profile.rules[0].execution.command.readDependencies.push("data/stats.json");
  await writeFile(profileFile, JSON.stringify(profile));
  const coordinator = createDocumentCommitCoordinator();
  const started = await startProjectCommandEntryAction({ ...f.input, documentCommitCoordinator: coordinator });
  const completion = assert.rejects(started.completion, { code: "PROJECT_COMMAND_DEPENDENCY_STALE" });
  await coordinator.withCommit({ projectContext: f.context, sourcePath: "data/stats.json" }, () => writeFile(path.join(f.root, "data/stats.json"), '{"value":2}'));
  await completion;
  assert.equal(JSON.parse(await readFile(path.join(f.root, "data/items.json"), "utf8"))[0].generated, "old");
});

test("project-command writeback survives a disconnected observer and rereads the same durable result", async t => {
  const f=await fixture(t);
  const started=await startProjectCommandEntryAction(f.input);
  // Observer is absent until after commit; completion is server owned.
  await started.completion;
  const reopened=createProjectContext(f.root);
  const result=await readEntryActionResult(reopened,started.runId);
  assert.equal(result.outcome,'completed_with_writeback');
  assert.deepEqual(await readEntryActionResult(reopened,started.runId),result);
  assert.equal(JSON.parse(await readFile(path.join(f.root,'data/items.json'),'utf8'))[0].generated,'new');
  assert.equal((await findActiveEntryActionRuns(reopened,f.request.sourcePath)).runs.length,0);
});


async function enableValidator(f, body = "const status='pass'") {
  const profileFile = path.join(f.root, ".data-editor/automation-profile.json");
  const profile = JSON.parse(await readFile(profileFile, "utf8"));
  profile.rules[0].execution.proposalValidator = { version: 1, command: { path: "validator.mjs", args: [], readDependencies: ["validator-input.json"], timeoutMs: 3000 } };
  await writeFile(path.join(f.root, "validator-input.json"), "{}");
  await writeFile(path.join(f.root, "validator.mjs"), `let text='';for await(const part of process.stdin)text+=part;const input=JSON.parse(text);${body};console.log(JSON.stringify({version:1,kind:'project-command-validation-result',status,diagnostics:[],inputDigest:input.inputDigest,changesDigest:input.changesDigest}));`);
  await writeFile(profileFile, JSON.stringify(profile));
}

test("required validator receives accepted row, language, exact after image and server-bound context", async t => {
  const f = await fixture(t);
  await enableValidator(f, `const status=input.request.locales.join(',')==='zh'&&input.request.rowId==='row-1'&&input.request.runId&&input.beforeRow.generated==='old'&&input.afterRow.generated==='new'&&input.beforeRow.source===input.afterRow.source&&input.action.contractDigest&&['fresh','commit','admit'].includes(input.mode)?'pass':'reject'`);
  const source = await readFile(path.join(f.root, "validator.mjs"), "utf8");
  const started = await startProjectCommandEntryAction(f.input); await started.completion;
  assert.equal((await readEntryActionResult(f.context, started.runId)).outcome, "completed_with_writeback");
  assert.equal(await readFile(path.join(f.root, "validator.mjs"), "utf8"), source);
});

for (const mode of ["fresh", "commit", "admit"]) test(`validator rejection at ${mode} prevents all formal writes`, async t => {
  const f = await fixture(t);
  await enableValidator(f, `const status=input.mode===${JSON.stringify(mode)}?'reject':'pass'`);
  const original = await readFile(path.join(f.root, "data/items.json"), "utf8");
  const started = await startProjectCommandEntryAction(f.input);
  await assert.rejects(started.completion, { code: "PROJECT_COMMAND_VALIDATOR_REJECTED" });
  assert.equal(await readFile(path.join(f.root, "data/items.json"), "utf8"), original);
  assert.equal((await readEntryActionResult(f.context, started.runId)).outcome, "failed");
  assert.equal((await findActiveEntryActionRuns(f.context, f.request.sourcePath)).runs.length, 0);
});

for (const satisfied of [false, true]) test(`no_changes is successful only when the validator proves the accepted request: ${satisfied}`, async t => {
  const f = await fixture(t, `console.log(JSON.stringify({kind:'project-command-result',status:'no_changes'}));process.exit(0)`);
  await enableValidator(f, `const status=input.mode==='no_changes'&&JSON.stringify(input.beforeRow)===JSON.stringify(input.afterRow)&&input.changes.length===0&&${satisfied}?'pass':'reject'`);
  const started = await startProjectCommandEntryAction(f.input);
  if (satisfied) await started.completion;
  else await assert.rejects(started.completion, { code: "PROJECT_COMMAND_VALIDATOR_REJECTED" });
  assert.equal((await readEntryActionResult(f.context, started.runId)).outcome, satisfied ? "completed_without_changes" : "failed");
  assert.equal(JSON.parse(await readFile(path.join(f.root, "data/items.json"), "utf8"))[0].generated, "old");
});

for (const extra of ["result.afterRow={}", "result.inputDigest='wrong'"]) test(`validator cannot supply an unbound result or replacement patch: ${extra}`, async t => {
  const f = await fixture(t); await enableValidator(f);
  await writeFile(path.join(f.root, "validator.mjs"), `let t='';for await(const p of process.stdin)t+=p;const input=JSON.parse(t);const result={version:1,kind:'project-command-validation-result',status:'pass',diagnostics:[],inputDigest:input.inputDigest,changesDigest:input.changesDigest};${extra};console.log(JSON.stringify(result));`);
  const started = await startProjectCommandEntryAction(f.input);
  await assert.rejects(started.completion, { code: "PROJECT_COMMAND_VALIDATOR_RESULT_INVALID" });
  assert.equal(JSON.parse(await readFile(path.join(f.root, "data/items.json"), "utf8"))[0].generated, "old");
});

for (const dependency of ["validator.mjs", "validator-input.json"]) test(`validator dependency ${dependency} participates in the accepted snapshot`, async t => {
  const f = await fixture(t, "await new Promise(resolve=>setTimeout(resolve,200))"); await enableValidator(f);
  const started = await startProjectCommandEntryAction(f.input);
  const completion = assert.rejects(started.completion, { code: "PROJECT_COMMAND_DEPENDENCY_STALE" });
  await writeFile(path.join(f.root, dependency), "changed"); await completion;
  assert.equal(JSON.parse(await readFile(path.join(f.root, "data/items.json"), "utf8"))[0].generated, "old");
});

for (const rejectRecovery of [false, true]) test(`post-replace recovery validates the original request without re-execution: ${rejectRecovery}`, async t => {
  const f = await crashedFixture(t, "replaced", f => enableValidator(f, `const status=input.request.locales.join(',')==='zh'&&input.request.rowId==='row-1'&&!(input.mode==='recovery'&&${rejectRecovery})?'pass':'reject'`));
  const source = await readFile(path.join(f.root, "data/items.json"), "utf8");
  if (rejectRecovery) {
    await assert.rejects(recoverProjectCommandRun(f.context, f.runId), error => error.code === "PROJECT_COMMAND_RECOVERY_REQUIRED" && error.message.includes("PROJECT_COMMAND_VALIDATOR_REJECTED"));
    await assert.rejects(readEntryActionResult(f.context, f.runId), { code: "ENOENT" });
  } else {
    await recoverProjectCommandRun(f.context, f.runId);
    assert.equal((await readEntryActionResult(f.context, f.runId)).outcome, "completed_with_writeback");
  }
  assert.equal(await readFile(path.join(f.root, "data/items.json"), "utf8"), source);
});


test("validator request language is captured at acceptance, not read from later caller state", async t => {
  const f = await fixture(t, "await new Promise(resolve=>setTimeout(resolve,100))");
  await enableValidator(f, "const status=input.request.locales.join(',')==='zh'?'pass':'reject'");
  const started = await startProjectCommandEntryAction(f.input);
  f.request.locales.push("en");
  await started.completion;
  assert.equal((await readEntryActionResult(f.context, started.runId)).outcome, "completed_with_writeback");
});

test("validator failure and timeout are rejected without formal writes", async t => {
  for (const body of ["process.exit(1)", "setInterval(()=>{},1000)"]) {
    const f = await fixture(t); await enableValidator(f);
    await writeFile(path.join(f.root,"validator.mjs"),body);
    const file = path.join(f.root,".data-editor/automation-profile.json");
    const profile = JSON.parse(await readFile(file,"utf8")); profile.rules[0].execution.proposalValidator.command.timeoutMs=70;
    await writeFile(file,JSON.stringify(profile));
    const started = await startProjectCommandEntryAction(f.input);
    await assert.rejects(started.completion, {code:body.startsWith('process')?'PROJECT_COMMAND_FAILED':'PROJECT_COMMAND_TIMEOUT'});
    assert.equal(JSON.parse(await readFile(path.join(f.root,"data/items.json"),"utf8"))[0].generated,"old");
  }
});

test("required-validator recovery rejects missing accepted request binding and keeps the written source", async t => {
  const f = await crashedFixture(t,"replaced",enableValidator);
  // Locate via the public path contract rather than guessing its runtime layout.
  const {entryActionHandoffPath}=await import('../src/entry-actions.mjs');
  const handoffFile=entryActionHandoffPath(f.context,f.runId);
  const handoff=JSON.parse(await readFile(handoffFile,"utf8")); delete handoff.projectCommand.requestBinding;
  await writeFile(handoffFile,JSON.stringify(handoff));
  const source=await readFile(path.join(f.root,"data/items.json"),"utf8");
  await assert.rejects(recoverProjectCommandRun(f.context,f.runId),e=>e.code==='PROJECT_COMMAND_RECOVERY_REQUIRED'&&e.message.includes('REQUEST_BINDING_INVALID'));
  assert.equal(await readFile(path.join(f.root,"data/items.json"),"utf8"),source);
  await assert.rejects(readEntryActionResult(f.context,f.runId),{code:'ENOENT'});
});

async function selectedPolicy(f, values=["approved"]) {
  await writeFile(path.join(f.root,".data-editor/field-write-policy.json"),JSON.stringify({version:1,policies:[{file:f.request.sourcePath,collection:'$',requiresFields:['description_sources'],fields:['generated'],rowSelector:{primaryKeyField:'id',values}}]}));
}

test("exact row selector protects only admitted rows and leaves their draft editable", async t => {
  const f=await fixture(t); await selectedPolicy(f);
  const admitted={...f.row,id:'approved'},other={...f.row,__entry_id:'row-2',id:'other'};
  await assertOrdinarySaveFieldPolicy({context:f.context,sourcePath:f.request.sourcePath,beforeRoot:[admitted,other],afterRoot:[{...admitted,source:'new request'},{...other,generated:'ordinary editable'}]});
  await assert.rejects(assertOrdinarySaveFieldPolicy({context:f.context,sourcePath:f.request.sourcePath,beforeRoot:[admitted,other],afterRoot:[{...admitted,generated:'tamper'},other]}),{code:'FIELD_WRITE_POLICY_FORBIDDEN'});
});

for (const mutation of ['id','durable','both','marker','field','delete','duplicate','enter']) test(`exact protection cannot be unlocked through ${mutation}`,async t=>{
  const f=await fixture(t);await selectedPolicy(f);
  const row={...f.row,id:'approved'};
  let before=[row],after=[{...row}];
  if(mutation==='id'||mutation==='both')after[0].id='other';
  if(mutation==='durable'||mutation==='both')after[0].__entry_id='replacement';
  if(mutation==='marker')delete after[0].description_sources;
  if(mutation==='field')delete after[0].generated;
  if(mutation==='delete')after=[];
  if(mutation==='duplicate')after.push({...row,id:'other'});
  if(mutation==='enter')before=[{...row,id:'other'}];
  await assert.rejects(assertOrdinarySaveFieldPolicy({context:f.context,sourcePath:f.request.sourcePath,beforeRoot:before,afterRoot:after}),e=>['FIELD_WRITE_POLICY_FORBIDDEN','FIELD_WRITE_POLICY_INVALID'].includes(e.code));
});

test("selector rejects missing/duplicate identities and malformed selection declarations",async t=>{
  const f=await fixture(t);await selectedPolicy(f);
  for(const rows of [[{id:'approved',generated:'old',description_sources:{}}],[{...f.row,id:'approved'},{...f.row,id:'approved',__entry_id:'row-2'}]])await assert.rejects(assertOrdinarySaveFieldPolicy({context:f.context,sourcePath:f.request.sourcePath,beforeRoot:rows,afterRoot:rows}),{code:'FIELD_WRITE_POLICY_INVALID'});
  await selectedPolicy(f,['approved','approved']);
  await assert.rejects(assertOrdinarySaveFieldPolicy({context:f.context,sourcePath:f.request.sourcePath,beforeRoot:[],afterRoot:[]}),{code:'FIELD_WRITE_POLICY_INVALID'});
});


test("required validator rejects the native proposal launch route",async t=>{
  const f=await fixture(t);await enableValidator(f);
  const {startProposalOnlyEntryAction}=await import('../src/entry-action-service.mjs');
  await assert.rejects(startProposalOnlyEntryAction(f.input),{code:'PROJECT_COMMAND_VALIDATOR_ROUTE_UNSUPPORTED'});
});
