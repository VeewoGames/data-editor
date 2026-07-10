import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolveCodexBindingStatus } from "../src/codex-runtime.mjs";
import { parseCsv } from "../src/csv-codec.mjs";
import { parseJson } from "../src/json-codec.mjs";
import { buildDocumentModel } from "../src/document-model.mjs";
import { resolveEntryActionRow } from "../src/entry-actions.mjs";
import { readTextFile } from "../src/file-service.mjs";
const args = parseArgs(process.argv.slice(2));

if (!args.handoff) {
  throw new Error("Missing --handoff");
}

const handoffPath = path.resolve(args.handoff);
const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
const startedPath = handoffPath.replace(/\.json$/i, ".started.json");
const resultPath = handoffPath.replace(/\.json$/i, ".result.json");
const outputPath = handoffPath.replace(/\.json$/i, ".reply.md");

await writeFile(startedPath, `${JSON.stringify({
  version: 1,
  runId: handoff.runId,
  actionId: handoff.action?.id ?? null,
  projectId: handoff.project?.id ?? null,
  handoffPath,
  startedAt: new Date().toISOString(),
  status: "started",
}, null, 2)}\n`, "utf8");

const bindingStatus = await resolveCodexBindingStatus(handoff.action?.binding ?? null, {
  projectRoot: handoff.project?.root ?? null,
});
const runtime = normalizeHandoffRuntime(handoff.action?.runtime);
const beforeWritebackState = await captureWritebackState(handoff);
if (bindingStatus.status !== "ready") {
  await writeResult({
    version: 1,
    runId: handoff.runId,
    status: "rejected",
    finishedAt: new Date().toISOString(),
    outputPath: null,
    reason: bindingStatus.reason ?? "binding_invalid",
    message: bindingStatus.message ?? "当前设备绑定不可用。",
  });
  process.exit(0);
}

try {
  const prompt = buildPrompt(handoff, bindingStatus.skillPath);
  await runCodexExec(bindingStatus.codexCliPath, [
    "exec",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "-m",
    runtime.model,
    "-c",
    `model_reasoning_effort=${JSON.stringify(runtime.reasoning)}`,
    "-c",
    `model_verbosity=${JSON.stringify(runtime.verbosity)}`,
    "-C",
    handoff.project.root,
    "-o",
    outputPath,
    "-",
  ], {
    cwd: handoff.project.root,
    prompt,
    timeoutMs: runtime.timeoutMs,
  });
  const afterWritebackState = await captureWritebackState(handoff);
  const writebackCheck = compareWritebackState(beforeWritebackState, afterWritebackState);
  await writeResult({
    version: 1,
    runId: handoff.runId,
    status: writebackCheck.targetRowChanged ? "completed_with_writeback" : "completed_without_observed_writeback",
    finishedAt: new Date().toISOString(),
    outputPath,
    reason: null,
    message: buildCompletionMessage(handoff, outputPath, writebackCheck),
    writebackCheck,
  });
} catch (error) {
  if (isCodexExecTimeoutError(error)) {
    const afterWritebackState = await captureWritebackState(handoff);
    const writebackCheck = compareWritebackState(beforeWritebackState, afterWritebackState);
    if (writebackCheck.targetRowChanged) {
      await writeResult({
        version: 1,
        runId: handoff.runId,
        status: "completed_with_writeback",
        finishedAt: new Date().toISOString(),
        outputPath,
        reason: "codex_exec_timeout",
        message: buildTimeoutWritebackMessage(handoff, outputPath, writebackCheck),
        writebackCheck,
      });
      process.exit(0);
    }
    if (writebackCheck.fileChanged) {
      await writeResult({
        version: 1,
        runId: handoff.runId,
        status: "completed_without_observed_writeback",
        finishedAt: new Date().toISOString(),
        outputPath,
        reason: "codex_exec_timeout",
        message: buildTimeoutFileChangedMessage(handoff, outputPath),
        writebackCheck,
      });
      process.exit(0);
    }
  }
  const reason = isCodexExecTimeoutError(error) ? "codex_exec_timeout" : "codex_exec_failed";
  await writeResult({
    version: 1,
    runId: handoff.runId,
    status: "failed",
    finishedAt: new Date().toISOString(),
    outputPath,
    reason,
    message: buildExecutionErrorMessage(error),
  });
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--handoff") result.handoff = argv[index + 1];
  }
  return result;
}

function buildPrompt(handoff, skillPath) {
  const skillLabel = path.basename(path.dirname(skillPath));
  return [
    `[$${skillLabel}](${skillPath})`,
    "你正在处理 data-editor 发起的条目级自动化任务。",
    "请基于下面的 handoff 完成处理；如果需要修改项目文件，请直接在项目工作区内进行。",
    "输出要求：",
    "1. 先给出你对该条目的处理结论。",
    "2. 如果你做了修改，说明改了哪些文件。",
    "3. 如果无法完成，明确阻塞原因。",
    "",
    "```json",
    JSON.stringify(handoff, null, 2),
    "```",
  ].join("\n");
}

function buildExecutionErrorMessage(error) {
  if (isCodexExecTimeoutError(error)) {
    return "Codex 执行超时：已达到当前规则配置的等待上限。";
  }
  if (error instanceof Error && error.message) {
    return `Codex 执行失败：${error.message}`;
  }
  return "Codex 执行失败。";
}

