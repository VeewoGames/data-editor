# entry-action 同源文件并发直写与超时证据缺口

<!-- document-state: historical -->
<!-- state: history -->
## 历史快照

### 同一源文件的运行没有服务端互斥

`server.mjs::handleRunEntryAction(...)` 会为每次请求独立写入 handoff，并立即启动一个后台 `scripts/run-entry-action.mjs`。当前入口没有按 `projectId + sourcePath` 检查其他活动运行，也没有文件级锁或租约。

因此，多个 entry-action 可以同时针对同一源文件运行。`runId` 只隔离运行产物，不能隔离正式数据写入。

### Codex 直接写工作区会绕过 Data Editor 保存门禁

`scripts/run-entry-action.mjs` 以可写工作区模式启动 `codex exec`，prompt 也明确允许修改项目文件。`rowId` 只用于 handoff 目标解析和执行前后重读；它不约束 Codex 实际写入的文件、条目或字段。

这条直接写入路径不经过 `/api/save`，因此不会使用该接口的 `documentEtag` 乐观并发门禁。持久 `rowId` 可以帮助观察目标条目，却不能把一次 Codex 文件写入变成受服务端验证的原子提交。

### `/api/save` 的 ETag 检查与写盘不在统一提交临界区

`server.mjs::handleSave(...)` 当前按“读取当前文本、检查 `documentEtag`、执行异步业务校验、写盘”的顺序保存。代码中没有覆盖这段完整顺序的 document commit mutex，也没有让 Codex 直接写入路径参与同一提交临界区。

因此，`documentEtag` 能拒绝请求开始前已经陈旧的整文档保存，却不能单独保证“检查通过后到写盘前”没有其他写入者改动文件。它是必要的乐观并发门禁，不是所有正式写入者之间的提交串行化机制。

`assertDocumentEtagUnchanged(...)` 在 `documentEtag == null` 时会直接返回，因此当前 `/api/save` 仍允许调用方省略该令牌。现有前端保存链会携带 `documentEtag`，但服务端接口本身还没有把它设为不可绕过的正式写入前置条件。

### detached runner 不由服务进程持有运行与提交生命周期

`server.mjs::handleRunEntryAction(...)` 使用 `detached: true`、`stdio: "ignore"` 和 `unref()` 启动 runner，随后立即返回 `started`。服务进程不保留 child handle，runner 也直接操作工作区，而不是把 proposal 交回一个由服务进程持有的正式提交入口。

这是当前 fire-and-forget 协议的实现事实。服务进程内 job supervisor、内部 commit API 或其他提交所有权模型仍属于尚未落地的替代方案，不能当作当前能力。

### 当前 rowId 解析仍允许回退到 sourceRowIndex

`src/entry-actions.mjs::resolveEntryActionSourceRowIndex(...)` 会优先尝试 `rowId`；但当 `rowId` 缺失或找不到对应条目时，仍会回退到 `sourceRowIndex`。`server.mjs::handleRunEntryAction(...)` 也仍要求 MVP 请求携带 `sourceRowIndex`。

因此，当前“rowId 优先”不等于“正式提交严格只接受 rowId”。任何未来的受控提交协议若要求错目标零容忍，需要另建 strict resolver；该要求尚未在当前执行链落地。

### 重复 rowId 会在文档索引中静默覆盖

`src/model/document-store.mjs::buildCollectionStore(...)` 使用 `Map` 构造 `rowById`、`handleById` 和 `sourceIndexByRowId`，并按源条目顺序反复执行 `set(rowId, ...)`。如果同一 collection 中存在重复 `__entry_id`，后一条会覆盖前一条的索引值，构建过程不会报告重复身份。

`resolveEntryActionSourceRowIndex(...)` 随后直接读取 `sourceIndexByRowId.get(rowId)`，因此当前 rowId 定位没有证明“目标精确匹配一次”，重复身份可能静默解析到靠后的条目。当前执行链也没有 `TARGET_ID_DUPLICATE` 一类的失败结果。

因此，持久 `__entry_id` 已提供稳定身份字段，但当前实现尚未保证该身份在目标 collection 内唯一；“使用 rowId”不能被报告为“唯一定位已验证”。

### 当前前端只把 started 识别为非终态

`src/entry-action-result-wait.ts::waitForEntryActionResult(...)` 当前以 `result.status !== "started"` 作为完成条件。这个判断与现有状态集合相配，但没有独立的终态判定合同。

