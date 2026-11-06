# 数据加载优化候选与 v2 前向升级边界

<!-- document-state: current -->
<!-- state: current -->
## 当前状态

读取全链路优化、依赖加载竞态修复及已激活 v2 authority 的通用前向升级入口已正式交付。最近已完成部署为配置客户端协议修复：catalog generation 9，deliveryId `81673b40122a214cf8de2f7a109bb211e39108bed2b1b7400e38d148ddfbc77c`，升级器返回 completed。沿用既有 v2 前向升级与历史保护合同。generation 5 的配置及性能样本由[大文件性能 Truth](./large-file-performance-and-configuration-autosave.md)维护，不代表当前 M1 的新测量。

正式 `scripts/deployment-authority.mjs` 的 prepare/apply 属于来源导入；已激活 v2 的代码交付使用独立 upgrade-prepare/upgrade-verify/upgrade-apply/upgrade-complete。首次导入、init-empty、改旧摘要或直接覆盖受保护源码均不能替代前向交付。既有生效与项目归属由[通用化 Truth](./project-generality-audit-boundary.md)维护。

## 正式行为

- health 和静态资源脱离项目恢复；普通纯 GET 不等待项目准备，也不继承准备失败。readiness GET 只查看状态；启动、项目生命周期 POST、显式 retry 和后台发现负责准备；普通写入及异步 completion 仍由原 owner 锁内执行完整效果准入。
- 单文件资格沿路径核验，不重扫目录。当前文档及必要模板先可用，指纹后台限流；迁移证据不完整不自动回写。
- GET 在途共享按项目、配置、代次和新鲜性隔离，消费者各有总期限、取消及独立值；后台有界且前台优先。保存 fresh 读取绕开旧请求，迟到响应不得覆盖选择或草稿。
- 关系和反向引用局部失败可见，设置只加载选中目标元数据，Markdown 索引不预读正文，图标失败缓存可恢复。配置迁移比较前像，冲突保留最新值。
- 关联候选及反向关联只允许当前 context、request generation 且未取消的任务发布结果、错误及终态。context 包含项目、文件、集合、模型、表格 revision 和相关配置；切换、reset、unmount 同步使旧任务失效。layout 只失效和清理派生状态，读取及同文件计算均延迟调度；旧延迟回调不得取消新任务，反向关联性能收尾还核对 perf generation。空模型不启动，部分失败、异常及重试有明确状态。
- 共享 installedTool 的合法非空交付为当前 catalog 全部受保护 root 创建绑定本次 delivery 的新 selection；policy 字节可不变。验证器独立约束实际更新集合等于前代全部 root 且等于 affectedRoots，拒绝漏选或保留旧 selection；schema、reader protocol、历史保护与完整验收要求不变。

升级合同见[前向交付 ADR](./adr/active-v2-forward-upgrade-and-read-effect-separation.md)。正式实现入口包括 `server.mjs`、`src/project-readiness.mjs` 及 deployment-upgrade/deployment-delivery 模块；产品保持通用，不引入具体项目业务分支。

## 当前源码构建与交付边界

generation 9 修复前先把 HEAD 源码构建到独立输出目录，证明其入口与当时正式 dist 一致，再构建冻结候选并经原 upgrade 流程交付；因此旧 M1 阶段“源码未同步，重建必回退”的判断不再作为当前事实。正式 `dist/index.html` 现引用 `/assets/index-DPDCTlfb.js`。受保护 dist 仍不能直接用构建覆盖；应独立输出、核对当前前像与候选闭包，通过既有 prepare/verify/apply/complete 发布，不绕过 package/lock pin、catalog 或原静默门。

本次 4 项变化静态资源的实际 HTTP 摘要与冻结产物一致，代表性业务文档 ETag 由 complete 核对；这是受控交付验收，不等于正式业务编辑、全量业务字节审计、性能目标或人类 UI 验收。配置客户端行为与 44 项定向回归边界由[保存 Truth](./large-file-performance-and-configuration-autosave.md)维护。核对锚点为 `dist/index.html`、`src/deployment-upgrade.mjs::completeAuthorityUpgrade` 与 `src/deployment-runtime.mjs::verifyRuntimeDelivery`。

发布前 3 条 dead-owner 未启动登记经身份及无 handoff/started/result、无阻塞义务核验后，通过既有 publication close/reconcile/ABORT 结清，未改配置原文。执行收尾已有 service:finalize exit 0、两端 health HTTP 200；本任务隔离 fixture 和基线构建已按逐文件/空目录规则清理，候选、包和必要证据保留。未操作用户 Browser。本次知识维护未启动服务或重跑测试。

