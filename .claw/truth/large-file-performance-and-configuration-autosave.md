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

## 配置修复正式激活状态（2026-11-02）

本次配置阶段已按用户授权通过受控升级正式激活到 generation 8：覆盖 S0a 声明资源每次调用内去重、L1 已确认布局立即排队、L2 名称登记去无效写，以及三类配置当前准入、raw CAS 和 unknown 核对。旧版 protocol3 的完整 159 文件契约仅用于已认证的升级前代；新版当前目标仍严格要求 164 文件。真实跨版本完整升级、13 项保护负例及三类配置保存通过，232 个业务文件未变。详见[正式激活记录](../../docs/records/2026-11-02-配置保存修复与跨版本校验正式激活记录.md)。

业务保存、Job 握手及启动改造仍未完成且搁置，不能将配置阶段激活描述为原完整性能目标完成。正式前端使用已验收的预编译产物，根目录开发端 TS 源码及构建依赖未同步；以下诊断和“未实施”表述保留为当时阶段记录，应以本节和激活记录判断当前运行版本。

## 保存等待诊断与当时未实施边界

2026-11-01 的 S0 仅在隔离副本复现，前端为当前 M1 `index-BGcFoDsg.js`（SHA256 `a10d1ae7449e587d44c078cf823bd6585b22797dfcdd55cbdf600ebfc1f94749`），后端为正式磁盘源码副本。小表为当前 3 行、1796 bytes 的 `equipment_bases.json`，大表为当前 187 行、425794 bytes 的 `skills.json`；没有把旧 1870 行扩增样本当成当前大表。两轮完整测试各 20 个操作案例、16 次成功 POST；没有实施或部署修复。

已确认的后端热点由 `src/project-capability-registry.mjs::compileCapabilityState` → `validateDeclaredResources` 拥有：后者平铺 nested manifest 与 document contract/schema 声明，逐项 `readFile`、`JSON.parse`，当前未按路径去重。小表所在项目 231 项声明仅有 32 个不同声明路径；有探针轮次的前三个保存 POST 各执行 4 次该函数，函数直接读取累计 924 次、279824856 bytes，累计约 1154–1521ms。这里是逻辑读取量，不能当作物理磁盘流量；该函数直接统计也不能混同整个 POST 的文件读取。锁等待、数据文件写入与 AJV 编译不是这些样本的主要耗时，合同 GET 也会进入能力校验，因此请求前准备不能全部归为前端 clone。

无后端探针轮次每表 3 次真实数据编辑的 dirty→idle 中位数为小表 5176.6ms、大表 1560.0ms；两表均含约 800ms 防抖。细分探针用于定位函数成本，不能与无探针轮次构成 A/B 或推算优化收益。隔离 authority 为 protocol 2 合成双 root 有效证明，非正式 protocol 3 的完整复刻；其历史/部署证明固定成本不能直接外推正式环境。未控制其他应用或系统 IO，测试副本还有未复制图标资源的限制，故上述不构成正式稳定性能或视觉完整验收。

交叠测试真实复现：数据 POST 已发出后，布局 dirty 可把 `saving` 显示改为 `pending`，文档 ACK 后约再等一次 800ms 才发送 profile。对应调度入口为 `src/save-coordinator.ts::schedule/runFlush/markDirty`；正式源码与 M1 产物的分离限制仍见前向升级 Truth。黄色“待保存”不能证明请求尚未发送。有效样本均最终成功 idle，没有复现永久 Promise 悬挂、失败毒化队列或迟到 ACK 丢新输入，不能把静态风险写成此次现场根因。纯选行、搜索和筛选面板开关未触发保存，尚不覆盖持久筛选规则、同值失焦、输入法等全部入口。

证据支持的最小后续候选是仅在 `validateDeclaredResources` 每次调用内部，按原声明字符串保序去重，保留首现路径、首错顺序和所有原检查点；不规范化路径，不跨项目、调用或请求缓存。该候选尚未获实施授权，不是当前行为。后续须验证重复只读一次、缺失/坏 JSON/异常 IO 与首错不变、阶段间或请求间变化重新读取、跨项目隔离，以及同一小表/大表的完整数据、引用、ETag 和 ACK 时序。状态显示修正及整体无历史迁移仍是独立范围，不能代替实际热点验证或据此扩大 authority。

### 布局等待的独立候选切片（未实施）

布局单独保存与数据/profile 交叠等待需分别验收。现 `src/save-coordinator.ts::schedule/runFlush` 的默认窗口仍为 800ms，成功后若仍 dirty 会重新 `schedule('retry')`。2026-11-01 用户已同意修订设计：L1 改为离散布局真实确认后立即串行排队、连续拖动按原结束确认入口提交；短合并只兜底缺可靠结束事件且已经确认的来源，不能定时发送活跃预览。前序成功后重新核对 owner、ready 与必要依赖，立即消费最新已确认布局，不再增加首次或续轮固定 800ms。旧“保留首次 800ms”候选约束已被替换，历史 S0 测量仍有效；这仍是未实施的设计，不是当前调度行为。

