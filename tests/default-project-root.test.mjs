import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { inferDefaultProjectRoot } from "../src/default-project-root.mjs";

async function makeTempDir(t, prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("embedded tools/data-editor layout keeps using the host project root", async (t) => {
  const hostRoot = await makeTempDir(t, "data-editor-host-");
  const toolRoot = path.join(hostRoot, "tools", "data-editor");

  assert.equal(
    inferDefaultProjectRoot({
      toolRoot,
      cwd: path.join(hostRoot, "elsewhere"),
      registryHome: path.join(hostRoot, ".data-editor"),
    }),
    hostRoot,
  );
});

test("standalone repo prefers the active registry project over the tool root parent", async (t) => {
  const registryHome = await makeTempDir(t, "data-editor-home-");
  const activeProjectRoot = await makeTempDir(t, "data-editor-project-");
  const toolRoot = path.join("C:\\Code", "data-editor");

  await writeFile(
    path.join(registryHome, "projects.json"),
    `${JSON.stringify({
      version: 1,
      activeProjectId: "nocturnel-e621a436",
      projects: [
        { id: "nocturnel-e621a436", name: "Nocturnel", root: activeProjectRoot, adapter: "nocturnel", dataSources: [], filePolicy: { includeExtensions: [".json"] } },
        { id: "project-59d75dd6", name: "Project", root: "C:\\", adapter: "nocturnel", dataSources: [], filePolicy: { includeExtensions: [".json"] } },
      ],
    }, null, 2)}\n`,
    "utf8",
  );

  assert.equal(
    inferDefaultProjectRoot({
      toolRoot,
      cwd: toolRoot,
      registryHome,
    }),
    activeProjectRoot,
  );
});

test("standalone repo falls back to cwd when no registry project exists", () => {
  const cwd = path.join("C:\\Code", "Nocturnel");

  assert.equal(
    inferDefaultProjectRoot({
      toolRoot: path.join("C:\\Code", "data-editor"),
      cwd,
      registryHome: path.join(cwd, ".missing-data-editor-home"),
    }),
    cwd,
  );
});