如果以后直接加入 `queued`、`running`、`proposal_ready` 或 `committing` 等中间态而不先修改该判断，前端会把它们提前当作完成。上述新状态仍是方案意图，不是当前已实现状态。

### writableFields 还不是 automation profile 的正式合同

`src/automation-profile.mjs::normalizeRule(...)` 当前只保留 `id`、`label`、`icon`、`enabled`、`targets`、`payload` 和可选 `runtime`；其中 `payload` 只接受 `includeRow` 与 `includeNeighbors`。仓库当前没有进入 profile normalize、编辑器和执行链的 `writableFields` 字段。

因此，字段级写入权限的 owner、类型约束与“本机 binding 只能缩小、不能扩大”的规则仍是待决策内容，不能写成已具备的安全门禁。

普通 JSON 的 `/api/save` 路径也没有提供面向 traits、runes 等业务集合的通用语义 ID 唯一性 authority。界面侧的字段维护行为或 skill document 专项合同校验，不能被推定为未来 proposal 提交的字段类型与唯一性验证。

### `/latest` 不能恢复同文件其他条目的占用状态

`server.mjs::handleLoadLatestEntryActionResult(...)` 当前要求 `actionId`，并以 `sourcePath + collectionPath + rowId/sourceRowIndex` 查询最近运行。它不能只按 `projectId + sourcePath` 回答“这个文件是否存在其他活动 run”。

因此，当前结果查询可恢复具体条目的最近状态，但不能充当文件级 action admission lock 的恢复或忙碌状态接口。文件级 active-run 查询仍是未实现能力。

### `writebackCheck` 是观察结果，不是运行归因或提交证明

runner 在 Codex 执行前后分别读取整个文件和目标条目，并据此计算：

- `fileChanged`
- `targetRowChanged`
- `changedFields`

这些字段只能说明两次快照之间观察到了什么。它们不能证明变化由当前 `runId` 产生；当同源文件存在并发运行时，其他进程的写入也会进入当前运行的前后快照。

特别是 `fileChanged = true` 且 `targetRowChanged = false` 只证明目标之外发生了变化，不能判定改动属于哪个运行，也不能把它解释成目标条目成功写回。

### 超时结果可能引用尚不存在的输出文件

`runCodexExec(...)` 当前只在内存中累计 `stderr`。超时时，它终止直接 child 并抛出 `codex_exec_timeout`，但不会持久化 stdout、stderr 或独立超时诊断。

超时后的部分结果分支仍会写入预期的 `outputPath`，并在消息中声称输出已经写入 `<runId>.reply.md`；写结果前没有检查该文件是否真实存在。因此，`result.json.outputPath` 和结果消息不能单独证明 reply 产物已经落盘，读取者仍需检查实际文件。

`runCodexExec(...)` 的超时处理只调用直接 child 的 `child.kill()`。当前代码没有确认 Windows 子孙进程树已经全部退出；因此，超时返回本身不能证明后续晚写回已被阻止，也不能作为释放未来文件锁的充分条件。

### `service:finalize` 不会自动清理未来的 entry-action 快照

`scripts/service-finalize.mjs::listTempStopDirectories(...)` 当前只枚举系统临时目录中以 `data-editor-stop-` 开头的目录，现有进程清理计划也围绕正式服务及这些 stop fixture 建立。

因此，不能把当前 `npm run service:finalize` 解释为已经覆盖 entry-action proposal、诊断快照或锁文件的清理合同。若新协议引入这些资源，必须另行接入其 owner、保留策略与安全清理规则。

### 当前结果态不能充当并发安全保证

`completed_with_writeback` 表示 runner 观察到目标条目变化，`completed_without_observed_writeback` 表示未观察到目标条目变化。两者都不是锁、事务、版本门禁或单次运行归因证明。

判断 entry-action 是否安全完成时，必须分开核对：

- Codex 进程是否结束；
- reply 文件是否真实存在；
- 目标条目是否变化；
- 同一源文件是否还有重叠运行；
- 文件变化能否唯一归因到当前运行。

在缺少最后两项证据时，不得把“文件发生变化”升级为“当前运行正确提交了目标修改”。

### 正式执行计划已吸收最终复核修订，但实施门仍未通过

条目自动化并发错写修复的正式执行计划已在最终只读复核后完成小范围修订。当前计划文本已经：

