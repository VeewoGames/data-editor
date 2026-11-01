# 通用产品的项目归属与源码仓外生效证明

<!-- document-state: current -->
<!-- state: current -->
## Current behavior

## decision

项目维护业务配置、规则知识与不可变恢复档案；Data Editor 维护通用引擎及源码仓外的受控生效证明，不新增项目专属业务判断。项目档案用于保留恢复材料，不获得选择运行时信任来源的权限。

新 authority 使用 OS Known Folder 的固定位置，禁止请求、项目配置及环境变量改选来源。原生定位器按当前进程账户令牌取得目录，并校验 helper 源码/exe/manifest；正式交付采用 `FOLDERID_Profile` 加固定 `.data-editor/deployment-authority`，G3 已激活受保护 generation 1。原证明按原字节复制为内容寻址对象，保留原位置；新 manifest、policy、intent、envelope 与 catalog 的摘要依赖无环，唯一 catalog 原子激活。首次导入以预期不存在作 CAS，不先发布空 catalog；运行时缺失、漂移及不完整状态拒绝，不回退旧源码配置。效果前在项目效果锁内重读完整 authority，保留其他受保护项目。

原 v1 部署承接与新 authority 迁移是两个合同，不能互相替代。旧 run 继续闭锁，历史未知业务结果不变成成功。原证明保护继续遵守 [既有部署承接 ADR](./historical-deployment-successor-evidence-preservation.md)。


### 当前实施边界

已激活 v2 的后续代码交付采用[前向升级合同](./active-v2-forward-upgrade-and-read-effect-separation.md)，经明确批准已完成 generation 4；共享安装非空发布须更新全部受保护 root 的 selection，policy 不变不表示发布无影响。G3 首次激活的 generation 1 保留为历史阶段。前向交付不替代首次导入证明，原证明与历史闭锁继续保留。

阶段状态以[通用化归属](../project-generality-audit-boundary.md)为唯一摘要入口。下文context及before G3、候选待确认、首次激活等状态均按当时阶段阅读；不能把已激活部署带回首次导入或旧reader分支。保留FOLDERID_Profile、反别名、原证明分层、CAS及激活后前向恢复合同。当前文档承接不更改authority或旧运行闭锁。

### 继续有效的证明、效果与资格合同

原始origin policy、v1 source proof与active policy分层验证，不能改写旧证明来适配新交付。管理入口持delivery→受影响root锁，重算来源与完整catalog CAS；首次导入保留未选项目不变性，已激活共享安装的前向发布则更新全部受保护root的selection。原ledger字节和旧闭锁集合不能缩小。普通效果和异步completion在各自有效owner scope重读，拒绝迟到操作，不通过取消失效检查放行。

条目自动化由唯一projectSkillSandboxArgs owner同时排除隐式TMPDIR与/tmp写根，保留workspace-write、Windows backend及显式project-write；一次性输入副本不自动回拷canonical。真实CLI资格绑定正式resolver选中的CLI路径、codex.exe及兄弟code-mode-host.exe字节，同账户/环境/cwd；选择或二进制漂移必须重新验证，旧二进制仍存在不代表资格有效。

真实Profile根由当前进程token原生定位，读取、创建后和激活时均拒绝别名；不接受请求、项目或环境改选authority，不扫描/自动合并旧库。当前selector已激活，仅按获准before/after CAS前向完成，未知字节或来源/catalog身份不能确认立即停止，保留最新业务/runtime/publication。首次导入、init-empty或旧reader分支不适用于已激活部署。

<!-- state: history -->
## Evolution history

<!-- dated: 2026-10-25 -->
### 文档收口前的完整来源正文

下列正文保持原句；旧命令、旧数量、旧健康和阶段状态仅作历史，不授予执行或覆盖输入权限。原字节归档由本次manifest绑定。原metadata在展示层中和，避免重新进入current。

﻿# 通用产品的项目归属与源码仓外生效证明

status: accepted

<!-- state: history -->
## context

通用编辑器仍包含项目业务默认与固定工具部署实例。直接删除项目绑定会破坏历史闭锁，直接移动原证明又会破坏原路径和字节身份。通用产品改造必须同时保持配置归属、证明选择权和历史保护。

<!-- state: history -->
## decision

项目维护业务配置、规则知识与不可变恢复档案；Data Editor 维护通用引擎及源码仓外的受控生效证明，不新增项目专属业务判断。项目档案用于保留恢复材料，不获得选择运行时信任来源的权限。

新 authority 使用 OS Known Folder 的固定位置，禁止请求、项目配置及环境变量改选来源。原生定位器按当前进程账户令牌取得目录，并校验 helper 源码/exe/manifest；正式交付采用 `FOLDERID_Profile` 加固定 `.data-editor/deployment-authority`，G3 已激活受保护 generation 1。原证明按原字节复制为内容寻址对象，保留原位置；新 manifest、policy、intent、envelope 与 catalog 的摘要依赖无环，唯一 catalog 原子激活。首次导入以预期不存在作 CAS，不先发布空 catalog；运行时缺失、漂移及不完整状态拒绝，不回退旧源码配置。效果前在项目效果锁内重读完整 authority，保留其他受保护项目。

原 v1 部署承接与新 authority 迁移是两个合同，不能互相替代。旧 run 继续闭锁，历史未知业务结果不变成成功。原证明保护继续遵守 [既有部署承接 ADR](./historical-deployment-successor-evidence-preservation.md)。

<!-- state: history -->
## consequences

删除隐式默认前必须核实所有接入项目并显式承接所需配置。项目知识需按内容归属迁回，混合通用合同与历史证据按段处理，不以项目名批量删除。未来产品候选冻结后才能生成最终摘要及切换包；正常活动 publication 状态必须在锁内刷新，不能恢复旧核实快照。

