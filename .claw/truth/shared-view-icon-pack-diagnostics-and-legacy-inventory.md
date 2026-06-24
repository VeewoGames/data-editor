# 共享视图图标收口轮：pack 诊断状态与 Legacy inventory 分层

status: accepted

## context

这条 truth 记录共享视图图标收口轮中两个已经完成、且后续可复用的执行结果：一是 pack 管理诊断增强已经进入稳定 contract，二是 Legacy 治理准备已经先落到 inventory 与分类，不直接进入批量迁移或删除。

## execution truth

### 1. `ViewTabs` 的 pack 面板已经收敛出可解释的三类核心状态原因

`src/components/ViewTabs.tsx` 新增了 `resolveManagedPackSummary(...)`，pack 面板现在不只是显示加载状态，而是明确区分并展示三类核心状态原因：

- `未加载，命中时会先显示占位`
- `当前共享视图正在使用，暂不可卸载`
- `兼容池已加载，可继续浏览旧图标`

这条状态分层的意义是把“为什么现在能不能卸载、为什么命中后会看到什么”说清楚，后续 pack 管理诊断就不应再退回到只看一个布尔加载标志。

对应 contract 已由 `tests/view-state.test.mjs` 固定，后续如果再改 pack 面板展示逻辑，应先保持这三类原因的语义稳定。

### 2. Legacy inventory 已正式化为独立脚本和独立产物

Legacy 治理准备的第一步已经落成一个可重复的 inventory 流程：

- 脚本：`scripts/shared-view-icons/export-legacy-inventory.mjs`
- `package.json` 暴露命令：`npm run shared-view-icons:inventory-legacy`
- 产物：`artifacts/shared-view-icons/legacy-inventory.json`

这意味着 Legacy 的收口不再依赖手工盘点，而是有了可回溯的库存导出入口和持久化结果。

### 3. 当前 Legacy inventory 的分类边界已经清楚

本轮 inventory 的稳定结论是：

- legacy registry 共 `169` 个 icon
- `Base`：`16` 个
- `Legacy-only`：`153` 个

分类上，`candidateLegacyTightening` 当前只有这三个：

- `json`
- `tagsField`
- `refresh`

其余非 `Base` 项先进入 `candidateFormalSourceMigration`。

这条分层的可复用含义是：后续治理 Legacy 时，应该先沿着“可紧缩”与“需迁移到正式来源”两个篮子继续推进，而不是一开始就把所有非 Base 项混成同一种处理对象。

## related code / docs

- `src/components/ViewTabs.tsx`
- `tests/view-state.test.mjs`
- `scripts/shared-view-icons/export-legacy-inventory.mjs`
- `package.json`
- `artifacts/shared-view-icons/legacy-inventory.json`
- `.claw/truth/shared-view-icon-planning-execution-entry.md`

## 关键检索词

`resolveManagedPackSummary`、`未加载，命中时会先显示占位`、`当前共享视图正在使用，暂不可卸载`、`兼容池已加载，可继续浏览旧图标`、`tests/view-state.test.mjs`、`shared-view-icons:inventory-legacy`、`legacy-inventory.json`、`candidateLegacyTightening`、`candidateFormalSourceMigration`、`Base 16`、`Legacy-only 153`
