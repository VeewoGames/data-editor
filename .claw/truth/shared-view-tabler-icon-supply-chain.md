# 共享视图 Tabler 图标接入：tagged snapshot、生成器防碰撞与 pack 管理边界

status: accepted

## 结论

共享视图的 Tabler 来源已经从“运行时直接依赖 `@tabler/icons-react`”收束成一条固定供给链：

1. 版本锚点以 `package.json` 中的 `@tabler/icons-react` 为准，当前对齐到 `v3.44.0`。
2. 上游资产来源固定为 Tabler 官方 GitHub tagged snapshot，不从 npm 包内容或任意本地目录直接推导。
3. 本地真相源固定为 `vendor/tabler-svg/filled` 与 `vendor/tabler-svg/outline`，导入证据固定落到 `artifacts/tabler-import/source.json`。
4. 生成产物固定为 `src/generated/tabler-shared-view-icons.mjs` 与 `src/generated/tabler-shared-view-icons.d.ts`，碰撞报告固定落到 `artifacts/tabler-import/collision-report.json`。
5. 运行时 pack 固定扩展为 `tabler-filled` / `tabler-outline`，UI 标签固定为 `Tabler S` / `Tabler L`，并继续挂在既有 shared view icon 的 metadata/runtime 分层之上。

## 长期行为 / 规则

### 1. Tabler 资产必须从官方 tagged snapshot 导入

Tabler SVG 的正式导入入口是 `scripts/tabler-export/import-tabler-tagged-snapshot.mjs`。

这条链路的长期约束是：

- `defaultRepository` 固定为 `https://github.com/tabler/tabler-icons`
- `defaultTag` 当前固定为 `v3.44.0`
- 导入源目录固定读取 `icons/filled` 与 `icons/outline`
- 本地 vendor 真相源固定写入 `vendor/tabler-svg/filled` 与 `vendor/tabler-svg/outline`
- 导入后必须把来源证据写入 `artifacts/tabler-import/source.json`

`artifacts/tabler-import/source.json` 不是可有可无的临时日志，而是回答“这批 Tabler SVG 是从哪个官方 tag 导进来的”的长期证据。

### 2. Tabler 生成器必须 fail fast 拒绝三类碰撞

生成入口是 `scripts/tabler-export/generate-shared-view-tabler-icons.mjs`。

这条生成链路的长期 contract 是：

- 读取 `vendor/tabler-svg/filled` 与 `vendor/tabler-svg/outline`
- 生成 `src/generated/tabler-shared-view-icons.mjs`
- 生成 `src/generated/tabler-shared-view-icons.d.ts`
- 无论是否碰撞，都先写出 `artifacts/tabler-import/collision-report.json`

必须阻断的碰撞分三类：

1. 同 family 内 basename 重复
2. 生成后的 `tablerFilled*` / `tablerLine*` id 重复
3. 与现有 shared view icon id 冲突

第 3 类冲突的现有 id 来源不是抽象概念，而是两处真实锚点：

- `src/generated/streamline-shared-view-icons.mjs`
- `src/components/icons.ts` 里的 `sharedViewLegacyIconRegistry`

只要 `duplicateBasenames`、`duplicateGeneratedIds`、`collidingExistingIds` 任一非空，生成器就必须直接报错退出，不能把带冲突的 registry 当成可接受输出继续使用。

### 3. 运行时继续沿用 metadata / runtime registry 分层

Tabler 接入没有改写 shared view icon 的既有分层，而是在原架构上扩 pack：

- `src/generated/tabler-shared-view-icons.mjs` 只提供 metadata truth
- `src/components/icons.ts` 中的 `sharedViewIconMetadataRegistry` 负责把 Tabler metadata 并入统一搜索/分组面
- `src/components/icons.ts` 中的 `sharedViewIconRegistry` 继续只承载当前已加载的真实渲染组件

pack 归属继续通过 `outputPath` 推导：

- `/tabler-svg/filled/` -> `tabler-filled`
- `/tabler-svg/outline/` -> `tabler-outline`

对应 UI 标签固定为：

- `tabler-filled` -> `Tabler S`
- `tabler-outline` -> `Tabler L`

这意味着未来如果继续补 Tabler 相关搜索、分组或按包管理，应该扩现有 metadata/runtime 双层，不要回退到单一 eager registry。

### 4. ViewTabs 把 Tabler 纳入 managed packs，并对“正在使用的 pack”做最小保护

当前 pack 管理的 durable 行为不是“所有已加载包都可自由卸载”，而是多了一条最小保护：

- 如果某个 pack 正被当前共享视图结构里的任一 view icon 使用，则 pack row 不允许显示“卸载”
- 当前实现会显示“已使用”并禁用对应按钮

这条保护链路的真实入口是：

- `src/App.tsx` 中的 `collectProtectedSharedViewIconPackIds(...)`
- `resolvedCollectionViews.topLevelItems`
- `resolveSharedViewIconPackId(...)`
- `src/components/ViewTabs.tsx` 中的 `protectedIconPackIds`

`App` 会从 `resolvedCollectionViews.topLevelItems` 反推出当前结构正在使用的 pack，过滤掉 `base` 后传给 `ViewTabs`；`ViewTabs` 再决定 pack row 展示“加载 / 卸载 / 已使用”哪一种状态。

这条保护目前是最小保护，不是通用锁系统。它只关心“当前共享视图结构正在使用的 icon pack”，不额外引入新的持久化状态。

## 验证标准

本轮 focused 验证通过的命令固定为：

- `node --test tests/generated-tabler-registry.test.mjs tests/generated-streamline-registry.test.mjs tests/view-state.test.mjs`
- `npm run build`

当前已知验证边界：

- `npm run typecheck` 仍有 3 个 pre-existing unrelated errors
- 位置固定在 `src/components/filters/MultiSelectFilterPopover.tsx:114` 与 `src/table/DataTable.tsx:722,735`

后续如果只是在 Tabler 供给链、registry 生成或 pack 管理上做增量调整，这 3 个 typecheck 错误不应被误记为本链路新引入回归。

## 关联代码

- `package.json`
- `scripts/tabler-export/import-tabler-tagged-snapshot.mjs`
- `scripts/tabler-export/generate-shared-view-tabler-icons.mjs`
- `vendor/tabler-svg/filled`
- `vendor/tabler-svg/outline`
- `artifacts/tabler-import/source.json`
- `artifacts/tabler-import/collision-report.json`
- `src/generated/tabler-shared-view-icons.mjs`
- `src/generated/tabler-shared-view-icons.d.ts`
- `src/components/icons.ts`
- `src/components/ViewTabs.tsx`
- `src/App.tsx`
- `tests/generated-tabler-registry.test.mjs`
- `tests/generated-streamline-registry.test.mjs`
- `tests/view-state.test.mjs`

## 关键检索词

`@tabler/icons-react`、`v3.44.0`、`vendor/tabler-svg`、`import-tabler-tagged-snapshot`、`generate-shared-view-tabler-icons`、`collision-report.json`、`source.json`、`tabler-filled`、`tabler-outline`、`Tabler S`、`Tabler L`、`collectProtectedSharedViewIconPackIds`