function normalizeHandoffRuntime(value) {
  const model = typeof value?.model === "string" && value.model.trim() ? value.model.trim() : "gpt-5.4";
  const reasoning = normalizeEnum(value?.reasoning, ["none", "low", "medium", "high", "xhigh"], "medium");
  const verbosity = normalizeEnum(value?.verbosity, ["low", "medium", "high"], "low");
  const timeoutMs = Number.isInteger(value?.timeoutMs) && value.timeoutMs > 0 ? value.timeoutMs : 120000;
  return { model, reasoning, verbosity, timeoutMs };
}

function isCodexExecTimeoutError(error) {
  return error instanceof Error && error.message === "__CODEX_EXEC_TIMEOUT__";
}

function normalizeEnum(value, allowed, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return allowed.includes(normalized) ? normalized : fallback;
}

async function writeResult(payload) {
  await writeFile(resultPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function captureWritebackState(handoff) {
  const projectRoot = handoff.project?.root;
  const sourcePath = handoff.entry?.sourcePath;
  const collectionPath = handoff.entry?.collectionPath;
  const sourceRowIndex = handoff.entry?.sourceRowIndex;
  const rowId = handoff.entry?.rowId ?? null;
  if (!projectRoot || !sourcePath || !collectionPath || !Number.isInteger(sourceRowIndex)) {
    return {
      available: false,
      reason: "missing_entry_context",
    };
  }

  const text = await readTextFile(projectRoot, sourcePath);
  const parsed = path.extname(sourcePath).toLowerCase() === ".csv"
    ? { data: parseCsv(text), format: "csv" }
    : parseJson(text);
  const model = buildDocumentModel(parsed.data, parsed.format, sourcePath);
  const { row } = resolveEntryActionRow(model, collectionPath, sourceRowIndex, rowId);
  return {
    available: true,
    fileHash: stableHash(text),
    rowHash: stableHash(JSON.stringify(row ?? null)),
    rowSnapshot: row == null ? null : structuredClone(row),
  };
}

function compareWritebackState(beforeState, afterState) {
  if (!beforeState.available || !afterState.available) {
    return {
      available: false,
      fileChanged: false,
      targetRowChanged: false,
      changedFields: [],
      reason: !beforeState.available ? beforeState.reason : afterState.reason,
    };
  }

  return {
    available: true,
    fileChanged: beforeState.fileHash !== afterState.fileHash,
    targetRowChanged: beforeState.rowHash !== afterState.rowHash,
    changedFields: diffRowFields(beforeState.rowSnapshot, afterState.rowSnapshot),
  };
}

function diffRowFields(beforeRow, afterRow) {
  const keys = [...new Set([
    ...Object.keys(beforeRow ?? {}),
    ...Object.keys(afterRow ?? {}),
  ])].sort();
  return keys.filter((key) => JSON.stringify(beforeRow?.[key] ?? null) !== JSON.stringify(afterRow?.[key] ?? null));
}

function buildCompletionMessage(handoff, outputPath, writebackCheck) {
  const label = handoff.action?.label ?? handoff.action?.id ?? "条目动作";
  if (writebackCheck.available && writebackCheck.targetRowChanged) {
    const changedFields = writebackCheck.changedFields.length
      ? `目标条目变更字段：${writebackCheck.changedFields.join(", ")}。`
      : "已观察到目标条目变化。";
    return `已完成 ${label}，并观察到目标条目真实写回。${changedFields} 输出已写入 ${outputPath}。`;
  }
  if (writebackCheck.available && writebackCheck.fileChanged) {
    return `已完成 ${label}，但只观察到目标文件变化，未观察到目标条目真实写回。输出已写入 ${outputPath}。`;
  }
  if (writebackCheck.available) {
    return `已完成 ${label}，但未观察到目标文件或目标条目的真实写回。输出已写入 ${outputPath}。`;
  }
  return `已完成 ${label}，但本轮无法核对目标条目的真实写回。输出已写入 ${outputPath}。`;
}

function buildTimeoutWritebackMessage(handoff, outputPath, writebackCheck) {
  const label = handoff.action?.label ?? handoff.action?.id ?? "条目动作";
  const changedFields = writebackCheck.changedFields.length
    ? `目标条目变更字段：${writebackCheck.changedFields.join(", ")}。`
    : "已观察到目标条目变化。";
  return `${label} 在等待上限内未正常结束，但已观察到目标条目真实写回。${changedFields} 输出已写入 ${outputPath}。`;
}

function buildTimeoutFileChangedMessage(handoff, outputPath) {
  const label = handoff.action?.label ?? handoff.action?.id ?? "条目动作";
  return `${label} 在等待上限内未正常结束，但已观察到目标文件变化，未观察到目标条目真实写回。输出已写入 ${outputPath}。`;
}

function stableHash(text) {
  return crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

function runCodexExec(command, args, options) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timeoutId = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
      ? globalThis.setTimeout(() => {
        timedOut = true;
        child.kill();
      }, options.timeoutMs)
      : null;

    const finalize = (callback) => {
      if (finished) return;
      finished = true;
      if (timeoutId != null) globalThis.clearTimeout(timeoutId);
      callback();
    };

    child.on("error", (error) => finalize(() => reject(error)));
    child.on("close", (code) => {
      if (timedOut) {
        finalize(() => reject(new Error("__CODEX_EXEC_TIMEOUT__")));
        return;
      }
      if (code === 0) {
        finalize(() => resolve());
        return;
      }
      finalize(() => reject(new Error(stderr.trim() || `Codex exited with code ${code ?? "unknown"}`)));
    });

    child.stdin.end(options.prompt);
  });
}
