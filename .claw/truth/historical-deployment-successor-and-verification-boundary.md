# 历史闭锁的部署承接协议与验证边界

status: accepted

## 当前合同

`managed-deployment-successor-v1` 是通用工具交付协议，用于保留原历史闭锁证据并升级代码部署。固定工具配置 `config/historical-disposition-deployment.json` 精确 pin 内容寻址证书，绑定物理 root/runtime/anchor、原配置快照、原 policy、原 ledger 字节、每份 receipt record/evidence 和目标 policy。请求、项目配置和环境不能选择验证来源。

`src/historical-disposition.mjs::readLedger()` 对已承接部署无条件调用 `validateSuccessorLedger()`；删除唯一 receipt、清空 records 或只改 ledger 空白均不能绕过原字节 pin。原 evidence 闭包与当前完整部署仍分别校验。哈希检测漂移，不是抵御同账户恶意写者的密码签名。

## 离线升级边界

`scripts/historical-deployment-upgrade.mjs` 提供显式离线 prepare/apply，无 HTTP 自动升级或降级。锁顺序固定为 delivery → project。原证据必须完整，publication 为 OPEN、无 continuation、预约全部 settled、无新增未覆盖义务；未知状态拒绝。

原配置快照和证书先不可覆盖写入，配置原子切换是唯一生效点。应用前重查配置 CAS、候选、证据、业务基线和目标代码；材料存在但未切换不代表完成，精确重试仍重新验证。原 ledger、receipt、历史文件及业务数据不属于升级写入范围。旧 run 保持闭锁，未知业务结果不变成成功，新业务启用仍需独立验收。

<!-- dated: 2026-10-24 -->
## 实施与验收快照

协议和离线工具已实施，79 项联合回归、类型检查、构建和独立复核通过。反证覆盖证据缺失/篡改、空 ledger、目标漂移、错误原策略、新增义务、非静默状态、CAS 冲突、落盘未生效与精确重试。

经本轮明确授权完成正式部署切换，新进程验证 12 个旧 run 仍为 `HISTORY_RUN_CLOSED`，合法新准入检查通过，13 项历史义务均不阻塞；46 份受保护原件及真实 registry 保持原字节。旧 recovery bridge 曾因旧解析器拒绝新字段，经既有身份核验重启后恢复。最终 service:finalize 和 8787/8791 health 通过，临时资源清理完成，浏览器位于正式地址。以上数量和健康结果均为本次快照，不扩签历史业务结果。

持久证据：[正式验收记录](../../docs/records/2026-10-24-发布证明承接升级与正式验收记录.md)。决策见 [部署承接 ADR](./adr/historical-deployment-successor-evidence-preservation.md)。

## 代码入口

- `src/historical-deployment-successor.mjs`：schema、材料路径与哈希、source policy 和 ledger pin。
- `src/historical-deployment.mjs`：固定工具交付配置。
- `src/historical-disposition.mjs`：公共账本、原 evidence 闭包、当前部署和升级预检。
- `scripts/historical-deployment-upgrade.mjs`：离线锁、重算、不可覆盖材料和原子切换。
- `tests/historical-deployment-integration.test.mjs`：承接反证与重试。
