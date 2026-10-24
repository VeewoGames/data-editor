# 部署升级保留原证明并追加精确承接证书

status: accepted

## context

历史非重放回执绑定签发时的部署摘要；代码更新会导致漂移。直接刷新旧摘要破坏原证明意义，保留旧二进制则无法完成已授权交付。

## decision

采用工具交付侧 `managed-deployment-successor-v1` 承接证书，精确绑定原配置快照、policy、ledger 字节、receipt record/evidence 与目标 policy；固定部署配置是唯一选择入口。保留原件，公共 readLedger 无条件验证 pin，继续分别校验原 evidence 闭包与当前完整部署。

只提供显式离线 prepare/apply，采用 delivery → project 锁、静默发布及未覆盖义务预检、配置 CAS 与最终重算。不可覆盖材料先落盘，原子替换部署配置才生效。旧任务闭锁和未知业务结果保持原语义。

## alternatives considered

- 覆盖原 receipt 或刷新旧摘要：失去原始证明，拒绝。
- 自动信任当前值、缺证退化或空 ledger 旁路：可能重新放行历史任务，拒绝。
- 请求或项目选择承接材料：跨越工具交付 authority，拒绝。

## consequences

升级需要显式维护窗口及完整证据，新增未覆盖义务或漂移即停止；承接材料随工具部署保留。新任务合法准入不证明历史业务成功，也不自动批准业务启用。哈希检测漂移，不是抵御同账户写者的签名。

<!-- dated: 2026-10-24 -->
## implementation

已实施并完成隔离反证与正式部署验证，快照由 [部署承接 Truth](../historical-deployment-successor-and-verification-boundary.md) 维护。owner 为 `src/historical-deployment-successor.mjs`、`src/historical-disposition.mjs`、`scripts/historical-deployment-upgrade.mjs`。