<!-- state: history -->
## alternatives considered

- 直接删除旧绑定、清空登记或原地改写旧证书：破坏保护或证明身份，拒绝。
- 由环境变量或项目指定信任目录：使被验证者选择验证 authority，拒绝。
- 把协议实验直接当正式候选或把目录存在当激活：缺少入口接线与唯一生效证明，拒绝。

<!-- dated: 2026-10-25 -->
<!-- state: history -->
## adoption and implementation boundary (before G3)

G3 前的历史状态：归属方向已采用；G0/G1 后已另行授权并完成 G2 普通副本候选及冻结包，完整 proof adapter、多 root/公共效果入口与离线 CLI 已有候选实现和隔离验证。当时正式源码仍读取工具仓内 v1 配置并包含原业务默认，正式新库未激活；旧 207 包尝试留下的空失败目录保留，新 Profile 库未创建。G2 冻结不是 G3 正式切换。当前状态与验证限制由 [项目绑定 Truth](../project-generality-audit-boundary.md) 维护。

<!-- dated: 2026-10-25 -->
<!-- state: history -->
## activation and failure boundary

原始 origin policy、当前 v1 source proof 和新 active policy 分层验证，不改写旧证明来适配新交付。管理入口持 delivery→全部受影响 root 锁，重算来源、完整 catalog CAS 与未选项目不变性；原 ledger 字节和旧闭锁集合不能缩小。普通效果和异步 completion 以各自有效 owner scope 重读，不通过取消失效检查放行迟到操作。

G2 冻结交付与 G3 正式执行分开。CLI canonical sentinel 隔离硬门已在后续普通候选修复并实测关闭；受影响代码、policy、bundle 和精确写集已重新冻结，仍须用户确认才可正式执行。沿用但未替换的 target policy 文件同样必须列 SHA 前提并紧邻激活复验，不能只查拟写路径。

正式迁移必须先保留旧来源，再激活有保护 catalog、交付并核验新 reader、create-only 保存 provenance，最后才清退明确旧文件。新 catalog 激活后的失败采用保持维护并向前完成，不回退 selector、启用旧 reader 或恢复业务/runtime/publication 快照。恢复包共享责任及 G4/G5 不因本候选通过而视为完成。

<!-- dated: 2026-10-25 -->
<!-- state: history -->
## CLI writable-root and qualification decision

条目自动化候选保留 `workspace-write`、Windows backend 与显式 `project-write`，由单一 `projectSkillSandboxArgs()` 固定同时排除隐式 TMPDIR 和 `/tmp` 写根。一次性输入副本可写但不自动回拷 canonical，不以提示词冒充文件权限，也不通过删除合法项目写能力关闭隔离硬门。采用组合实测结果，不外推单项配置或任意 CLI 版本的安全保证。

真实 CLI 资格必须绑定产品同一 resolver 的实际选择路径和 `codex.exe`/兄弟 `code-mode-host.exe` 摘要；核验在正式服务相同账户、环境、固定 cwd 下进行，不另设 override 绕过选择。外部 CLI 安装不属于产品 50-pin policy，改版或选择漂移必须重新真实验证和冻结。负责权限的 host/config 两 owner 纳入交付 policy；旧证明保持原字节。候选资格 CLOSED 与正式执行批准是独立状态，前者不能替代后者。

<!-- dated: 2026-10-25 -->
<!-- state: history -->
## physical identity and first-activation recovery

原 207 包因 LocalAppData 创建后物理路径重定向而拒绝，恢复 v1；反别名门有效，不能把失败现场 canonicalize 成新信任根。修复候选采用当前进程账户 token 的原生 `FOLDERID_Profile` 固定根，先确认根身份，再拼固定产品后缀，保留创建前后与读取时别名拒绝及认证三件套。不同宿主资格必须证明真实首次对象/catalog 创建、跨宿主冷读及同锁互斥；包检测返回值、KnownFolder flags 或纯路径推导不足以证明物理身份。运行时不扫描或迁移旧库，不接受环境、项目、请求改选 authority。

新 209 包及新物理位置须重新确认，旧 207 授权不续用。首次激活 checker 保持全 before；部分 objects 已落盘但无 selector 时保留 staged，原 v1 完整可恢复原服务，另行核实并准备精确恢复包、复核确认后再执行。底层同包幂等不授权跳过首次准入、改前像、清空 store 或 init-empty。selector 已激活后按已确认逐文件 before/after CAS 向前完成；不能确认 catalog/原件则保持维护、另审恢复包。该恢复决策不改变唯一 catalog CAS 与原证据保护。

<!-- dated: 2026-10-25 -->
<!-- state: history -->
## production activation and remaining scope

新 209 包已获独立确认并完成 G3 正式切换。真实 Profile authority generation 1、正式新 reader、通用中立默认、create-only provenance 与三份旧工具配置晚清退均已交付；旧 v1/source/origin 原始证明继续核验，旧 run 闭锁及未知业务结果语义保持。完整数量、验收与未定位的启动超时限制由 [项目绑定 Truth](../project-generality-audit-boundary.md) 维护，历史候选节不作为当前生产状态。

当前恢复处于 selector 激活后分支：保持新 catalog，保留最新业务/runtime/publication；仅按已确认 before/after CAS 向前补齐，未知字节或原件/catalog 身份无法确认时停止并另审前向修复。冻结 restore-before 只供追溯，不授权回滚 catalog、启动旧 reader、清除或重签历史闭锁。G4 项目知识归位与 G5 后续清退、恢复材料共享责任继续独立处理，不随 G3 验收或知识整理自动完成。
