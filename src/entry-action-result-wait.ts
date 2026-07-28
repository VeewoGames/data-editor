import type { EntryActionRunResult } from "./api/client";
import { isTerminalEntryActionState } from "./entry-action-state.mjs";

export class EntryActionResultWaitCancelledError extends Error {
  constructor() {
    super("Entry action result wait cancelled.");
    this.name = "EntryActionResultWaitCancelledError";
  }
}

export type WaitForEntryActionResultOptions = {
  backgroundIntervalMs?: number;
  backgroundPollLimit?: number;
  foregroundIntervalMs?: number;
  foregroundPollLimit?: number;
  loadResult: (runId: string, projectId: string) => Promise<EntryActionRunResult>;
  onEnterBackgroundWait?: () => void | Promise<void>;
  projectId: string;
  runId: string;
  shouldContinue?: () => boolean;
};

export type WaitForEntryActionResultOutcome =
  | { delayed: boolean; kind: "completed"; result: EntryActionRunResult }
  | { delayed: true; kind: "timed_out" };

export async function waitForEntryActionResult(options: WaitForEntryActionResultOptions): Promise<WaitForEntryActionResultOutcome> {
  const {
    backgroundIntervalMs = 2_000,
    backgroundPollLimit = 240,
    foregroundIntervalMs = 1_000,
    foregroundPollLimit = 60,
    loadResult,
    onEnterBackgroundWait,
    projectId,
    runId,
    shouldContinue = () => true,
  } = options;

  for (let attempt = 0; attempt < foregroundPollLimit; attempt += 1) {
    ensureShouldContinue(shouldContinue);
    const result = await loadResult(runId, projectId);
    if (isTerminalEntryActionState(result)) {
      return { kind: "completed", delayed: false, result };
    }
    if (attempt + 1 < foregroundPollLimit) {
      await delay(foregroundIntervalMs, shouldContinue);
    }
  }

  await onEnterBackgroundWait?.();

  for (let attempt = 0; attempt < backgroundPollLimit; attempt += 1) {
    ensureShouldContinue(shouldContinue);
    const result = await loadResult(runId, projectId);
    if (isTerminalEntryActionState(result)) {
      return { kind: "completed", delayed: true, result };
    }
    if (attempt + 1 < backgroundPollLimit) {
      await delay(backgroundIntervalMs, shouldContinue);
    }
  }

  return { kind: "timed_out", delayed: true };
}

function ensureShouldContinue(shouldContinue: () => boolean) {
  if (!shouldContinue()) {
    throw new EntryActionResultWaitCancelledError();
  }
}

async function delay(ms: number, shouldContinue: () => boolean) {
  await new Promise((resolve) => globalThis.setTimeout(resolve, ms));
  ensureShouldContinue(shouldContinue);
}
