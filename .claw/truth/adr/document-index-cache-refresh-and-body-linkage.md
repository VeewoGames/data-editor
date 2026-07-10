# Document 文档索引缓存刷新与正文联动合同

status: accepted

## context

Document 字段在服务运行期间出现“新增 Markdown 文档不可见”时，问题不应被解释成文档语义变化，而应按索引缓存、正文回源和刷新联动来处理。当前项目已经确认：文档读取链路需要同时覆盖单个 `projectRoot + docRoot` 的缓存隔离、手动刷新后的真实重扫、以及正文面板在激活文档存在时的同步更新。

如果继续把这类问题当成业务字段语义问题处理，就会滑向两类长期风险：

1. 误把 `Document` 字段改造成路径直读入口，破坏现有语义边界。
2. 只刷新索引不刷新正文，导致界面仍停留在旧 `missing` 或旧正文状态。

## decision

### 1. `Document` 可见性问题固定按缓存失效修复，不改变字段语义

`Document` 字段 Markdown 不可见的问题，长期上按“索引缓存刷新 + 正文回源联动”处理，不改变 `Document` 字段语义，也不把 `dev_doc` 扩展为路径直读入口。

### 2. 文档缓存以 `projectRoot + docRoot` 作为隔离边界

文档索引缓存必须按单个 `projectRoot + docRoot` 隔离，强制刷新也只能作用于该组合对应的缓存实例，不能把刷新语义扩散成全局重扫。

### 3. `readResolvedDocument` 负责 `missing` 的一次性自动回源

普通正文读取命中 `missing` 时，服务端 `readResolvedDocument` 必须自动执行一次 `forceRefresh` 重试，以恢复新增文档或回填缓存。

如果请求已经显式携带 `refresh=true`，则不再重复触发第二次自动重扫。

### 4. 手动“重新加载文档索引”必须先强刷索引，再联动正文

手动刷新动作的正式合同是：

1. 先对当前 `docRoot` 执行真实强刷。
2. 再复用刷新后的缓存重载当前激活文档正文。
3. 如果当前详情面板存在激活文档，正文展示必须同步更新，不能继续停留在旧 `missing` 或旧正文状态。

### 5. 刷新意图必须能透传到索引与正文接口

`/api/document-index` 与 `/api/document-content` 需要保留 `refresh` 意图的透传能力，使“手动刷新”和“正文重载”共享同一套缓存刷新语义。

## consequences

- `Document` 的长期语义保持稳定，新增 Markdown 的可见性问题不会演变成路径直读设计。
- 缓存刷新和正文联动被收束到同一条合同，减少“索引已刷新但正文未刷新”的半成功状态。
- `missing` 回源逻辑由服务端统一承担，前端不需要自己重复判断缓存是否过期。
- 以 `projectRoot + docRoot` 为隔离边界后，不同项目或不同文档根目录之间不会互相污染缓存状态。

## related code

- `src/document-service.mjs`
- `server.mjs`
- `src/api/client.ts`
- `src/App.tsx`
- `tests/document-service.test.mjs`
- `.claw/tasks/修复-Document-文档索引缓存刷新与正文联动/plan.json`

## search terms

`Document`、`文档索引缓存`、`docRoot`、`projectRoot`、`forceRefresh`、`refresh=true`、`readResolvedDocument`、`missing`、`正文联动`
