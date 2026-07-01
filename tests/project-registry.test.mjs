import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  addOrActivateProject,
  dataEditorHome,
  loadProjectRegistry,
  projectRegistryPath,
  saveProjectRegistry,
} from "../src/project-registry.mjs";

async function makeHome(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "data-editor-home-"));
  t.after(async () => {
    await rm(home, { recursive: true, force: true });
  });
  return home;
}

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
    version: 1,
    activeProjectId: null,
    projects: [],
  });
});

test("loadProjectRegistry accepts UTF-8 BOM registry files", async (t) => {
  const home = await makeHome(t);
  await mkdir(home, { recursive: true });
  await writeFile(projectRegistryPath({ home }), `\ufeff${JSON.stringify({
    version: 1,
    activeProjectId: null,
    projects: [],
  })}`, "utf8");

  const registry = await loadProjectRegistry({ home });
  assert.deepEqual(registry, {
    version: 1,
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
        adapter: "nocturnel",
        dataSources: [{ id: "data", label: "Data", path: "data", kind: "relative" }],
        filePolicy: { includeExtensions: [".json", ".csv"] },
      }],
    }, { home }),
    /Invalid project id/,
  );
});

test("addOrActivateProject creates a default data source and avoids duplicate roots", async (t) => {
  const home = await makeHome(t);
  const projectRoot = path.join(home, "ProjectA");

  const first = await addOrActivateProject({ root: projectRoot, adapter: "nocturnel" }, { home });
  const second = await addOrActivateProject({ root: projectRoot.toUpperCase(), adapter: "other" }, { home });

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

test("loadProjectRegistry drops filesystem-root projects and restores a valid active project", async (t) => {
  const home = await makeHome(t);
  const validRoot = path.join(home, "Nocturnel");
  await mkdir(validRoot, { recursive: true });
  await writeFile(projectRegistryPath({ home }), `${JSON.stringify({
    version: 1,
    activeProjectId: "project-59d75dd6",
    projects: [
      {
        id: "nocturnel-e621a436",
        name: "Nocturnel",
        root: validRoot,
        adapter: "nocturnel",
        dataSources: [{ id: "data", label: "Data", path: "data", kind: "relative" }],
        filePolicy: { includeExtensions: [".json", ".csv"] },
      },
      {
        id: "project-59d75dd6",
        name: "Project",
        root: path.parse(validRoot).root,
        adapter: "nocturnel",
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

test("loadProjectRegistry normalizes entryActions and preserves valid runtime action config", async (t) => {
  const home = await makeHome(t);
  const validRoot = path.join(home, "Nocturnel");
  await mkdir(validRoot, { recursive: true });
  await writeFile(projectRegistryPath({ home }), `${JSON.stringify({
    version: 1,
    activeProjectId: "nocturnel-e621a436",
    projects: [{
      id: "nocturnel-e621a436",
      name: "Nocturnel",
      root: validRoot,
      adapter: "nocturnel",
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

  const registry = await loadProjectRegistry({ home });
  assert.deepEqual(registry.projects[0].entryActions, [{
    id: "nocturnel-skill-review",
    label: "复核词条",
    icon: "automation",
    targets: {
      files: ["data/skills.json"],
      collections: ["skills"],
    },
    payload: {
      includeRow: true,
      includeNeighbors: true,
    },
  }]);
});

test("saveProjectRegistry rejects invalid entryActions", async (t) => {
  const home = await makeHome(t);

  await assert.rejects(
    () => saveProjectRegistry({
      version: 1,
      activeProjectId: "nocturnel-e621a436",
      projects: [{
        id: "nocturnel-e621a436",
        name: "Nocturnel",
        root: path.join(home, "Nocturnel"),
        adapter: "nocturnel",
        dataSources: [{ id: "data", label: "Data", path: "data", kind: "relative" }],
        filePolicy: { includeExtensions: [".json", ".csv"] },
        entryActions: [{
          id: "nocturnel-skill-review",
          label: "",
          icon: "automation",
          targets: {
            files: ["data/skills.json"],
            collections: ["skills"],
          },
          payload: {
            includeRow: true,
            includeNeighbors: false,
          },
        }],
      }],
    }, { home }),
    /Missing entry action label/,
  );
});
