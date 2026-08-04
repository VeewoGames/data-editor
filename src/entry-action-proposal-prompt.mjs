export function buildEntryActionProposalPrompt({ skillPath, skillContent, handoff }) {
  if (typeof skillPath !== "string" || !skillPath) throw new TypeError("skillPath is required.");
  if (typeof skillContent !== "string" || !skillContent.trim()) throw new TypeError("skillContent is required.");
  if (!handoff || typeof handoff !== "object") throw new TypeError("handoff is required.");
  return [
    "你正在 data-editor 的隔离目录中执行 proposal-only 条目自动化。",
    "禁止修改任何项目文件、禁止执行项目命令、禁止返回 Markdown 围栏。",
    "只返回一个符合 handoff.proposalContract 的 JSON 对象；由 data-editor 校验并提交。",
    "若无法形成合法 proposal，应明确失败，不得伪造写回。",
    "proposal 顶层必须且只能包含这些键：version, runId, actionId, sourcePath, canonicalFileKey, collectionPath, rowId, baseDocumentEtag, ruleDigest, fencingToken, changes, textArtifact, summary。",
    "禁止返回 status、action、target、error 等额外顶层键。",
    "version 必须为 3；runId、actionId、sourcePath、canonicalFileKey、collectionPath、rowId、baseDocumentEtag、ruleDigest、fencingToken 必须从 handoff 对应字段原样复制。",
    "changes 必须至少包含一项；每项必须且只能包含 field, beforeExists, before, afterExists, after。field 必须来自 proposalContract.writableFields，before 必须与 entry.row 当前值一致，after 必须是实际变化后的值。",
    "若 proposalContract.textArtifact 为 null，textArtifact 必须为 null；若 proposalContract.textArtifact 非 null，textArtifact 必须返回完整文档，且只能包含 id, path, beforeExists, beforeDigest, afterContent, afterDigest，并从 proposalContract.textArtifact 原样复制 id、path、beforeExists、beforeDigest。不得省略该文档。",
    "textArtifact.afterContent 必须是完整 Markdown 文档内容；afterDigest 必须是 afterContent UTF-8 内容的 SHA-256 小写十六进制摘要。",
    "不要输出空 changes、不要输出无变化的 change、不要用解释对象替代 proposal。若确实无法产生至少一项合法变更，应终止并明确失败。",
    `技能来源（只读）：${skillPath}`,
    "",
    "<skill>",
    skillContent.trim(),
    "</skill>",
    "",
    "<handoff>",
    JSON.stringify(handoff, null, 2),
    "</handoff>",
    "",
    "最终响应只能是 proposal JSON 对象。",
  ].join("\n");
}