<!-- state: history -->
## 验证快照与限制

<!-- dated: 2026-11-01 -->
### M1 静态先行交付与当时维护限制

用户明确接受静态先行及四文件维护恢复后，原升级器已完成 13 项前向交付：9 项静态增替删，以及 `src/multiselect-config.mjs`、`src/table/table-column-signatures.mjs`、`src/table/table-runtime-deps.mjs`、`src/view-config.mjs` 的当前版本重新纳管。四项最终内容与维护前一致；其余 M1 源码、`package.json`、`package-lock.json` 和正式依赖没有同步。数字选项语义继续由[类型往返 Truth](./option-json-scalar-type-roundtrip.md)维护。

版本为 `M1-frontend-2026-11-01-static`；deliveryId `a1f5ea3018fc51437590ad684816b51ec15d2790728a1753c5a185ec13d9bc32`，bundle SHA256 `ae1c61a01ed4c88a71e72de16899d5cadddcb994b66b4de96f372c4d9cf05270`，catalog SHA256 `5f49b89cef58d78285f860377db005714af14650aab67b6e475d7cb1bb6eeb87`。当时 `dist/index.html` 引用 `/assets/index-BGcFoDsg.js`。结论与完整执行记录见[正式激活记录](../../docs/records/2026-11-01-M1静态先行正式激活记录.md)。

当时不能在正式目录运行 `npm run build` 覆盖 dist：彼时源码与依赖尚未同步为 M1，重建会生成旧前端；本段仅保留阶段恢复背景，当前构建判断见上文。完整源码/依赖部署须单独完善交付能力；原完整源码包、精确静态包、bootstrap 与受信/当前源备份保留用于后续交付及恢复。此限制不是新的依赖部署合同：`src/deployment-upgrade.mjs::verifyBefore` 仍核验 package/lock 的 bootstrap pin 并拒绝 `HISTORY_UPGRADE_DEPENDENCIES_CHANGED`，不能绕过保护或手改 catalog。

本次维护先保全当前与受信版本，原 stop 及 `src/deployment-runtime.mjs::assertServicesStopped` 证明写者退出后才临时恢复四项受信前像。首次 prepare 被已死服务的四条未启动 continuation 阻断；核验真实身份和无 handoff/started/result 后，通过既有 publication `close → reconcile → ABORT` 入口结清，再执行原 upgrade-prepare/verify/apply。publication generation 与 catalog generation 是独立计数。selector 切换后仅按同冻结包前向完成，没有回滚 catalog、改写历史结果或重放业务。

`src/deployment-upgrade.mjs::completeAuthorityUpgrade` 与 `src/deployment-runtime.mjs::verifyRuntimeDelivery` 在实际正式实例通过身份挑战、静态资源和代表性文档 ETag 后才记录 completed。本次已有证据：13 项 after、6 项实际 served 静态资源 SHA 一致、部署前声明的 traits 基线 SHA 及 skills 文档 ETag 保持；只读正式页面显示技能表 Total187/Visible51，无 dirty 提示。该边界不扩大为全部业务文件字节审计、正式编辑验收、完整性能达标或真实输入法验收。

执行收尾已有 `service:finalize` 通过，`8787/api/health` 与 `8791/health` 均 HTTP 200，Browser 位于 `http://127.0.0.1:8787/`；本轮临时服务为 0，空暂存目录已删除，其余恢复证据保留。本次知识维护未启动服务、操作 Browser 或重跑测试。


<!-- dated: 2026-10-26 -->
### generation 4：依赖加载修复与纯前端发布

`src/App.tsx` 的生命周期修复由 `tests/dependency-load-lifecycle.test.mjs` 抽取实际 loader/effect 回调执行确定性竞态验证。已有完成证据为加载 26 项、升级 8 项，共 34 项不同定向测试通过；typecheck/build 通过，正式安装根另复跑 11 项生命周期测试。未重跑整个项目全量测试。升级回归覆盖连续两次纯 dist 发布、同 policy 新 envelope、多 root 漏选伪造、旧包 stale、完整静态闭包和持久化边界中断前向恢复；不将受控中断等同物理断电证明。

