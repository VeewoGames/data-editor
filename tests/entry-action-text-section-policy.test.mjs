import assert from "node:assert/strict";
import test from "node:test";
import { assertTextArtifactSectionPolicy, normalizeSectionOnlyPolicy } from "../src/entry-action-text-section-policy.mjs";

const sectionOnly = { heading: "Design", level: 2, allowCreate: true, allowUpdate: true };
const policy = { sectionOnly };

test("section-only update changes exactly one target section and preserves all other bytes", () => {
  const before = "# Title\r\nintro\r\n## Design\r\nold\r\n### Detail\r\nkeep in section\r\n## Notes\r\nleave\r\n";
  const after = "# Title\r\nintro\r\n## Design\r\nnew\r\n### Detail\r\nchanged inside section\r\n## Notes\r\nleave\r\n";
  assert.doesNotThrow(() => assertTextArtifactSectionPolicy(policy, { beforeExists: true, beforeContent: before, afterContent: after }));
  assert.throws(() => assertTextArtifactSectionPolicy(policy, { beforeExists: true, beforeContent: before, afterContent: after.replace("leave", "tampered") }), { code: "ENTRY_ACTION_TEXT_ARTIFACT_SECTION_POLICY_FAILED" });
  assert.throws(() => assertTextArtifactSectionPolicy(policy, { beforeExists: true, beforeContent: before, afterContent: after.replace("# Title", "# Other") }), { code: "ENTRY_ACTION_TEXT_ARTIFACT_SECTION_POLICY_FAILED" });
});

test("section-only create requires one exact heading and explicit create authority", () => {
  assert.doesNotThrow(() => assertTextArtifactSectionPolicy(policy, { beforeExists: false, afterContent: "# Doc\n## Design\nbody\n" }));
  assert.throws(() => assertTextArtifactSectionPolicy(policy, { beforeExists: false, afterContent: "## Design\na\n## Design\nb\n" }), { code: "ENTRY_ACTION_TEXT_ARTIFACT_SECTION_POLICY_FAILED" });
  assert.throws(() => assertTextArtifactSectionPolicy({ sectionOnly: { ...sectionOnly, allowCreate: false } }, { beforeExists: false, afterContent: "## Design\nbody\n" }), { code: "ENTRY_ACTION_TEXT_ARTIFACT_SECTION_POLICY_FAILED" });
});

test("section-only configuration rejects unknown or unsafe shapes", () => {
  assert.deepEqual(normalizeSectionOnlyPolicy(sectionOnly, (message) => { throw new Error(message); }), sectionOnly);
  assert.throws(() => normalizeSectionOnlyPolicy({ ...sectionOnly, unknown: true }, (message) => { throw new Error(message); }), /sectionOnly/);
  assert.throws(() => normalizeSectionOnlyPolicy({ ...sectionOnly, heading: "Bad\nHeading" }, (message) => { throw new Error(message); }), /sectionOnly/);
});

test("section-only heading scan ignores Markdown and HTML code-like pseudo headings", () => {
  const text = "# Doc\r\n```md\r\n## Design\r\n```\r\n    ## Design\r\n<div>\r\n## Design\r\n</div>\r\n\r\n## Design ###\r\nbody\r\n### Nested\r\ninside\r\n## Notes\r\noutside\r\n";
  assert.doesNotThrow(() => assertTextArtifactSectionPolicy(policy, { beforeExists: false, afterContent: text }));
  assert.doesNotThrow(() => assertTextArtifactSectionPolicy(policy, { beforeExists: true, beforeContent: text, afterContent: text.replace("body\r\n", "changed\r\n") }));
  assert.throws(() => assertTextArtifactSectionPolicy(policy, { beforeExists: true, beforeContent: text, afterContent: text.replace("outside", "tampered") }), { code: "ENTRY_ACTION_TEXT_ARTIFACT_SECTION_POLICY_FAILED" });
  assert.throws(() => assertTextArtifactSectionPolicy(policy, { beforeExists: false, afterContent: `${text}\r\n## Design\r\nduplicate\r\n` }), { code: "ENTRY_ACTION_TEXT_ARTIFACT_SECTION_POLICY_FAILED" });
  assert.throws(() => assertTextArtifactSectionPolicy(policy, { beforeExists: false, afterContent: "```\n## Design\n" }), { code: "ENTRY_ACTION_TEXT_ARTIFACT_SECTION_POLICY_FAILED" });
});

test("section-only scanner covers CommonMark HTML block types 1 through 7", () => {
  const html = "<script>\n## Design\n</script>\n<!--\n## Design\n-->\n<?owner\n## Design\n?>\n<!DECL\n## Design\n>\n<![CDATA[\n## Design\n]]>\n<details>\n<summary>title</summary>\n## Design\n</details>\n\n<x-card data-x=\"1\">\n## Design\n</x-card>\n\n## Design ###\nreal\n";
  assert.doesNotThrow(() => assertTextArtifactSectionPolicy(policy, { beforeExists: false, afterContent: html }));
  assert.throws(() => assertTextArtifactSectionPolicy(policy, { beforeExists: false, afterContent: html.replace("\n\n## Design ###", "\n## Design ###") }), { code: "ENTRY_ACTION_TEXT_ARTIFACT_SECTION_POLICY_FAILED" });
});

test("type-7 HTML tags use the complete CommonMark attribute grammar", () => {
  const validTags = [
    '<x-card title="a > b">',
    "<x-card title='a < b'>",
    '<x-card first second="two" third=three>',
    "<x-card value=unquoted />\t",
    "</x-card>   ",
  ];
  for (const tag of validTags) {
    const content = `${tag}\n## Design\npseudo\n\n## Design\nreal\n`;
    assert.doesNotThrow(() => assertTextArtifactSectionPolicy(policy, { beforeExists: false, afterContent: content }), tag);
  }

  const invalidTags = [
    '<x-card title="unterminated>',
    "<x-card title='unterminated>",
    "<x-card value=bad`value>",
    "<x-card value=bad=value>",
    "<x-card value=bad<value>",
    "<x-card value=>",
    "</x-card extra>",
  ];
  for (const tag of invalidTags) {
    const content = `${tag}\n## Design\npseudo\n\n## Design\nreal\n`;
    assert.throws(() => assertTextArtifactSectionPolicy(policy, { beforeExists: false, afterContent: content }), { code: "ENTRY_ACTION_TEXT_ARTIFACT_SECTION_POLICY_FAILED" });
  }
});
