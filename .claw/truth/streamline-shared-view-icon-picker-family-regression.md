# Streamline shared view icon picker family 标签消失的根因与恢复边界

status: accepted

## context

`shared-view` 的 icon picker family tabs 由生成产物 `src/generated/streamline-shared-view-icons.mjs` 驱动，不是直接从 manifest 或本地 SVG 目录现查现组出来的。

## root cause

- 用户看到的现象是 `Core S` 未出现，之前的 `micro` 标签也一起消失。
- 直接证据是 `src/generated/streamline-shared-view-icons.mjs` 一度退化为空 registry，`streamlineSharedViewIcons = []`。
- 在这个状态下，`sharedViewIconGroups` 只剩内置分组，`Line`、`Solid`、`Core S` 都不会出现在 picker。
- 这类回归的本质是 generated registry 产物失真，不是单个 family 的 manifest 条目缺失。
- 对应 family 的 manifest `success` 条目和本地 SVG 资产本身仍然正常，因此问题不在导出资产缺失，而在生成后的 registry 结果。

## recovery

- 正式修复方式是重新执行 `npm run streamline:generate-registry`。
- 修复后，generated registry 恢复为 `micro-solid + micro-line + core-solid` 三个 family。
- `core-solid` 分组标签名恢复为 `Core S`。

## phase A durable structure

- 共享视图图标收藏已经归属到 `UserViewProfile.favoriteSharedViewIconIds`，并且在 `src/view-profile.mjs`、`src/api/client.ts`、`src/App.tsx` 中接通了 `empty -> normalize -> save` 的持久化链路。
- 图标体系已经从单一 eager registry 拆成两层：`sharedViewIconMetadataRegistry` 负责图标元数据与 pack 归属，`sharedViewIconRegistry` 负责运行时已加载资产；对应的按需装载与卸载入口是 `loadSharedViewIconPack` 和 `unloadSharedViewIconPack`，主要落点在 `src/components/icons.ts`。
- Phase A 的 pack 真相源已经收敛为 `Base / Micro S / Core S / Micro L / Legacy`，其中 `Base` 默认加载，其余 pack 按需加载和卸载；当前运行时又在这条边界上追加了 `Tabler S / Tabler L` 两个 managed packs。
- 当前 picker 顶部分组已经是 `最近 / 收藏 / Micro S / Core S / Tabler S / Micro L / Tabler L / Legacy`，主入口仍然在 `src/components/ViewTabs.tsx`。
- 对于未加载的图标，运行时不再假设 registry 里一定有真实组件，而是通过 `readSharedViewIconComponent(...) ?? sharedViewFallbackIcon` 兜底；`sharedViewGeneratedIconSearchText` 继续作为搜索消费面的统一来源。
- 当前这条结构链路的 focused tests 已经覆盖 `tests/view-profile.test.mjs`、`tests/view-state.test.mjs` 和 `tests/generated-tabler-registry.test.mjs` 中的收藏字段、pack 元数据 contract 与 Tabler generated registry 非空约束。

## verification boundary

- `tests/generated-streamline-registry.test.mjs` 负责兜住这类回归：它断言 generated registry 不能为空，并且必须包含 `streamline-micro-solid`、`streamline-micro-line`、`streamline-core-solid` 和 `Core S`。
- `tests/data-editor.spec.ts` 的 e2e 断言 picker 中可见 `Solid`、`Line`、`Core S`，并且切入这些分组后能看到 `streamlineMicroSolidAccessibility`、`streamlineMicroLineAccessibility`、`streamlineCoreSolidApplyToAll`。
- `tests/streamline-export/generate-shared-view-streamline-icons.test.mjs` 继续覆盖生成器对 `Core S` 和 `streamlineCoreSolidApplyToAll` 的产物约束。
- `core-solid` 的保存后刷新不回退链路已经由现有 node tests 覆盖并通过；这条回归只影响 generated registry 和 picker 可见性，不改变已验证通过的持久化链路。

## phase A final verification

- Phase A 已完成并通过验证，验证面包括 `node --test tests/view-profile.test.mjs tests/view-state.test.mjs`、`npm run typecheck`、`npm run build`，以及两条 Playwright e2e：`icon picker shows built-in and streamline family groups`、`icon favorites stay disabled in local mode and persist through selected profile reload`。
- 这轮验证确认了 `sharedViewIconGroups`、`loadSharedViewIconPack` / `unloadSharedViewIconPack`、`favoriteSharedViewIconIds` 持久化链路、以及 local mode 下收藏禁用和 profile reload 后状态保持的一致性。
- 验证产物已落到 `artifacts/icon-pack-performance/phase-a-after.json`，可作为 Phase A 收口后的稳定结果快照。

## 收藏刷新与 pack 加载修复事实

- `src/App.tsx` 里的 `mutateSelectedViewProfile` 在克隆 `UserViewProfile` 时必须保留 `favoriteSharedViewIconIds`，否则后续任意 profile 更新都可能把收藏字段抹掉。
- 收藏点击不能只依赖 autosave 队列；`handleToggleFavoriteSharedViewIcon` 在拿到 `nextProfile` 后应立即走 `commitProfileSave`，否则用户快速刷新时可能来不及落盘。
- `src/api/client.ts` 的 `saveViewProfile` 请求需要带 `keepalive: true`，这是离开页面或刷新时尽量保住收藏写入的必要条件之一。
- 图标包“加载无效”不是前端按钮逻辑坏了，而是正式 `8787` 服务进程一度仍在运行旧版 `server.mjs`，当时没有 `/api/shared-view-icon-pack` 接口，请求会落到静态资源兜底并返回 `Static asset not found: api/shared-view-icon-pack`。
- 这类问题的正确处置不是改 picker 按钮，而是重新 build 并重启正式 `8787 / 8791` 服务到当前代码版本，再重新验证 pack 接口。
- 当前已验证 `GET /api/shared-view-icon-pack?packId=micro-solid` 会返回 `1914` 个 SVG 条目，说明 pack 加载面已经回到真实服务链路而不是静态兜底。
- 在真实 `8787` 服务下，Playwright 已验证 `Core S` 的 `streamlineCoreSolidApplyToAll` 从 `is-unloaded` 变为正常已加载，说明 pack 级加载/卸载边界与 picker 行为一致。

## related code

- `scripts/streamline-export/generate-shared-view-streamline-icons.mjs`
- `scripts/streamline-export/lib/streamline-family-entry-config.mjs`
- `src/generated/streamline-shared-view-icons.mjs`
- `src/components/icons.ts`
- `src/components/ViewTabs.tsx`
- `src/view-profile.mjs`
- `src/api/client.ts`
- `src/App.tsx`
- `server.mjs`
- `tests/view-profile.test.mjs`
- `tests/view-state.test.mjs`
- `tests/data-editor.spec.ts`
- `tests/generated-streamline-registry.test.mjs`
- `tests/streamline-export/generate-shared-view-streamline-icons.test.mjs`
- `artifacts/icon-pack-performance/phase-a-after.json`