- 将真实 action 启用收口为 `G0 + G1 + H1 -> G2` join 门；
- 要求真实 CLI timeout eligibility 同时满足 `tree confirmed exited + timed_out + lock released + no late write`，并把 `failed_needs_recovery` 保留为非零退出的失败注入结果；
- 明确区分 scratch Playwright 的 `42173/42175` 自动化门与正式 `8787/8791` Browser 门；
- 按 `saveType` 区分 journal 合同，并为 `document_save` 固定客户端稳定 UUID `idempotencyKey` 及重试复用规则；
- 将未来 npm scripts、测试、fixture 与 helper 标为对应批次必须新增、缺失即未完成的交付物；
- 固定 preflight、success、timeout readiness、timeout cutoff、终止后观察窗口和整个专项脚本的最大时限；
- 固定 recovery CLI 的 `inspect` / `recover` 命令、退出合同与证据不足时拒绝释放规则。

这些变化只证明计划文本已完成修订，不证明对应协议、脚本、测试、CLI、恢复能力或运行时门禁已经存在、通过验证或获得实施授权。

D0 的八项架构决策、Data Editor runtime/API/测试/正式文档实施授权、Windows Job Object helper 或依赖引入授权、A 至 G 工具层实施、Nocturnel 独立 owner handoff、真实项目 action 启用和事故数据修复均仍未完成。D0 未决与缺少独立实施授权仍是进入批次 A 的前置阻断。

在 D0、独立实施授权和对应批次验证完成前，现有 direct-write runner、可省略的 `documentEtag`、rowId 回退、快照观察语义及其他本文缺口仍是当前行为。不得把计划中的 hard-disable、supervisor、fencing、isolated proposal、document commit mutex、commit journal、新 phase/outcome、安全清理合同或建议执行顺序描述为已实现、已验证或已接受结果。

## 代码锚点

- `server.mjs::handleRunEntryAction(...)`
- `scripts/run-entry-action.mjs::captureWritebackState(...)`
- `scripts/run-entry-action.mjs::compareWritebackState(...)`
- `scripts/run-entry-action.mjs::runCodexExec(...)`
- `src/model/document-store.mjs::buildCollectionStore(...)`
- `src/entry-actions.mjs::resolveEntryActionRow(...)`
- `src/entry-actions.mjs::resolveEntryActionSourceRowIndex(...)`
- `src/entry-action-result-wait.ts::waitForEntryActionResult(...)`
- `src/automation-profile.mjs::normalizeRule(...)`
- `src/automation-profile.mjs::normalizePayload(...)`
- `server.mjs::assertDocumentEtagUnchanged(...)`
- `server.mjs::handleLoadLatestEntryActionResult(...)`
- `scripts/service-finalize.mjs::listTempStopDirectories(...)`
- `/api/entry-actions/run`
- `/api/entry-actions/latest`
- `/api/save`

## 与既有知识的边界

- `entry-actions-v2-persistent-entry-id-and-stable-location.md` 负责 `__entry_id` 已落地、rowId 优先定位和业务主键职责分离；本文只记录当前 resolver 仍允许行号回退、且重复身份会静默覆盖的严格性缺口。
- `adr/persistent-internal-entry-id-and-entry-action-stable-locating.md` 负责持久内部身份的已接受决策；本文不否定该决策，也不把尚未接受的 strict resolver 方案写成新决策。
- `entry-actions-v2-codex-local-exec-chain-and-writeback-verification.md` 负责本机 Codex 执行协议和运行产物链；本文只负责同源文件并发与证据归因缺口。
- `entry-actions-v2-observed-writeback-status-split-and-project-verification.md` 负责结果状态的观察语义；本文明确该观察在并发条件下不等于单次运行归因。
- `entry-actions-v2-frontend-timeout-false-failure-and-background-result-wait.md` 负责前端停止等待的语义；本文所称超时是 runner 的 `codex_exec_timeout` 以及相应产物真实性。
- `adr/entry-actions-codex-exec-runtime-protocol.md` 保留曾接受的可写 `codex exec` 执行协议；它已被当前 hard-disable 决定取代，本文只记录该旧协议已经证实的并发与诊断约束。
- `adr/document-save-load-hash-optimistic-concurrency.md` 负责“全量保存必须携带内容版本令牌”的已接受决策；本文所述令牌可省略是当前实现仍未完全满足该决策的缺口，不是对该决策的替代。

## 排障与验证规则

