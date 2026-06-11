export type AutosaveDomain = "document" | "project-config" | "profile";
export type AutosaveState = "idle" | "pending" | "saving" | "error" | "blocked-confirmation";
export type AutosaveReason = "dirty" | "flush" | "retry";

export type AutosaveSnapshot = {
  dirtyDomains: AutosaveDomain[];
};

export type AutosaveFlushResult =
  | { outcome: "saved" | "idle" }
  | { outcome: "blocked-confirmation" }
  | { outcome: "deferred" }
  | { outcome: "error" };

type SaveCoordinatorOptions = {
  delayMs?: number;
  getSnapshot: () => AutosaveSnapshot;
  flush: (reason: AutosaveReason, snapshot: AutosaveSnapshot) => Promise<AutosaveFlushResult>;
  onStatusChange?: (state: AutosaveState, details: { errorMessage: string | null; dirtyDomains: AutosaveDomain[] }) => void;
};

export type SaveCoordinator = {
  cancel: () => void;
  flush: (reason?: AutosaveReason) => Promise<AutosaveFlushResult>;
  getState: () => AutosaveState;
  markDirty: (domain: AutosaveDomain) => void;
};

export function createSaveCoordinator(options: SaveCoordinatorOptions): SaveCoordinator {
  const delayMs = options.delayMs ?? 800;
  let state: AutosaveState = "idle";
  let timer: number | null = null;
  let inFlight: Promise<AutosaveFlushResult> | null = null;
  let retryRequested = false;
  let errorMessage: string | null = null;

  function emit(nextState: AutosaveState, snapshot: AutosaveSnapshot) {
    state = nextState;
    options.onStatusChange?.(nextState, {
      errorMessage,
      dirtyDomains: [...snapshot.dirtyDomains],
    });
  }

  function clearTimer() {
    if (timer != null) window.clearTimeout(timer);
    timer = null;
  }

  function schedule(reason: AutosaveReason) {
    const snapshot = options.getSnapshot();
    if (!snapshot.dirtyDomains.length) {
      clearTimer();
      errorMessage = null;
      emit("idle", snapshot);
      return;
    }
    clearTimer();
    emit("pending", snapshot);
    timer = window.setTimeout(() => {
      timer = null;
      void runFlush(reason);
    }, delayMs);
  }

  async function runFlush(reason: AutosaveReason) {
    if (inFlight) {
      retryRequested = true;
      return inFlight;
    }
    const snapshot = options.getSnapshot();
    if (!snapshot.dirtyDomains.length) {
      errorMessage = null;
      emit("idle", snapshot);
      return { outcome: "idle" } as const;
    }
    errorMessage = null;
    emit("saving", snapshot);
    inFlight = (async () => {
      try {
        const result = await options.flush(reason, snapshot);
        const nextSnapshot = options.getSnapshot();
        if (result.outcome === "blocked-confirmation") {
          emit("blocked-confirmation", nextSnapshot);
          return result;
        }
        if (result.outcome === "deferred") {
          schedule("retry");
          return result;
        }
        if (nextSnapshot.dirtyDomains.length) {
          schedule("retry");
          return result;
        }
        emit("idle", nextSnapshot);
        return result;
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
        emit("error", options.getSnapshot());
        return { outcome: "error" } as const;
      } finally {
        inFlight = null;
        if (retryRequested) {
          retryRequested = false;
          schedule("retry");
        }
      }
    })();
    return inFlight;
  }

  async function runStrongFlush(reason: AutosaveReason): Promise<AutosaveFlushResult> {
    let currentReason = reason;
    while (true) {
      const result = await runFlush(currentReason);
      if (result.outcome === "blocked-confirmation" || result.outcome === "deferred" || result.outcome === "error") {
        return result;
      }
      const snapshot = options.getSnapshot();
      if (!snapshot.dirtyDomains.length) {
        errorMessage = null;
        emit("idle", snapshot);
        return { outcome: result.outcome === "idle" ? "idle" : "saved" };
      }
      currentReason = "flush";
    }
  }

  return {
    cancel() {
      clearTimer();
    },
    async flush(reason = "flush") {
      clearTimer();
      return runStrongFlush(reason);
    },
    getState() {
      return state;
    },
    markDirty() {
      schedule("dirty");
    },
  };
}
