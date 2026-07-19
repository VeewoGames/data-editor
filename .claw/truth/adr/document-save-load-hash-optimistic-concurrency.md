# 文档保存的加载时内容哈希门禁：stale 全量回写冲突边界

status: accepted

## context

`data/content/skills.json` 这条文档保存链已经暴露出一个长期保存协议缺口：`GET /api/document` 只返回 `buildDocumentModel(...)` 生成的文档模型，`/api/save` 对该路径也只做 skill node contract 校验，并没有携带或比对“加载时内容版本令牌”。

因此，只要外部 Codex 或其他写回路径先改写了同一份文档，旧编辑器继续持有整份文档内存副本并再次执行全量保存，就可能把最新内容覆盖回旧状态。当前服务端不会因为这是 stale full-document save 而拒绝它。

这类问题不是 `__entry_id` 是否存在、也不是单个字段校验能解决的，而是典型的文档级并发保存问题：保存是否仍然基于用户刚加载时看到的那一版内容。

## decision

### 1. 文档保存必须基于加载时内容哈希执行 optimistic concurrency

对可全量写回的文档，保存请求必须携带加载时获得的内容哈希或等价版本令牌。服务端保存前要把该令牌和当前磁盘内容重新计算出的哈希进行比对。

比对不一致时，保存必须返回冲突，不得继续写盘。这里的长期语义是“我只允许你保存你加载之后未被别人改过的那一版内容”。

### 2. 外部写回后，旧编辑器保存必须失败而不是覆盖

如果文档在外部 Codex 写回后又被旧编辑器继续编辑，后续全量保存必须判定为冲突。该冲突是预期行为，不是偶发错误。

这条规则的目的不是阻止所有写入，而是阻止“旧内存整文件保存”把新结果悄悄冲掉。

### 3. contract gate 只能约束 schema，不足以替代文档并发门禁

现有 `skill node contract` 的 `contractVersion`、`contractEtag`、`saveToken` 只能证明保存时合同仍匹配，不能证明文档内容仍然是加载时那一版。

所以文档级 optimistic concurrency 需要独立于合同门禁存在，二者职责不同：

- contract gate 负责结构和合同一致性
- content hash 负责文档内容并发一致性

### 4. 这条门禁优先保护全量回写路径

本条 truth 的重点是整份文档保存，而不是局部字段补丁。只要保存链仍然允许把旧整文件写回，就必须先把内容哈希门禁补上。

如果未来再拆局部 patch，也仍应保留相同的“加载时版本必须仍然有效”原则，只是比较粒度可以不同。

## alternatives considered

- 继续只靠 skill node contract 校验：只能挡住 schema/contract 漂移，挡不住文档内容被别的写回链路更新后的覆盖。
- 继续让旧编辑器无条件全量写回：会把外部最新结果重新覆盖成旧快照，风险最高。
- 把冲突交给前端提示而不做服务端拒绝：无法防止并发写入，不能作为长期合同。

## consequences

- `data/content/skills.json` 这类可整文件保存的文档，需要有加载时内容哈希或等价 token 作为保存门禁。
- 外部 Codex 写回后，旧编辑器再次保存应收到冲突响应，而不是静默覆盖。
- 后续如果继续保留整文件保存模式，服务端必须把“当前磁盘版本是否仍等于加载版本”作为写入前置条件。
- 这条合同与 `skill node contract` 校验并行存在，不应互相替代。

## related code

- `server.mjs`
- `src/api/client.ts`
- `src/api/save-documents.mjs`
- `src/document-model.mjs`
- `src/document-service.mjs`
- `tests/api-client.test.mjs`
- `tests/skill-node-contract-save-gate.test.mjs`

## search terms

`/api/document`、`/api/save`、`data/content/skills.json`、`optimistic concurrency`、`content hash`、`stale full-document save`、`__entry_id`、`contractVersion`、`contractEtag`、`saveToken`
