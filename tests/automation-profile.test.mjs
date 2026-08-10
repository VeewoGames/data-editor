import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyAutomationProfile, loadAutomationProfile, normalizeAutomationProfile, saveAutomationProfile, validateAutomationProfile } from "../src/automation-profile.mjs";

test("loadAutomationProfile returns empty profile when file is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-automation-profile-"));
  try {
    assert.deepEqual(await loadAutomationProfile(root), emptyAutomationProfile());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saveAutomationProfile writes normalized automation profile", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-automation-profile-"));
  try {
    const result = await saveAutomationProfile(root, {
      rules: [
        {
          id: " recheck ",
          label: " Recheck ",
          icon: "refresh",
          targets: [
            { file: " data/skills.json ", collection: " skills " },
            { file: "data/skills.json", collection: "skills" },
          ],
          payload: {
            includeRow: false,
            includeNeighbors: true,
          },
          execution: { kind: "proposal", resultPolicy: "proposal" },
          contractId: "fixture.recheck.v1",
        },
      ],
    });
    assert.equal(result.path, ".data-editor/automation-profile.json");
    const stored = JSON.parse(await readFile(path.join(root, result.path), "utf8"));
    assert.deepEqual(stored, {
      rules: [
        {
          id: "recheck",
          label: "Recheck",
          icon: "refresh",
          enabled: true,
          targets: [
            { file: "data/skills.json", collection: "skills" },
          ],
          payload: {
            includeRow: false,
            includeNeighbors: true,
          },
          execution: { kind: "proposal", resultPolicy: "proposal" },
          contractId: "fixture.recheck.v1",
        },
      ],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("automation profile preserves an optional text artifact declaration", () => {
  const profile = validateAutomationProfile({
    rules: [{
      id: "design",
      label: "Design",
      icon: "edit",
      targets: [{
        file: "data/skills.json",
        collection: "skills",
        textArtifact: {},
      }],
      payload: { includeRow: true, includeNeighbors: false },
      execution: { kind: "proposal", resultPolicy: "proposal" },
      contractId: "fixture.design.v1",
    }],
  });
  assert.deepEqual(profile.rules[0].targets[0].textArtifact, {});
});

test("normalizeAutomationProfile rejects duplicate rule ids", () => {
  assert.throws(() => normalizeAutomationProfile({
    rules: [
      {
        id: "recheck",
        label: "Recheck",
        icon: "refresh",
        targets: [{ file: "data/skills.json", collection: "skills" }],
        payload: { includeRow: true, includeNeighbors: true },
        execution: { kind: "proposal", resultPolicy: "proposal" },
        contractId: "fixture.recheck.v1",
      },
      {
        id: "recheck",
        label: "Explain",
        icon: "sparkles",
        targets: [{ file: "data/skills.json", collection: "skills" }],
        payload: { includeRow: true, includeNeighbors: true },
        execution: { kind: "proposal", resultPolicy: "proposal" },
        contractId: "fixture.recheck.v1",
      },
    ],
  }), /Duplicate entry action rule id/i);
});

test("validateAutomationProfile rejects invalid root shapes", () => {
  assert.throws(() => validateAutomationProfile([]), /Automation profile must be an object/i);
  assert.throws(() => validateAutomationProfile({ rules: "bad" }), /Automation profile rules must be an array/i);
});

test("saveAutomationProfile rejects invalid rule ids", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-automation-profile-"));
  try {
    await assert.rejects(() => saveAutomationProfile(root, {
      rules: [
        {
          id: "Recheck Rule",
          label: "Recheck",
          icon: "refresh",
          enabled: true,
          targets: [{ file: "data/skills.json", collection: "skills" }],
          payload: { includeRow: true, includeNeighbors: true },
          execution: { kind: "proposal", resultPolicy: "proposal" },
          contractId: "fixture.recheck.v1",
        },
      ],
    }), /Entry action rule id must use lowercase letters, numbers, "_" or "-"/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saveAutomationProfile uses profile home when configured", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-automation-profile-"));
  const profileHome = await mkdtemp(path.join(tmpdir(), "data-editor-automation-profile-home-"));
  try {
    const result = await saveAutomationProfile({
      projectRoot: root,
      profileBaseDir: profileHome,
    }, {
      rules: [
        {
          id: "recheck",
          label: "Recheck",
          icon: "refresh",
          enabled: true,
          targets: [{ file: "data/skills.json", collection: "skills" }],
          payload: { includeRow: true, includeNeighbors: true },
          execution: { kind: "proposal", resultPolicy: "proposal" },
          contractId: "fixture.recheck.v1",
        },
      ],
    });
    assert.match(result.path, /automation-profile\.json$/i);
    const stored = JSON.parse(await readFile(result.path, "utf8"));
    assert.equal(stored.rules[0].id, "recheck");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(profileHome, { recursive: true, force: true });
  }
});

test("saveAutomationProfile rejects a stale ETag", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-automation-profile-"));
  try {
    const profile = { rules: [{ id: "recheck", label: "Recheck", icon: "refresh", targets: [{ file: "data/skills.json", collection: "skills" }], payload: { includeRow: true, includeNeighbors: true }, execution: { kind: "proposal", resultPolicy: "proposal" }, contractId: "fixture.recheck.v1" }] };
    const first = await saveAutomationProfile(root, profile);
    await saveAutomationProfile(root, { ...profile, rules: [{ ...profile.rules[0], label: "Changed" }] }, first.etag);
    await assert.rejects(() => saveAutomationProfile(root, profile, first.etag), (error) => error?.code === "AUTOMATION_PROFILE_ETAG_STALE");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent saves with one ETag admit only one writer", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "data-editor-automation-profile-"));
  try {
    const profile = { rules: [{ id: "recheck", label: "Recheck", icon: "refresh", targets: [{ file: "data/skills.json", collection: "skills" }], payload: { includeRow: true, includeNeighbors: true }, execution: { kind: "proposal", resultPolicy: "proposal" }, contractId: "fixture.recheck.v1" }] };
    const initial = await saveAutomationProfile(root, profile);
    const results = await Promise.allSettled([
      saveAutomationProfile(root, { ...profile, rules: [{ ...profile.rules[0], label: "First" }] }, initial.etag),
      saveAutomationProfile(root, { ...profile, rules: [{ ...profile.rules[0], label: "Second" }] }, initial.etag),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected" && result.reason?.code === "AUTOMATION_PROFILE_ETAG_STALE").length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("normalizeAutomationProfile migrates legacy file and collection arrays into target pairs", () => {
  const profile = normalizeAutomationProfile({
    rules: [
      {
        id: "recheck",
        label: "Recheck",
        icon: "refresh",
        targets: {
          files: ["data/skills.json", "data/traits.json"],
          collections: ["skills", "$"],
        },
        payload: { includeRow: true, includeNeighbors: true },
        execution: { kind: "proposal", resultPolicy: "proposal" },
        contractId: "fixture.recheck.v1",
      },
    ],
  });

  assert.deepEqual(profile.rules[0].targets, [
    { file: "data/skills.json", collection: "skills" },
    { file: "data/skills.json", collection: "$" },
    { file: "data/traits.json", collection: "skills" },
    { file: "data/traits.json", collection: "$" },
  ]);
});

test("execution.kind is explicit and closed", () => {
  const base = { id: "check", label: "Check", icon: "refresh", targets: [{ file: "data/a.json", collection: "items" }], payload: { includeRow: true, includeNeighbors: false } };
  assert.throws(() => validateAutomationProfile({ rules: [base] }), /execution is required/i);
  assert.throws(() => validateAutomationProfile({ rules: [{ ...base, contractId: "fixture.check.v1", execution: { kind: "unknown", resultPolicy: "proposal" } }] }), /execution.kind/i);
  assert.throws(() => validateAutomationProfile({ rules: [{ ...base, contractId: "fixture.check.v1", execution: { kind: "proposal", resultPolicy: "result-only" } }] }), /combination/i);
  assert.throws(() => validateAutomationProfile({ rules: [{ ...base, contractId: "fixture.check.v1", execution: { kind: "proposal", resultPolicy: "proposal" }, unknown: true }] }), /Unsupported entry action rule field/i);
  const projectSkill = validateAutomationProfile({ rules: [{ ...base, contractId: "fixture.check.v1", execution: { kind: "project-skill", resultPolicy: "proposal" } }] }).rules[0];
  assert.deepEqual(projectSkill.execution, { kind: "project-skill", resultPolicy: "proposal" });
});
