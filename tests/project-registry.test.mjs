import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  addOrActivateProject,
  dataEditorHome,
  loadProjectRegistry,
  projectRegistryPath,
  saveProjectRegistry,
  reorderProjects,
  removeProject,
  updateProjectDefinition,
  activateProject,
} from "../src/project-registry.mjs";

async function makeHome(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "data-editor-home-"));
  t.after(async () => {
    await rm(home, { recursive: true, force: true });
  });
  return home;
}

async function projectsFixture(t) {
  const home = await makeHome(t);
  const roots = ["a", "b", "c"].map(name => path.join(home, name));
  await Promise.all(roots.map(root => mkdir(root)));
  const projects = [];
  for (const root of roots) projects.push((await addOrActivateProject({ root }, { home })).project);
  return { home, roots, projects, ids: projects.map(project => project.id) };
}

test("reorder persists exact objects and active project, rejects stale or invalid sets", async t => {
  const { home, projects, ids } = await projectsFixture(t);
  const original = await loadProjectRegistry({ home });
  const reordered = await reorderProjects([...ids].reverse(), { home });
  assert.deepEqual(reordered.projects, [...projects].reverse());
  assert.equal(reordered.activeProjectId, original.activeProjectId);
  assert.deepEqual(await loadProjectRegistry({ home }), reordered);
  for (const order of [[ids[0], ids[0], ids[1]], ids.slice(1), [...ids, "unknown"]]) {
    await assert.rejects(reorderProjects(order, { home }));
    assert.deepEqual(await loadProjectRegistry({ home }), reordered);
  }
});

test("remove preserves project files, picks remaining first, and rejects last project", async t => {
  const { home, roots, ids } = await projectsFixture(t);
  const file = path.join(roots[2], "keep.json");
  await writeFile(file, "{\"keep\":true}");
  const saved = await removeProject(ids[2], { home });
  assert.equal(saved.activeProjectId, ids[0]);
  assert.equal(await readFile(file, "utf8"), '{"keep":true}');
  await removeProject(ids[1], { home });
  await assert.rejects(removeProject(ids[0], { home }), { status: 409 });
  assert.deepEqual((await loadProjectRegistry({ home })).projects.map(p => p.id), [ids[0]]);
});

test("concurrent mutations preserve additions and edits and reject stale reorder", async t => {
  const { home, ids } = await projectsFixture(t);
  const root = path.join(home, "new"); await mkdir(root);
  const [added] = await Promise.all([
    addOrActivateProject({ root }, { home }),
    updateProjectDefinition({ id: ids[0], name: "renamed" }, { home }),
    activateProject(ids[1], { home }),
  ]);
  await assert.rejects(reorderProjects(ids, { home }), { status: 409 });
  const latest = await loadProjectRegistry({ home });
  assert.equal(latest.projects.length, 4);
  assert.equal(latest.projects[0].name, "renamed");
  assert.ok(latest.projects.some(p => p.id === added.project.id));
  const removals = await Promise.allSettled(latest.projects.map(p => removeProject(p.id, { home })));
  assert.equal(removals.filter(r => r.status === "rejected").length, 1);
  assert.equal((await loadProjectRegistry({ home })).projects.length, 1);
});

test("failed removal guard preserves registry and releases write lock", async t => {
  const { home, ids } = await projectsFixture(t);
  const before = await loadProjectRegistry({ home });
  await assert.rejects(removeProject(ids[0], { home, beforeRemove: () => { throw Error("running"); } }), /running/);
  assert.deepEqual(await loadProjectRegistry({ home }), before);
  await reorderProjects([...ids].reverse(), { home });
});

test("independent Windows writers preserve both new projects", { skip: process.platform !== "win32" }, async t => {
  const { home } = await projectsFixture(t);
  const roots = ["new-d", "new-e"].map(name => path.join(home, name));
  await Promise.all(roots.map(root => mkdir(root)));
  const moduleUrl = new URL("../src/project-registry.mjs", import.meta.url).href;
  const code = `import {addOrActivateProject} from ${JSON.stringify(moduleUrl)};await addOrActivateProject({root:process.argv[2]},{home:process.argv[1]});`;
  const exec = promisify(execFile);
  await Promise.all(roots.map(root => exec(process.execPath, ["--input-type=module", "-e", code, home, root], { windowsHide: true })));
  assert.equal((await loadProjectRegistry({ home })).projects.length, 5);
});

test("dataEditorHome uses DATA_EDITOR_HOME when provided", () => {
  assert.equal(
    dataEditorHome({ DATA_EDITOR_HOME: "C:/Users/lans/.data-editor-test" }),
    path.resolve("C:/Users/lans/.data-editor-test"),
  );
});

test("loadProjectRegistry returns an empty registry when the file does not exist", async (t) => {
  const home = await makeHome(t);
  const registry = await loadProjectRegistry({ home });

  assert.deepEqual(registry, {
    version: 2,
    activeProjectId: null,
    projects: [],
  });
});

test("loadProjectRegistry accepts UTF-8 BOM registry files", async (t) => {
  const home = await makeHome(t);
  await mkdir(home, { recursive: true });
  await writeFile(projectRegistryPath({ home }), `\ufeff${JSON.stringify({
    version: 2,
    activeProjectId: null,
    projects: [],
  })}`, "utf8");

  const registry = await loadProjectRegistry({ home });
  assert.deepEqual(registry, {
    version: 2,
    activeProjectId: null,
    projects: [],
  });
});

