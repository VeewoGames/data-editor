import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertPerfWorkspace, cleanupPerfWorkspace, createPerfWorkspace, perfFilePath, perfRowCount, startOpenService, withBrowserPage } from "./perf/perf-helpers.mjs";
import { normalizeSharedViewsConfig } from "../src/shared-views.mjs";

test("performance fixtures allocate separate writable projects and ignore external root overrides", async () => {
  const previous = process.env.DATA_EDITOR_PERF_PROJECT_ROOT;
  process.env.DATA_EDITOR_PERF_PROJECT_ROOT = path.resolve("outside-owned-fixture");
  const first = await createPerfWorkspace();
  const second = await createPerfWorkspace();
  try {
    assert.notEqual(first.projectRoot, second.projectRoot);
    const scratch = fileURLToPath(new URL(".scratch/", import.meta.url));
    assert.ok(path.relative(scratch, first.projectRoot).startsWith("perf-generic-"));
    assertPerfWorkspace(first);
    assert.throws(() => assertPerfWorkspace({ ...first, registryHome: second.registryHome }), /owned workspace/);
    const rows = JSON.parse(await readFile(path.join(first.projectRoot, perfFilePath), "utf8"));
    assert.equal(rows.length, perfRowCount);
    assert.equal(rows.filter((row) => row.group === "planning").length, 50);
    assert.equal(new Set(rows.map((row) => row.id)).size, perfRowCount);
    assert.ok(rows.every((row) => row.description.length > 400));
    const shared = normalizeSharedViewsConfig(JSON.parse(await readFile(path.join(first.projectRoot, ".data-editor", "shared-views.json"), "utf8")));
    assert.equal(shared.collections[`${perfFilePath}:$`].defaultViewId, "all");
    assert.ok(shared.collections[`${perfFilePath}:$`].items.some((item) => item.view?.name === "规划"));
  } finally {
    if (previous === undefined) delete process.env.DATA_EDITOR_PERF_PROJECT_ROOT;
    else process.env.DATA_EDITOR_PERF_PROJECT_ROOT = previous;
    await cleanupPerfWorkspace(first.projectRoot);
    await cleanupPerfWorkspace(second.projectRoot);
  }
  await assert.rejects(access(first.projectRoot), { code: "ENOENT" });
  await assert.rejects(access(second.projectRoot), { code: "ENOENT" });
});

test("performance helpers reject unowned project, registry, browser and cleanup targets before side effects", async () => {
  const options = { projectRoot: path.resolve("unowned-project"), registryHome: path.resolve("unowned-registry"), port: 8787, bridgePort: 8791, mode: "dev" };
  await assert.rejects(startOpenService(options), /owned workspace/);
  await assert.rejects(withBrowserPage("http://127.0.0.1:8787", () => {}), /not an owned performance service/);
  await assert.rejects(cleanupPerfWorkspace(options.projectRoot), /unowned/);
});
