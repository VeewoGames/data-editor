export function createProjectTransactionRecoveryMonitor({ scan, intervalMs = 50, maxAttempts = 200 } = {}) {
  if (typeof scan !== "function" || !Number.isSafeInteger(intervalMs) || intervalMs < 0 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError("Project transaction recovery monitor configuration is invalid.");
  }
  const monitors = new Map();

  function schedule(projectContext, runId, { reset = false } = {}) {
    if (typeof runId !== "string" || !runId) throw new TypeError("Project transaction recovery runId is required.");
    const key = `${projectContext.projectId ?? projectContext.projectRoot}:${runId}`;
    let monitor = monitors.get(key);
    if (!monitor || reset) {
      if (monitor?.timer) clearTimeout(monitor.timer);
      monitor = { attempts: 0, timer: null };
      monitors.set(key, monitor);
    }
    if (monitor.timer || monitor.attempts >= maxAttempts) return;
    monitor.timer = setTimeout(async () => {
      monitor.timer = null;
      monitor.attempts += 1;
      try {
        const result = await scan(projectContext);
        if (result.pending.includes(runId)) schedule(projectContext, runId);
        else monitors.delete(key);
      } catch {
        schedule(projectContext, runId);
      }
    }, intervalMs);
    monitor.timer.unref?.();
  }

  function stop() {
    for (const monitor of monitors.values()) if (monitor.timer) clearTimeout(monitor.timer);
    monitors.clear();
  }

  return Object.freeze({ schedule, stop, snapshot: () => new Map([...monitors].map(([key, value]) => [key, { attempts: value.attempts, scheduled: Boolean(value.timer) }])) });
}
