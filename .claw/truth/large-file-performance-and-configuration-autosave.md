# 大文件性能与配置自动保存

<!-- document-state: current -->
<!-- state: current -->

## 当前行为

通用配置保存、滚动计算和打开链优化曾随 generation 5 正式交付；2026-11-01 已在保留当前后端与既有功能的前提下，正式激活 M1 预编译前端。当前交付身份、源码与产物分离及维护限制由[前向升级 Truth](./data-loading-candidate-and-v2-forward-upgrade-boundary.md)统一维护。配置写入仍由原 writer、配置锁和历史效果门负责，不扩大业务数据 authority，也不创建自动化 run。已采用的长期合同见[配置与性能 ADR](./adr/precise-configuration-save-and-incremental-table-performance.md)。

- `src/view-config.mjs`、`src/view-profile.mjs`、`src/shared-views.mjs` 使用 `withHistoricalConfigurationSave`，只授权解析后的具体类别目标；合法外置 profile 也逐次核验。路径别名、其他项目、业务/runtime/ledger/authority 写入、过期 scope 及任何已有历史 scope 下的嵌套准入均拒绝。准入历史锁释放后才取配置锁，真实效果前再锁内核验。
- `src/App.tsx` 保存队列捕获项目、profile、scope epoch、revision 和独立快照；旧响应不能清除较新版本 dirty。失败保留待保存状态，切换等待直接 profile promise 及协调器确认；blocked、deferred、error 不进入新 owner。数据、项目配置和视图设置分别报告保存失败。
- `src/table/variable-row-window.mjs` 按当前 rowId 顺序建立增量行高索引；初始化/行序改变允许 O(N)，点更新和 offset 定位 O(log N)，窗口输出随可见窗口增长。`DataTable.tsx` 批量测量、按布局版本失效、每帧合并更新并恢复 rowId 锚点。布局状态不写入业务文档。
- `src/page-context-storage.ts` 只暂存 dirty scroll entries，flush 时读最新状态合并；切换及正常退出事件提交旧 scope。仍沿用 localStorage 最后写入覆盖语义，不保证跨 tab 读改写原子性；浏览器崩溃或强退也不保证未确认网络保存完成。
- 打开链复用同版本分类、投影和生成结果索引；匹配保持首个结果和严格类型语义。`src/validation/stable-inputs.mjs` 复用等价关联索引，减少重复完整校验；数据、规则、类型和关联实质变化仍失效，不裁剪校验范围。read coordinator 仅向唯一存活消费者转交独占解析值，多消费者继续独立复制，保存基线保持独立。

M1 的隔离整合及有限编辑验收见[中间版交付记录](../../docs/records/2026-11-01-M1表格编辑中间版隔离交付.md)。旧 generation 5 的性能样本仅描述当时冻结构建，不能作为当前 M1 的新性能对照。完整大表滚动和保存目标、正常后端无历史迁移及真实 Windows 输入法验收仍未完成；正式只读页面可用不等于这些目标已达成。

<!-- state: history -->
## 验证与交付历史

<!-- dated: 2026-10-27 -->
### generation 5 已完成快照

已有完成证据为 165 项定向测试通过、35 项发布文件与冻结清单一致，正式独立 fixture 的配置/文档保存、CAS 冲突拒绝及恢复通过。对应回归入口包括 `tests/configuration-author-save.test.mjs`、`tests/configuration-author-http.test.mjs`、`tests/autosave-owner-revision.test.mjs`、`tests/variable-row-window.test.mjs`、`tests/page-context-scroll-writer.test.mjs`、`tests/large-document-derivations.test.mjs` 和 `tests/validation-stable-inputs.test.mjs`。既有 generated-fields HTTP fixture 在前代正式源码与候选均同样失败，不将定向集合扩张为全量项目全绿。

冻结生产构建夹具为 10000 行、36 字段、约 8.494 MB；30 次打开 p50 421.4ms、p95 715.4ms，三轮各 10 秒滚动帧间隔 p95 均 16.8ms。连续滚动探针覆盖 590 次事件，深滚动字号变化锚点偏移约 -0.428px。该结论仅适用于固定环境、路线和夹具；完整脚本归因与峰值内存未可靠测得。不保证任意规模无卡顿，本轮未引入 Worker 或列虚拟化，后续需要新测量和独立设计。

用户对精确包授权后，经既有前向升级合同完成 generation 5；包 SHA256 `37f88087a13cafdb6cade03bee9152ec26c415567b0979b0f396cf8ec5162d13`，deliveryId `016ddfff33218d488692ef217355e632f9bb7647ae7c5fc9f0a3552fd42a2259`。reader protocol 3、159 pins/required、原历史账本及旧 run 拒绝保持。候选退役后 upgrade-verify 仍为 completed，35 项均 after。升级合同及前代证据见[读取与升级 Truth](./data-loading-candidate-and-v2-forward-upgrade-boundary.md)。

正式新标签完成万行与 20 行文件互切，未出现保存失败；原用户标签为保留未确认状态而保留，旧标签可能仍显示旧构建错误。已完成执行的 service:finalize 与 `8787/api/health`、`8791/health` 均为 HTTP 200、ok=true，Browser 位于 `http://127.0.0.1:8787/`。临时服务/标签关闭；五个精确任务目录经用户再次授权移入回收站，只移除候选依赖 Junction，正式依赖、升级包、源码回归和测量证据保留。未 commit/push。本次知识维护未启动服务、操作 Browser 或重跑测试。
