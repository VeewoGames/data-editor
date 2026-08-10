import assert from "node:assert/strict";
import test from "node:test";
import { createProjectTransactionRecoveryMonitor } from "../src/entry-action-project-transaction-monitor.mjs";

const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("monitor condition was not reached");
};

test("each pending run owns an independent retry generation and completed runs are removed", async (t) => {
  const pending = new Set(["run-a"]);
  const monitor = createProjectTransactionRecoveryMonitor({ intervalMs: 1, maxAttempts: 2, scan: async () => ({ pending: [...pending] }) });
  t.after(() => monitor.stop());
  const context = { projectId: "fixture" };
  monitor.schedule(context, "run-a");
  await waitFor(() => monitor.snapshot().get("fixture:run-a")?.attempts === 2);

  pending.add("run-b");
  monitor.schedule(context, "run-b");
  await waitFor(() => monitor.snapshot().get("fixture:run-b")?.attempts === 1);
  pending.delete("run-b");
  await waitFor(() => !monitor.snapshot().has("fixture:run-b"));
  assert.equal(monitor.snapshot().get("fixture:run-a")?.attempts, 2);
});

test("explicit reset gives only the selected pending run a fresh retry generation", async (t) => {
  const pending = new Set(["run-a", "run-b"]);
  const monitor = createProjectTransactionRecoveryMonitor({ intervalMs: 1, maxAttempts: 1, scan: async () => ({ pending: [...pending] }) });
  t.after(() => monitor.stop());
  const context = { projectId: "fixture" };
  monitor.schedule(context, "run-a"); monitor.schedule(context, "run-b");
  await waitFor(() => monitor.snapshot().get("fixture:run-a")?.attempts === 1 && monitor.snapshot().get("fixture:run-b")?.attempts === 1);
  monitor.schedule(context, "run-b", { reset: true });
  pending.delete("run-b");
  await waitFor(() => !monitor.snapshot().has("fixture:run-b"));
  assert.equal(monitor.snapshot().get("fixture:run-a")?.attempts, 1);
});
