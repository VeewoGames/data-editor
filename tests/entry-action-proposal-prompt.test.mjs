import test from "node:test";
import assert from "node:assert/strict";
import { buildEntryActionProposalPrompt } from "../src/entry-action-proposal-prompt.mjs";

test("proposal prompt requires the exact v3 output contract", () => {
  const prompt = buildEntryActionProposalPrompt({
    skillPath: "C:/skills/example/SKILL.md",
    skillContent: "# Example",
    handoff: {
      version: 3,
      proposalContract: {
        writableFields: ["name"],
        textArtifact: null,
      },
    },
  });

  assert.match(prompt, /顶层必须且只能包含这些键：version, runId, actionId/);
  assert.match(prompt, /禁止返回 status、action、target、error/);
  assert.match(prompt, /changes 必须至少包含一项/);
  assert.match(prompt, /field, beforeExists, before, afterExists, after/);
  assert.match(prompt, /id, path, beforeExists, beforeDigest, afterContent, afterDigest/);
  assert.match(prompt, /summary, evidence/);
  assert.match(prompt, /kind, ref, digest/);
  assert.match(prompt, /可以为空/);
  assert.match(prompt, /SHA-256/);
});
