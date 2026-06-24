# 共享视图 Tabler 图标接入：tagged snapshot、generated registry 与受保护 pack 合同

status: accepted

## context

`shared view icon` 的 Phase A 已经把体系固定为 `metadata registry / runtime asset registry` 双层、`Base` 默认加载、其他 pack 会话态装载的合同。Tabler 接入不是另起一套图标机制，而是在这套合同上追加新的正式来源。

这轮需要长期沉淀的不是某次导入动作，而是 4 条会持续影响数据兼容、来源审计和 pack 管理的决策：

1. Tabler 正式来源必须可审计、可重建，并与仓库依赖版本保持单一锚点。
2. Tabler 正式全集不能继续由运行时 `@tabler/icons-react` 组件集合充当真相源。
3. shared view 配置归一化必须显式接受 Tabler generated icon ids，否则已保存图标在 reload 时会回退到 `borderAll`。
4. 当前共享视图结构正在使用的 icon pack 既不能被卸载，也不能处于“被引用但未装载”的状态。

## decision

### 1. Tabler 正式来源固定为官方 GitHub tagged snapshot，并与 `@tabler/icons-react` 版本对齐

Tabler 的正式来源固定为 Tabler 官方 GitHub tagged snapshot，而不是 npm 安装目录或运行时组件导出。

当前版本锚点固定为：

- `package.json` 中的 `@tabler/icons-react`
- 对应 tag `v3.44.0`

正式导入链路必须：

- 从 `https://github.com/tabler/tabler-icons` 的 tagged snapshot 读取
- 固定读取 `icons/filled` 与 `icons/outline`
- 把来源证据写入 `artifacts/tabler-import/source.json`

后续升级 Tabler 时，必须继续以“更新依赖版本锚点 + 更新 tagged snapshot”作为同一决策，不接受两套版本来源并存。

### 2. Tabler 真相源采用 vendored static SVG + generated registry

Tabler 正式供给链固定为：

- vendored 静态资产：`vendor/tabler-svg/filled`、`vendor/tabler-svg/outline`
- generated metadata truth：`src/generated/tabler-shared-view-icons.mjs`、`src/generated/tabler-shared-view-icons.d.ts`

`@tabler/icons-react` 可以继续作为部分运行时渲染桥接来源存在，但不能再承担：

- `Tabler S / Tabler L` 全集定义
- shared view icon metadata 真相源
- 正式 pack 分组定义

generated registry 必须继续对 basename 重复、generated id 重复、与现有 shared view icon id 冲突执行 fail fast，并把摘要写入 `artifacts/tabler-import/collision-report.json`。

### 3. shared view 配置归一化必须显式接受 `tablerSharedViewIconIds`

shared view 配置的 icon 归一化真相源必须显式包含：

- `"borderAll"`
- `streamlineSharedViewIconIds`
- `tablerSharedViewIconIds`
- 现有 legacy / base icon ids

这意味着 `src/view/shared-view-normalize.mjs` 与 `src/api/client.ts` 的 `SharedViewIconId` 范围都必须把 Tabler generated ids 当成正式合法值，而不是仅在运行时 registry 中临时可见。

如果缺少这条合同，已保存的 Tabler icon 会在 reload / normalize 后被判为非法值，并回退到 `borderAll`。这不是 UI 细节，而是 shared view 数据模型的持久化边界。

### 4. 被当前结构引用的 icon pack 必须自动装载，并在 pack 管理 UI 中显示为“已使用”

pack 管理的长期合同补齐为：

- 当前共享视图结构里正在使用的 pack 必须被自动装载
- 这类 pack 在管理 UI 中显示为“已使用”
- “已使用”状态必须禁用卸载操作

保护范围由当前共享视图结构反推出，不新增独立持久化字段。真实入口固定为：

- `src/App.tsx` 中的 `collectProtectedSharedViewIconPackIds(...)`
- `resolvedCollectionViews.topLevelItems`
- `src/components/ViewTabs.tsx` 中的 `protectedIconPackIds`

这条合同的目标不是做通用锁系统，而是保证“当前配置正在引用的图标”不会因为 pack 未装载或被卸载而在 reload 后退回 `borderAll` 或长期停留在 fallback。

## consequences

- Tabler 版本升级有唯一审计锚点，不会再出现“依赖版本”和“vendored 资产版本”漂移。
- shared view icon 的正式来源继续统一在 generated metadata 层，避免把运行时组件导出误当成数据真相源。
- 已保存的 Tabler icon 可以在 normalize / reload 后稳定保留，不会因 schema 未收口而回退成默认图标。
- pack 管理从“已加载即可卸载”收束为“被当前结构使用则自动装载且不可卸载”，避免用户把当前正在使用的图标包打回 fallback。

## related code

- `package.json`
- `scripts/tabler-export/import-tabler-tagged-snapshot.mjs`
- `scripts/tabler-export/generate-shared-view-tabler-icons.mjs`
- `vendor/tabler-svg/filled`
- `vendor/tabler-svg/outline`
- `artifacts/tabler-import/source.json`
- `artifacts/tabler-import/collision-report.json`
- `src/generated/tabler-shared-view-icons.mjs`
- `src/generated/tabler-shared-view-icons.d.ts`
- `src/api/client.ts`
- `src/view/shared-view-normalize.mjs`
- `src/App.tsx`
- `src/components/icons.ts`
- `src/components/ViewTabs.tsx`
- `tests/shared-view-normalize.test.mjs`
- `tests/view-state.test.mjs`
- `tests/data-editor.spec.ts`

## search terms

`@tabler/icons-react`、`v3.44.0`、`tablerSharedViewIconIds`、`borderAll`、`vendor/tabler-svg`、`tabler-shared-view-icons`、`source.json`、`collision-report.json`、`collectProtectedSharedViewIconPackIds`、`protectedIconPackIds`、`已使用`