包 SHA256 `644827b833129ce94f98dc5a50477ed1327d85013bcebf7491e95687a06fb7b9`，deliveryId `e227b46fcf62ab52a283a113c493525eaaa6dfe648221e48980302f845a76ce7`，12 项交付完成 CAS 与真实主服务/bridge/HTTP 验收，正式 CLI 为 completed、全部 after。历史账本 SHA256 保持 `1530c8207aa046e55697e7fe11ded269cd0aaf3f240d55af68cfb547ffcab809`，新准入及旧任务拒绝均验证通过；停服遗留已死 observe 经既有 close/reconcile/ABORT owner 合同回收。

真实 Browser 在符文、职业及往返切换中未卡住加载提示，warn/error 为 0；最终恢复既有视图与搜索，停留 `http://127.0.0.1:8787/`。候选源码、测试和 dist 已保全，候选 node_modules junction 安全摘除后候选移入回收站，正式依赖未变；候选退役后正式 CLI 再核验 completed。保留最新包、清单、设计及验收证据，本轮临时进程/fixture 目录为 0，service:finalize 通过，两端 health 均 HTTP 200。这些是已完成执行的证据，本次知识维护未启动服务、操作 Browser 或重跑测试。

<!-- dated: 2026-10-26 -->
### generation 2–3：读取优化及准备隔离

候选最终按具体测试名汇总的完整集合为 1267 项通过，0 最终失败、取消或跳过；类型检查与构建通过。首轮并发 1266 项为 1264 通过、1 失败、1 超时取消，后续受控重跑闭合，不能称一次并发全绿。独立整体审查发现 dist 闭包遗漏，作者补齐负向测试、静态资源闭包及跨代资源淘汰；修复记录不冒充第二次独立审查。故障边界是受控异常，未证明物理断电恢复。

250 文件约 15MB 通用 fixture、冷暖各 30 次：冷首表 P95 373.71ms，暖 291.47ms，单文档 HTTP P95 4.90ms，health P95 1.03ms，pageerror 0。冷样本指全新浏览器上下文，服务已运行。约 20MB 的既有冻结样本仍有最高 522ms 同步长任务；不保证任意规模、硬件、慢盘或多窗口饱和的固定延迟。

冻结包 SHA256 为 `3eaacbdef647f0600a29dbcca47083a0d494170615ddb3c5a718c989a5e3e5d3`，deliveryId 为 `e5b7ad7e7b595c73c0d6bee570b4697c51495255bba8dcdc2895ff12b77b1cfe`；准备时正式 673 项源码基线一致，包包含 70 项源码/测试差异、55 项产品源码/dist 交付操作及 6 个静态文件。包身份不等于执行许可。

候选冻结时 verify 曾因旧正式服务存在 identity-recovery observe continuation，正确拒绝 `HISTORY_UPGRADE_NOT_QUIESCENT`。publication 为 OPEN 仍不足以通过静默门。此次获批后正常停服，原冻结包完成 generation 2；自然项目随后暴露 GET 等待准备并传播旧任务闭锁失败的缺口，故该阶段完成回执不代表页面已恢复。

修正只涉及 `server.mjs` 与 `src/project-readiness.mjs`：移除纯读取对准备等待/失败的依赖及未用 observe API。pending/failed 准备反例先失败，修复后 31 项定向检查通过；未重跑完整 1267 项。修正包 SHA256 为 `8bb6adc6e879700bd2619a2112db06c7396a50120a9e26e64b137203a21015a3`，deliveryId 为 `736d2938e924382bca31f3c70f4f5df83335081e89d9492ecbfd272b8a969b78`，沿同一通用入口完成 generation 3，真实主/bridge、文档、完整静态 HTTP 验收及最终全部 after 核验通过。停服遗留本轮已死进程的观察预留，经现有 close/reconcile/ABORT owner 合同回收；未手改保护状态或重放旧业务。

正式 Browser 实际显示 classes.json 16/16 条及 traits.json；classes 五次 HTTP 200 为约 2.19–23.90ms，是本机少量接口样本，不保证任意文件或硬件首帧。收尾 service:finalize 退出 0，8787/api/health 与 8791/health 均 HTTP 200、ok=true，Browser 位于 `http://127.0.0.1:8787/`；候选进程及测试 authority 临时目录为 0。

四个与保留副本 SHA 相同、无活跃 producer 的重复临时诊断文件，直接删除被自动审批拒绝后以可恢复回收站方式移走；归档副本、protected fixture、源码、回归及交付证据保留，未泛化删除目录。上述均为已存完成证据，本次知识维护未重跑测试或健康检查。
