# 已激活 v2 的前向交付与读取效果分离

status: accepted

## context

公共 GET 重复恢复、重新证明、目录资格扫描及全量指纹阻塞首文档。正式 authority 已激活，原来源导入合同不能覆盖后续代码交付；绕过效果准入或更新旧证明会破坏历史闭锁。

## decision

普通纯读取不等待准备完成，也不继承准备失败；readiness 查询只观察状态，准备由明确生命周期 owner 协调。准备尚未完成或因历史任务闭锁失败，也是读取隔离必须覆盖的反例。主文档及必要配置优先，派生读取有界并独立报告失败。完整 authority 新鲜校验留在真实效果前锁内；保存仍读取 fresh 值并保护草稿和配置前像。

已激活 v2 采用独立通用前向升级合同：catalog/schema 仍为 2，运行协议最低 3；原 origin、v1 source proof、前代 active proof 与当前 active policy 分层验证，首升级补存全部原 active pin 字节，沿同 root 前代链验证。固定 legacy26、原50与当前159执行路径集合保持各自含义，不重签旧证明。

交付持固定 Profile 全局 delivery 锁，再持全部 root 锁；校验完整 catalog、逐文件 before/after CAS，保留原 ledger、全部旧闭锁及最新业务/runtime/publication。共享 installedTool 每次合法非空交付都为前代 catalog 全部受保护 root 生成绑定本次 delivery 的新 selection，即使纯前端发布没有 policy 字节差异。验证器必须独立证明实际更新集合 = 前代全部 root = affectedRoots，拒绝漏选、重复 root 及保留旧 selection；不再用 policy 是否变化判定发布是否影响 root。未知字节拒绝，激活后只向前完成，不回滚 selector 或启用旧 reader。

前端派生依赖以当前 context 与 request generation 共同约束状态归属，取消后迟到结果不得发布。切换同步失效旧任务，layout 不执行 builder，读取及同文件计算始终延迟调度，避免旁支计算阻塞主表绘制；失败及重试仍由各自 loader owner 管理。

维护期间新主服务与 bridge 只读验收，普通效果禁止。完成证明要求真实 OS 进程身份、冻结启动字节、同包实例、新鲜挑战、文档及完整静态 HTTP 字节；dist 资源闭包必须完整，跨代退休资源不得继续提供。静默门要求 publication OPEN、无 continuation、全部预约 settled。

## alternatives considered

- 重跑首次导入、init-empty 或直接覆盖源码：不满足已激活来源与精确交付合同。
- 更新旧 receipt、删闭锁或清 continuation 通过维护门：丢失原证明与真实状态。
- 只验证首页或入口脚本：遗漏动态静态资源和跨代残留。
- policy 未变就保留 root 原 selection：共享安装的 dist 已改变，旧 selection 无法证明本次交付；仅信任包自报 affectedRoots 还会允许伪造漏选。

## consequences

升级需要明确维护窗口、精确包确认和紧邻执行的重新核验。候选完成不表示正式激活获批；正常服务活动可使冻结包暂时无法执行。完成交付验收后仍需实际页面验收，正常 fixture 不能替代准备失败的自然项目反例。当前快照和验证限制见[激活 Truth](../data-loading-candidate-and-v2-forward-upgrade-boundary.md)，既有来源归属遵守[外部 authority ADR](./project-generality-and-external-deployment-authority.md)。

<!-- dated: 2026-10-26 -->
## implementation

用户明确批准后，正式前向交付先完成 generation 2；自然验收发现 GET 与准备失败仍耦合，在普通候选修正两文件后经同一通用升级入口完成 generation 3。正式 owner 包括 `server.mjs`、`project-readiness.mjs`、`read-request-context.mjs`、`deployment-upgrade.mjs`、`deployment-delivery.mjs` 和 `deployment-authority-proof.mjs`。31 项定向反例与真实读取通过，历史账本及旧闭锁保留；未声称修正后重跑完整候选集合。

<!-- dated: 2026-10-26 -->
## dependency-lifecycle-and-frontend-delivery

用户明确同意补齐纯前端升级支持并正式激活后，`src/deployment-upgrade.mjs` 的准备器与验证器采用全部受保护 root 更新合同，`src/App.tsx` 修复两条依赖加载链，正式完成 generation 4。schema 2、最低 reader protocol 3、policy 可原样复用、锁/CAS及真实运行验收要求保持。34 项不同定向测试及正式根 11 项生命周期复跑通过，未重跑全量项目测试；具体身份、历史保护和清理快照由关联 Truth 维护。