test("saveProjectRegistry rejects invalid ids", async (t) => {
  const home = await makeHome(t);

  await assert.rejects(
    () => saveProjectRegistry({
      activeProjectId: "bad/id",
      projects: [{
        id: "bad/id",
        name: "Bad",
        root: home,
        dataSources: [{ id: "data", label: "Data", path: "data", kind: "relative" }],
        filePolicy: { includeExtensions: [".json", ".csv"] },
      }],
    }, { home }),
    /Invalid project id/,
  );
});

test("concurrent project registry saves always leave parseable complete JSON", async (t) => {
  const home = await makeHome(t);
  const registries = Array.from({ length: 20 }, (_, index) => ({
    activeProjectId: `project-${index}`,
    projects: [{
      id: `project-${index}`,
      name: `Project ${index}`,
      root: path.join(home, `Project-${index}`),
      dataSources: [{ id: "data", label: "Data", path: "data", kind: "relative" }],
      filePolicy: { includeExtensions: [".json", ".csv"] },
    }],
  }));
  await Promise.all(registries.map((registry) => saveProjectRegistry(registry, { home })));

  const stored = JSON.parse(await readFile(projectRegistryPath({ home }), "utf8"));
  assert.equal(registries.some((registry) => registry.activeProjectId === stored.activeProjectId), true);
  assert.equal(stored.projects[0].id, stored.activeProjectId);
});

test("addOrActivateProject creates a default data source and avoids duplicate roots", async (t) => {
  const home = await makeHome(t);
  const projectRoot = path.join(home, "ProjectA");
  await mkdir(projectRoot, { recursive: true });

  const first = await addOrActivateProject({ root: projectRoot }, { home });
  const second = await addOrActivateProject({ root: projectRoot.toUpperCase() }, { home });

  assert.equal(first.project.id, second.project.id);
  assert.equal(second.registry.projects.length, 1);
  assert.equal(second.registry.activeProjectId, first.project.id);
  assert.deepEqual(second.project.dataSources, [{
    id: "data",
    label: "Data",
    path: "data",
    kind: "relative",
  }]);

  const stored = JSON.parse(await readFile(projectRegistryPath({ home }), "utf8"));
  assert.equal(stored.projects.length, 1);
});

test("addOrActivateProject rejects a project root that does not exist", async (t) => {
  const home = await makeHome(t);
  const missingRoot = path.join(home, "missing", "Nocturnel");

  await assert.rejects(
    () => addOrActivateProject({ root: missingRoot }, { home }),
    /Project root does not exist/,
  );

  assert.deepEqual(await loadProjectRegistry({ home }), {
    version: 2,
    activeProjectId: null,
    projects: [],
  });
});

test("loadProjectRegistry drops filesystem-root projects and restores a valid active project", async (t) => {
  const home = await makeHome(t);
  const validRoot = path.join(home, "Nocturnel");
  await mkdir(validRoot, { recursive: true });
  await writeFile(projectRegistryPath({ home }), `${JSON.stringify({
    version: 2,
    activeProjectId: "project-59d75dd6",
    projects: [
      {
        id: "nocturnel-e621a436",
        name: "Nocturnel",
        root: validRoot,
        dataSources: [{ id: "data", label: "Data", path: "data", kind: "relative" }],
        filePolicy: { includeExtensions: [".json", ".csv"] },
      },
      {
        id: "project-59d75dd6",
        name: "Project",
        root: path.parse(validRoot).root,
        dataSources: [{ id: "data", label: "Data", path: "data", kind: "relative" }],
        filePolicy: { includeExtensions: [".json", ".csv"] },
      },
    ],
  }, null, 2)}\n`, "utf8");

  const registry = await loadProjectRegistry({ home });

  assert.equal(registry.projects.length, 1);
  assert.equal(registry.projects[0].id, "nocturnel-e621a436");
  assert.equal(registry.activeProjectId, "nocturnel-e621a436");
});

test("loadProjectRegistry rejects legacy fields from a v2 registry", async (t) => {
  const home = await makeHome(t);
  const validRoot = path.join(home, "Nocturnel");
  await mkdir(validRoot, { recursive: true });
  await writeFile(projectRegistryPath({ home }), `${JSON.stringify({
    version: 2,
    activeProjectId: "nocturnel-e621a436",
    projects: [{
      id: "nocturnel-e621a436",
      name: "Nocturnel",
      root: validRoot,
      dataSources: [{ id: "data", label: "Data", path: "data", kind: "relative" }],
      filePolicy: { includeExtensions: [".json", ".csv"] },
      entryActions: [{
        id: "nocturnel-skill-review",
        label: "复核词条",
        icon: "automation",
        targets: {
          files: ["data/skills.json", "data/skills.json"],
          collections: ["skills", "skills"],
        },
        payload: {
          includeRow: true,
          includeNeighbors: true,
        },
      }],
    }],
  }, null, 2)}\n`, "utf8");

  await assert.rejects(() => loadProjectRegistry({ home }), /Unknown project registry field: entryActions/);
});

test("loadProjectRegistry rejects adapter fields from a v2 registry", async (t) => {
  const home = await makeHome(t);
  const root = path.join(home, "Project");
  await mkdir(root, { recursive: true });
  await writeFile(projectRegistryPath({ home }), `${JSON.stringify({
    version: 2,
    activeProjectId: "project",
    projects: [{
      id: "project",
      name: "Project",
      root,
      adapter: "nocturnel",
      dataSources: [{ id: "data", label: "Data", path: "data", kind: "relative" }],
      filePolicy: { includeExtensions: [".json", ".csv"] },
    }],
  }, null, 2)}\n`, "utf8");
  await assert.rejects(() => loadProjectRegistry({ home }), /Unknown project registry field: adapter/);
});
