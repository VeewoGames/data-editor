import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyAutomationBindings, loadAutomationBindings, normalizeAutomationBindings, saveAutomationBindings, validateAutomationBindings, validateAutomationBindingsRuntime } from "../src/automation-bindings.mjs";

test("loadAutomationBindings returns empty bindings when file is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-automation-bindings-"));
  try {
    assert.deepEqual(await loadAutomationBindings(root), emptyAutomationBindings());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saveAutomationBindings writes to machine-local path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-automation-bindings-"));
  const profileHome = await mkdtemp(path.join(tmpdir(), "data-editor-automation-bindings-home-"));
  try {
    const result = await saveAutomationBindings({
      projectRoot: root,
      profileBaseDir: profileHome,
    }, {
      bindings: {
        " recheck ": {
          provider: "codex",
          skill: " recheck ",
        },
      },
    });
    assert.equal(result.path, ".data-editor/local/automation-bindings.json");
    const stored = JSON.parse(await readFile(path.join(root, result.path), "utf8"));
    assert.deepEqual(stored, {
      defaults: {},
      bindings: {
        recheck: {
          provider: "codex",
          skill: "recheck",
          enabled: true,
        },
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(profileHome, { recursive: true, force: true });
  }
});

test("normalizeAutomationBindings rejects unsupported providers", () => {
  assert.throws(() => normalizeAutomationBindings({
    bindings: {
      recheck: {
        provider: "shell",
        skill: "recheck",
      },
    },
  }), /Unsupported automation binding provider/i);
});

test("validateAutomationBindings rejects invalid root shapes", () => {
  assert.throws(() => validateAutomationBindings([]), /Automation bindings must be an object/i);
  assert.throws(() => validateAutomationBindings({ bindings: [] }), /Automation bindings\.bindings must be an object/i);
});

test("saveAutomationBindings rejects non-boolean enabled values", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-automation-bindings-"));
  try {
    await assert.rejects(() => saveAutomationBindings(root, {
      bindings: {
        recheck: {
          provider: "codex",
          skill: "recheck",
          enabled: "yes",
        },
      },
    }), /enabled must be a boolean/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validateAutomationBindingsRuntime rejects missing skills for codex bindings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-automation-bindings-"));
  try {
    await assert.rejects(() => validateAutomationBindingsRuntime({
      bindings: {
        recheck: {
          provider: "codex",
          skill: "missing-skill",
          enabled: true,
        },
      },
    }, { projectRoot: root }), /未找到 skill/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
