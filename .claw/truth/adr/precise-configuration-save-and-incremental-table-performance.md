# 精确配置保存与增量表格性能合同

<!-- document-state: accepted -->

## 背景

普通配置保存不能被误认为自动化业务写入，也不能借配置作者身份扩大权限。旧保存响应、滚动全量计算和同版本重复派生会同时影响浏览切换的正确性与延迟。

## 决策

配置准入绑定项目和具体配置类别解析出的精确物理目标；当前普通配置通过既有 configuration service 核验目标、版本和许可并复用原 writer 与配置锁，不扩大业务 authority。历史效果门的旧实现作为阶段证据保留在对应 Truth 的历史中。

三类客户端保存由一个协调器拥有加载基线及未完成尝试。现存目标必须先显式加载，不在保存时获取新版本覆盖旧草稿；begin/save 使用该基线。未知结果须以原尝试 reconcile 的终止证明核对；已写成功仅补必要名称登记，不重发 profile。冲突允许显式重载重新建立基线，自动重试不能采纳外部新版本。这将加载版本责任集中到客户端协调器，服务端仍是目标与许可核验 owner。实现为 `src/api/configuration-saves.mjs`、`src/api/client.ts` 和 `src/configuration-save-service.mjs`。

保存以捕获的 owner/scope epoch/revision 和独立快照确认完成；只允许同 owner 的当前 revision 清 dirty。切换等待所有必要保存终点，失败、blocked 或 deferred 保留原页面和草稿。网络强退不视为已确认保存。

表格布局层拥有增量行高索引、布局版本和 rowId 锚点；窗口查询不得每次遍历总行数。位置缓存只保留 dirty keys，flush 合并最新存储，沿用 localStorage 既有并发语义。同版本派生、关联索引和完整校验依赖由原 owner 管理，实质变化必须失效。独占解析对象可交唯一消费者，多消费者及保存基线继续隔离。

先消除已证实的重复工作。Worker、列虚拟化须由剩余浏览器证据决定，不能用 Node 计时、隐藏字段、裁剪完整校验或卸载编辑器代替验收；另行设计须闭合原交互合同。

## 备选方案

- 放宽普通业务 author scope、合成自动化 run 或关闭保护：扩大 authority，不能采用。
- 固定行高截断内容、仅延迟计算或先引入 Worker：不能解决已证实的重复工作或保留完整交互。
- 旧响应直接清 dirty、切换后补救保存：无法确认实际 owner 和版本。
- 保存前自动重取最新版本、放宽服务端校验或丢 ACK 后重发整份配置：可能覆盖他人修改、绕过许可或重复已成功效果，因此保留加载基线和原尝试核对。

## 影响

该选择增加了明确的版本/布局失效责任，换取可定位的正确性与计算边界。性能保证必须附固定环境和数据范围；通用产品不增加具体项目业务分支。受保护正式交付继续遵守[前向升级 ADR](./active-v2-forward-upgrade-and-read-effect-separation.md)。

<!-- state: history -->
## 决策演进

<!-- dated: 2026-10-27 -->
### generation 5 实施快照

配置准入由 `src/historical-disposition.mjs` 和三个配置 writer 实现，保存确认由 `src/App.tsx` 管理，行高与位置分别归 `src/table/variable-row-window.mjs`、`src/page-context-storage.ts`；同版本校验依赖复用位于 `src/validation/stable-inputs.mjs`。generation 5 已正式交付，验证范围与限制由[对应 Truth](../large-file-performance-and-configuration-autosave.md)维护。
