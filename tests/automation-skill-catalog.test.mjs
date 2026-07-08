import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadAutomationSkillCatalog } from "../src/automation-skill-catalog.mjs";

test("loadAutomationSkillCatalog enumerates project and user skill roots", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "data-editor-skill-catalog-project-"));
  const userHome = await mkdtemp(path.join(tmpdir(), "data-editor-skill-catalog-user-"));
  const originalUserProfile = process.env.USERPROFILE;

  try {
    process.env.USERPROFILE = userHome;
    await mkdir(path.join(projectRoot, ".agents", "skills", "project-skill"), { recursive: true });
    await writeFile(path.join(projectRoot, ".agents", "skills", "project-skill", "SKILL.md"), "# project\n", "utf8");
    await mkdir(path.join(userHome, ".codex", "skills", "user-skill"), { recursive: true });
    await writeFile(path.join(userHome, ".codex", "skills", "user-skill", "SKILL.md"), "# user\n", "utf8");

    const catalog = await loadAutomationSkillCatalog({ projectRoot });
    assert.equal(catalog.provider, "codex");
    assert.equal(catalog.skills.length, 2);
    assert.deepEqual(catalog.skills.map((item) => item.id), ["project-skill", "user-skill"]);
    assert.equal(catalog.skills[0]?.source, "project-agents");
    assert.equal(catalog.skills[1]?.source, "user-codex-home");
  } finally {
    if (originalUserProfile == null) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    await rm(projectRoot, { recursive: true, force: true });
    await rm(userHome, { recursive: true, force: true });
  }
});
