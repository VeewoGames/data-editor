# 历史闭锁的部署承接协议与验证边界

<!-- document-state: current -->
<!-- state: current -->
## Current behavior

## 当前合同

`managed-deployment-successor-v1` 是通用工具交付协议，用于保留原历史闭锁证据并升级代码部署。其原配置和内容寻址证书绑定物理 root/runtime/anchor、原配置快照、原 policy、原 ledger 字节、每份 receipt record/evidence 和目标 policy。2026-10-25 G3 后，正式运行选择入口已改为固定 Profile authority；原工具配置 `config/historical-disposition-deployment.json` 作为原始证明保留副本并从工具交付中清退，不再作为运行来源。请求、项目配置和环境仍不能选择验证来源。

`src/historical-disposition.mjs::readLedger()` 对已承接部署无条件调用 `validateSuccessorLedger()`；删除唯一 receipt、清空 records 或只改 ledger 空白均不能绕过原字节 pin。原 evidence 闭包与当前完整部署仍分别校验。哈希检测漂移，不是抵御同账户恶意写者的密码签名。

## 已退出的管理入口

旧v1管理脚本现已退出，不能作为当前prepare/apply命令运行。原v1证书、配置快照、ledger与receipt仍是不可变验证来源；现行受控管理入口见[README](C:/Code/data-editor/README.md)及scripts/deployment-authority.mjs，任何实际变更另需精确包确认。运行时不回退源码配置，激活后不回滚catalog、不启用旧reader、不恢复业务/runtime/publication快照。

G3之后，G4项目知识及索引迁回、G5后继包的单样例/条件空目录清退均已另行确认并完成。阶段事实统一由[通用化归属](./project-generality-audit-boundary.md)及[G4回执](C:/Code/data-editor/.claw/tasks/2026-10-25/G4隔离候选准备与精确执行包冻结/G4-正式迁回验收报告.md)、[G5回执](C:/Code/data-editor/.claw/tasks/2026-10-25/G5后继候选隔离准备与精确执行包冻结/execution-audit/867f2c5f-3b4a-4f67-b86f-2b896e2f4aa9/result.json)解释。下文的早期阶段描述仅代表G3验收时点，不能当作今天待执行命令。恢复包共享介质与长期接收责任仍未落实，不因清理完成而自动解决。

<!-- state: history -->
## Evolution history

<!-- dated: 2026-10-25 -->
### 文档收口前的完整来源正文

下列正文保持原句；旧命令、旧数量、旧健康和阶段状态仅作历史，不授予执行或覆盖输入权限。原字节归档由本次manifest绑定。原metadata在展示层中和，避免重新进入current。

﻿# 历史闭锁的部署承接协议与验证边界

status: accepted

<!-- state: history -->
## 当前合同

`managed-deployment-successor-v1` 是通用工具交付协议，用于保留原历史闭锁证据并升级代码部署。其原配置和内容寻址证书绑定物理 root/runtime/anchor、原配置快照、原 policy、原 ledger 字节、每份 receipt record/evidence 和目标 policy。2026-10-25 G3 后，正式运行选择入口已改为固定 Profile authority；原工具配置 `config/historical-disposition-deployment.json` 作为原始证明保留副本并从工具交付中清退，不再作为运行来源。请求、项目配置和环境仍不能选择验证来源。

`src/historical-disposition.mjs::readLedger()` 对已承接部署无条件调用 `validateSuccessorLedger()`；删除唯一 receipt、清空 records 或只改 ledger 空白均不能绕过原字节 pin。原 evidence 闭包与当前完整部署仍分别校验。哈希检测漂移，不是抵御同账户恶意写者的密码签名。

<!-- state: history -->
## 离线升级边界

`scripts/historical-deployment-upgrade.mjs` 提供显式离线 prepare/apply，无 HTTP 自动升级或降级。锁顺序固定为 delivery → project。原证据必须完整，publication 为 OPEN、无 continuation、预约全部 settled、无新增未覆盖义务；未知状态拒绝。

v1 离线承接以原配置快照和证书先不可覆盖写入、配置原子切换为唯一生效点；这一历史合同不等同于当前 authority 的唯一 catalog 激活。应用前重查 CAS、候选、证据、业务基线和目标代码；材料存在但未切换不代表完成，精确重试仍重新验证。原 ledger、receipt、历史文件及业务数据不属于升级写入范围。旧 run 保持闭锁，未知业务结果不变成成功，新业务启用仍需独立验收。

<!-- dated: 2026-10-24 -->
<!-- state: history -->
## 实施与验收快照

协议和离线工具已实施，79 项联合回归、类型检查、构建和独立复核通过。反证覆盖证据缺失/篡改、空 ledger、目标漂移、错误原策略、新增义务、非静默状态、CAS 冲突、落盘未生效与精确重试。

经本轮明确授权完成正式部署切换，新进程验证 12 个旧 run 仍为 `HISTORY_RUN_CLOSED`，合法新准入检查通过，13 项历史义务均不阻塞；46 份受保护原件及真实 registry 保持原字节。旧 recovery bridge 曾因旧解析器拒绝新字段，经既有身份核验重启后恢复。最终 service:finalize 和 8787/8791 health 通过，临时资源清理完成，浏览器位于正式地址。以上数量和健康结果均为本次快照，不扩签历史业务结果。

持久证据：[正式验收记录](../../docs/records/2026-10-24-发布证明承接升级与正式验收记录.md)。决策见 [部署承接 ADR](./adr/historical-deployment-successor-evidence-preservation.md)。

<!-- dated: 2026-10-25 -->
<!-- state: history -->
## 后续通用化的边界

源码仓外受控生效证明方向已在 G3 正式交付：原 207 包因 mkdir 后物理重定向拒绝并恢复 v1，随后新 Profile 209 包另行获批，完成受保护 generation 1、正式 reader 与 provenance 创建，最后清退三份旧工具配置。旧空失败现场保留，不能作为信任来源。原证书、配置快照、ledger、receipt 与 evidence 原字节继续校验，新 authority 不能替代 v1/source/origin 证明。

209 目标最终核验零差异，12 旧 run 的 36 次入口检查仍全部拒绝；通用 HTTP、正式 CLI 5/5 和 owner 恢复通过。验收健康为当次快照，开服瞬时超时根因未修复，四个临时证据目录因自动审批拒绝删除而保留。G4/G5 未完成。详见 [通用化归属 ADR](./adr/project-generality-and-external-deployment-authority.md) 与 [正式切换及生产验收状态](./project-generality-audit-boundary.md)。

<!-- state: history -->
## 代码入口

- `src/historical-deployment-successor.mjs`：schema、材料路径与哈希、source policy 和 ledger pin。
- `src/historical-deployment.mjs`：固定 Profile authority snapshot 读取；旧 v1 配置仅是离线原始证明输入。
- `src/historical-disposition.mjs`：公共账本、原 evidence 闭包、当前部署和升级预检。
- `scripts/historical-deployment-upgrade.mjs`：离线锁、重算、不可覆盖材料和原子切换。
- `tests/historical-deployment-integration.test.mjs`：承接反证与重试。