完整 profile 由既有 owner 提供最新完整确认快照，保留已确认的 `viewDrafts` / `structureDrafts`，排除活跃拖动预览与未确认输入。同一物理 profile 内存在按原时机尚未就绪的非布局 intent 时，先等待必要依赖，再完整发送；不得字段拼装旧 baseline 与新值或丢其它确认字段。文本、IME 和其它域保留原时机。保留单一 inFlight、scope/revision、失败与 deferred 门，不替换已发快照，不因布局 ready 重放失败请求或提前提交其它域。L1 不新增 timeout、CAS 或 unknown 恢复机制，也不以整套 S2 为前置。

原控件确认语义不统一改写：`src/table/ColumnHeader.tsx` 的 pointerup 与 pointercancel 共用提交 lastWidth 的结束回调；`src/App.tsx::beginSidebarResize` 和 `src/detail/DetailPanel.tsx::beginPanelResize` 的 cancel 仅清理，不提交。blur、lost capture、unmount、切 scope 及兜底计时本身不能把未确认预览提升为确认。源码入口与正式 M1 产物分离仍见[前向升级 Truth](./data-loading-candidate-and-v2-forward-upgrade-boundary.md)，上述定向源码检查不构成新的运行验收。完整决策与未来验证合同见[布局确认保存 ADR](./adr/layout-confirmation-driven-save-timing.md)。

当前 `server.mjs::handleSaveViewProfile` 先 `saveViewProfile`，再 `registerUserProfileName`，最后响应；`src/user-profile-registry.mjs` 只有进程内 Promise 队列，即使规范化后的 names 不变也会 `mkdir` 和 `atomicWrite`。profile 已落盘但名称登记失败属于可能的部分成功，不能盲目重发旧 profile。L2 候选是在全局 registry 的同一物理目标 OS 锁内读取当前值、规范化、比较，已登记同名且内容不变时跳过写入；首次登记、原 normalize 过滤语义、坏 JSON/版本/I/O 失败语义仍保留，跨进程新增不同名称不得丢更新。该优化尚未实现；现有尾段观测同时包含登记与响应处理，不能当成登记的独占成本或预计收益。

L3 仅设计 profile 正常链无历史切片：先证明当前控制 owner 能在真实物理目标上闭合维护/部署准入、权限/路径归属、alias/跨项目拒绝、协作互斥、旧写完成与 loaded baseline/CAS，再覆盖 profile GET/POST/状态、atomic 下层和必要名称登记的完整闭包。检查点未闭合前不能删历史 wrapper 放行或以禁用合法保存换速度。`src/view-profile.mjs::saveViewProfile` 支持 optional expected 校验不等于普通前端已形成 CAS 闭环；后端历史读零与完整保护负例、布局单独 HTTP 改善均待另行实施验证。L1 同时取消布局确认后的首次及成功后的重复固定防抖，不能宣称已解决单独布局 HTTP 成本；完整 profile 不改为 patch 协议。

<!-- state: history -->
## 验证与交付历史

<!-- dated: 2026-10-27 -->
### generation 5 已完成快照

已有完成证据为 165 项定向测试通过、35 项发布文件与冻结清单一致，正式独立 fixture 的配置/文档保存、CAS 冲突拒绝及恢复通过。对应回归入口包括 `tests/configuration-author-save.test.mjs`、`tests/configuration-author-http.test.mjs`、`tests/autosave-owner-revision.test.mjs`、`tests/variable-row-window.test.mjs`、`tests/page-context-scroll-writer.test.mjs`、`tests/large-document-derivations.test.mjs` 和 `tests/validation-stable-inputs.test.mjs`。既有 generated-fields HTTP fixture 在前代正式源码与候选均同样失败，不将定向集合扩张为全量项目全绿。

冻结生产构建夹具为 10000 行、36 字段、约 8.494 MB；30 次打开 p50 421.4ms、p95 715.4ms，三轮各 10 秒滚动帧间隔 p95 均 16.8ms。连续滚动探针覆盖 590 次事件，深滚动字号变化锚点偏移约 -0.428px。该结论仅适用于固定环境、路线和夹具；完整脚本归因与峰值内存未可靠测得。不保证任意规模无卡顿，本轮未引入 Worker 或列虚拟化，后续需要新测量和独立设计。

用户对精确包授权后，经既有前向升级合同完成 generation 5；包 SHA256 `37f88087a13cafdb6cade03bee9152ec26c415567b0979b0f396cf8ec5162d13`，deliveryId `016ddfff33218d488692ef217355e632f9bb7647ae7c5fc9f0a3552fd42a2259`。reader protocol 3、159 pins/required、原历史账本及旧 run 拒绝保持。候选退役后 upgrade-verify 仍为 completed，35 项均 after。升级合同及前代证据见[读取与升级 Truth](./data-loading-candidate-and-v2-forward-upgrade-boundary.md)。

正式新标签完成万行与 20 行文件互切，未出现保存失败；原用户标签为保留未确认状态而保留，旧标签可能仍显示旧构建错误。已完成执行的 service:finalize 与 `8787/api/health`、`8791/health` 均为 HTTP 200、ok=true，Browser 位于 `http://127.0.0.1:8787/`。临时服务/标签关闭；五个精确任务目录经用户再次授权移入回收站，只移除候选依赖 Junction，正式依赖、升级包、源码回归和测量证据保留。未 commit/push。本次知识维护未启动服务、操作 Browser 或重跑测试。