1. 调查同源文件的异常写回时，先按时间和 `sourcePath` 对齐所有 handoff、started 与 result 产物，不按单个 `runId` 孤立归因。
2. `fileChanged = true` 但 `targetRowChanged = false` 时，只能报告“目标之外观察到文件变化”，不能推定目标动作成功。
3. `reason = codex_exec_timeout` 时，必须单独检查 `outputPath` 指向的文件是否存在；路径字段和消息文本不是存在性证据。
4. 当前实现没有同源文件并发安全保证。在正式互斥或受控提交机制落地前，同一源文件的 entry-action 需要串行操作。
5. `documentEtag` 只保护经过 `/api/save` 的保存请求，不能据此声称 Codex 直接写文件路径已受并发门禁保护。
6. 不能把“rowId 优先”报告成“rowId 严格提交”；当前 resolver 找不到 rowId 时仍可能回退到 `sourceRowIndex`，重复 `__entry_id` 还会在 Map 索引中静默覆盖并解析到靠后的条目。
7. 扩展运行状态前必须先定义显式终态集合；当前前端只把 `started` 当作非终态。
8. runner 超时后必须单独确认子孙进程树与文件变化；`child.kill()` 和超时结果都不是“不会再写入”的证明。
9. `documentEtag` 当前可被调用方省略；在服务端将其设为必填之前，不能把 `/api/save` 描述为不可绕过的内容并发门禁。
10. `/api/entry-actions/latest` 的条目级最近结果不能替代文件级 active-run 查询。
11. `service:finalize` 当前不会自动识别或清理未来的 entry-action proposal、诊断快照与锁资源。

<!-- state: history -->
## 演进记录

<!-- dated: 2026-07-27 -->
### 旧 direct-write 入口已退出当前运行时

`/api/entry-actions/run` 已在服务端最早的路由分支统一返回 HTTP 503
`ENTRY_ACTION_PROTOCOL_DISABLED`，不再调用本文描述的 legacy runner。因此本文保留为
旧 direct-write 协议的风险与排障快照，不再拥有当前运行时行为；当前门禁和已落地的
pre-enable 基础设施由
[`entry-actions-legacy-protocol-hard-disable-and-preenable-fencing-recovery.md`](./entry-actions-legacy-protocol-hard-disable-and-preenable-fencing-recovery.md)
维护。

<!-- dated: 2026-07-26 -->
### 并发运行暴露观察链的归因边界

一次同源文件的多运行排查确认：多个 entry-action 可以在重叠时间窗口内修改同一文件，且出现“文件变化但当前目标条目未变化”的结果。该证据把问题从单次写回真假进一步收敛为并发写入与运行归因缺口。

同次排查还确认，超时结果可以引用实际不存在的 `.reply.md`。因此，结果状态、输出路径和消息文本必须与真实产物存在性分开验证。

<!-- dated: 2026-07-26 -->
### 执行计划从“已编写”收窄为“复核后需修订”

正式执行计划完成编写后，独立只读复核识别出依赖闭环、协议切换缺口、工具自有验收 fixture 缺失，以及 fencing、journal、真实 CLI E2E、批次检查点和验证命令不完整。治理状态因此从“已有实施文档”收窄为“执行前必须先修订并再次复核”；这次变化不代表任何运行时实现或测试结果。

<!-- dated: 2026-07-26 -->
### 执行计划完成修订并保留实施门

正式执行计划随后吸收复核结论，拆开工具层验收与真实项目 owner handoff 的依赖，补齐协议切换、工具自有 fixture、持久 fencing、全写入 journal、真实 CLI E2E、串行 checkpoint、精确验证命令和 recovery-before-finalize 要求。该变化只收口了计划文档；D0、独立实施授权、代码、测试、数据和真实项目迁移仍保持未完成。

<!-- dated: 2026-07-26 -->
### 最终复核仍判定执行前需小范围修订

修订后的执行计划完成最终只读复核后，主体架构无需扩大或推翻，但仍确认 G2 缺少 G1 显式前置、真实 CLI timeout 可能错误放行、scratch 与正式 Browser 验收混淆，以及 journal、未来测试交付物、执行时限和 recovery CLI 合同不完整。治理状态因此保持为“执行前需做最后一次小范围修订”；D0、独立实施授权和所有实施、测试、数据迁移仍未完成。

<!-- dated: 2026-07-26 -->
### 正式执行计划吸收最终复核结论

正式执行计划随后补齐 `G0 + G1 + H1 -> G2` join 门、严格 timeout eligibility、scratch 与正式 Browser 双门、按 `saveType` 区分的 journal、未来交付物缺失即失败规则、固定执行时限和 recovery CLI 合同。该演进只代表计划文本完成修订；D0、独立实施授权、运行时代码、测试、项目数据与真实 action 启用仍未完成。
