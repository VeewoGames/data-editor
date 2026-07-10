# Document 字段 Markdown 不可见问题：docRoot 缓存失效边界与刷新收口

status: accepted

## 结论

- 当前 Document 字段的语义本身是正确的：技能类记录仍以 `skill_id` 作为主键，`docRoot` 只负责指向 Markdown 文档根目录；像 `skill_axe_throw.md` 这种 `<id>.md` 命名仍符合现有匹配规则。
- Markdown “不可见” 的根因不在字段语义，而在 `src/document-service.mjs` 的进程内缓存：`getDocumentCache(projectRoot, docRoot)` 以 `projectRoot + docRoot` 作为 key 常驻缓存索引与正文，外部新增、删除、改名 `.md` 文件后不会自动失效。
- `buildDocumentIndex(...)` 和 `readResolvedDocument(...)` 都走同一条缓存入口；所以前端表面的“重新加载文档索引”如果没有先让 `projectRoot + docRoot` 失效，重新请求到的仍然只是旧缓存。
- 这一轮修复已经落地为完整链路：`src/document-service.mjs` 支持 `forceRefresh`，普通正文读取命中 cached `missing` 后会自动强刷重试一次，而显式 `forceRefresh=true` 不会再额外追加第二次重扫。
- `server.mjs` 已把 `/api/document-index` 与 `/api/document-content` 的 `refresh=1` 透传给服务层；`src/api/client.ts` 也已经支持 `DocumentRequestOptions.refresh`。
- `src/App.tsx` 的手动“重新加载文档索引”现在会先强刷索引，再用更新后的缓存同步重载当前激活文档正文，避免再做一次不必要的全量扫盘。
- 这条边界不应扩展为把 `dev_doc` 改成路径直读，也不应修改 Document 字段语义本身。

## 已落地实现

- `src/document-service.mjs::buildDocumentIndex(...)` 现在接受 `forceRefresh`，可以绕过进程内缓存重新扫描当前 `projectRoot + docRoot`。
- `src/document-service.mjs::readResolvedDocument(...)` 在首次结果为 `missing` 且未显式要求刷新时，会自动再走一次 `forceRefresh` 重试，减少“刚新增但未命中”的假阴性。
- `server.mjs` 通过 `refresh=1` 透传到 `buildDocumentIndex(...)` 与 `readResolvedDocument(...)`，把前端刷新意图和后端失效边界对齐。
- `src/api/client.ts` 的 `DocumentRequestOptions.refresh` 让上层调用能显式请求强刷。
- `src/App.tsx::handleRefreshDocumentIndex()` 会先刷新索引，再基于新索引同步重载当前正文，保持文档索引与正文状态一致。

## 长期行为 / 规则

- Document 字段的职责应始终保持为“主键 ID -> `<docRoot>/<id>.md>`”的稳定映射，不应把 Markdown 可见性问题误判成字段定义错误。
- 只要 `projectRoot + docRoot` 是缓存边界，就必须把新增、删除、改名 `.md` 文件视为索引失效条件。
- 手动刷新应以当前 `docRoot` 为粒度重新建立索引，而不是复用旧的文档索引状态。
- `missing` 只能表示“当前索引未命中”，不能当作对磁盘状态的永久结论。
- `forceRefresh=true` 应作为明确的一次性失效信号，不应在同一次调用链里继续触发重复二次重扫。

## 关联代码

- `src/document-service.mjs`
- `src/App.tsx`
- `src/api/client.ts`
- `server.mjs`
- `tests/document-service.test.mjs`
- `src/detail/DocumentPanel.tsx`
- `src/components/DocumentFieldConfigDialog.tsx`

## 验证标准

- `node --test tests/document-service.test.mjs` 已通过。
- 测试已覆盖新增文档在 `refresh` 后可见、cached `missing` 自动恢复，以及 `projectRoot + docRoot` 缓存隔离。
- 外部新增一个同名 `.md` 文件后，刷新后应能在当前 `projectRoot + docRoot` 下重新命中。
- 删除或改名现有 `.md` 文件后，刷新后不应继续保留旧索引结果。
- 缓存隔离必须以 `projectRoot + docRoot` 为边界，不能跨项目、跨根目录串读。

## 关键检索词

- `buildDocumentIndex`
- `readResolvedDocument`
- `getDocumentCache`
- `forceRefresh`
- `docRoot`
- `skill_id`
- `<id>.md`
- `Document 字段`
- `Markdown 不可见`
