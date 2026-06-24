# 共享视图图标最终收口：已完成执行、验证边界与真相源分工

status: accepted

## context

这条 truth 是共享视图图标收口轮的最终总入口。它不重复各子任务的细节，而是把这轮已经完成的执行、已经固定的验证边界、以及后续该优先查找的真相源统一收束起来，供后续继续检索和复用。

## final closeout truth

### 1. pack 诊断 contract 已落地并可复用

`src/components/ViewTabs.tsx` 已引入 `resolveManagedPackSummary(...)`，pack 面板的状态语义已经固定为三类核心原因：

- `未加载，命中时会先显示占位`
- `当前共享视图正在使用，暂不可卸载`
- `兼容池已加载，可继续浏览旧图标`

`tests/view-state.test.mjs` 已固定对应 contract。后续如果再看 pack 管理问题，应优先沿这条状态解释链路定位，而不是退回到单一加载布尔值。

### 2. 未加载 generated 图标包的前端元信息已收缩到按需加载边界

当前 shared view 对 generated 图标包的前端数据暴露已经收缩为“按需取 manifest，再按需进入搜索池”，而不是把逐图标元信息常驻进浏览器首包。

稳定行为是：

- `src/components/icons.ts` 不再把 `micro-solid`、`core-solid`、`micro-line`、`tabler-filled`、`tabler-outline` 这几类 generated 包的逐图标 id 与 `searchText` 静态打进浏览器 bundle。
- 浏览器通过 `loadSharedViewIconManifest()` 请求 `/api/shared-view-icon-pack-manifest`，再把 `id` 写入 `sharedViewIconIdsByPackId`、把 `searchText` 写入 `sharedViewGeneratedIconSearchText`。
- `src/components/ViewTabs.tsx` 的 `resolveActiveGroupIconIds()` 对未加载包直接返回空数组；当 `showPackLoadEmptyState` 为 `true` 时，只展示“`<包名> 未加载 + 加载按钮`”，不再展示逐图标占位元信息。
- `resolvePickerIconIds()` 在开启全局搜索时，只合并 `recent`、`favorite`、`legacy`，以及已加载 generated 包的图标 id；未加载 generated 包不会进入搜索池。

服务端边界也已经分开：

- `server.mjs` 通过 `src/shared-view-icon-manifest.mjs` 提供 `/api/shared-view-icon-pack-manifest`。
- `src/shared-view-icon-manifest.mjs` 静态导入 `src/generated/streamline-shared-view-icons.mjs` 与 `src/generated/tabler-shared-view-icons.mjs`。
- 因此，大型 generated registry 主要常驻在服务端，不在浏览器首包。

需要保留的例外是 legacy：

- `src/view/shared-view-normalize.mjs` 仍内置 `169` 个 canonical icon id。
- `src/components/icons.ts` 仍从这里推导 legacy 列表，所以 legacy 的 id 集合继续在前端常驻，但这不等同于 generated 大包元信息常驻。

可复用的结论是：当前架构已经实现“未加载 generated 图标包不把逐图标元信息打进前端”。如果未来要进一步追求前端零元信息，就必须接受未加载包无法做逐图标全局搜索、数量展示和收藏命中展开，除非再补一层服务端搜索或统计接口。

### 3. 性能复测已正式化，稳定真相源是 artifact

共享视图图标性能复测已经正式化为：

- 命令：`npm run profile:shared-view-icons`
- 脚本：`tests/perf/shared-view-icons-profile.mjs`
- 稳定产物：`artifacts/icon-pack-performance/shared-view-icons-closeout.json`

当前 scratch 产物已经确认了关键 timings 与 groupCounts，因此后续性能讨论应优先看 `shared-view-icons-closeout.json` 与 scratch 产物，而不是把终端输出或临时 dev 服务打印当成唯一证据。

### 4. Legacy 治理准备已正式化，先 inventory 再分层

Legacy 治理准备已经正式化为：

- 命令：`npm run shared-view-icons:inventory-legacy`
- 脚本：`scripts/shared-view-icons/export-legacy-inventory.mjs`
- 产物：`artifacts/shared-view-icons/legacy-inventory.json`

当前 inventory 结论保持为：

- legacy registry 共 `169` 个 icon
- `Base` 16 个
- `Legacy-only` 153 个
- `candidateLegacyTightening` 只有 `json`、`tagsField`、`refresh`
- 其余非 `Base` 项先进入 `candidateFormalSourceMigration`

这意味着 Legacy 在这一轮的正确姿势仍然是 inventory 与分类，不是直接大规模迁移或删除。

### 5. 验证结论已分清逻辑回归与环境波动

本轮已完成的稳定验证结论是：

- `node --test tests/view-state.test.mjs` 通过
- `npm run build` 通过

已知但不应被当成共享视图图标逻辑回归的事项是：

- `npm run typecheck` 仍受仓库中既有 3 个无关错误影响
- Playwright 的 `icon picker shows built-in and streamline family groups` 在隔离 dev 服务冷启动上卡在 `page.goto('/')`

后者应视为验证环境波动，而不是共享视图图标逻辑回归证据。

## related code / docs

- `src/components/ViewTabs.tsx`
- `tests/view-state.test.mjs`
- `tests/perf/shared-view-icons-profile.mjs`
- `package.json`
- `artifacts/icon-pack-performance/shared-view-icons-closeout.json`
- `scripts/shared-view-icons/export-legacy-inventory.mjs`
- `artifacts/shared-view-icons/legacy-inventory.json`
- `.claw/truth/shared-view-icon-planning-execution-entry.md`
- `.claw/truth/shared-view-icon-performance-closeout.md`
- `.claw/truth/shared-view-icon-pack-diagnostics-and-legacy-inventory.md`

## 关键检索词

`resolveManagedPackSummary`、`未加载，命中时会先显示占位`、`当前共享视图正在使用，暂不可卸载`、`兼容池已加载，可继续浏览旧图标`、`profile:shared-view-icons`、`shared-view-icons-closeout.json`、`shared-view-icons:inventory-legacy`、`legacy-inventory.json`、`candidateLegacyTightening`、`candidateFormalSourceMigration`、`page.goto('/')`、`icon picker shows built-in and streamline family groups`
