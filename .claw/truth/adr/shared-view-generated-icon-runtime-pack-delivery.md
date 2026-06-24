# 共享视图 generated 图标供应链：运行时按包拉取 raw SVG

status: accepted

## context

共享视图图标体系此前已经收敛为 `metadata registry / runtime asset registry` 两层，但 generated 图标的 SVG 真实装载方式仍然会长期影响 build 成本、刷新构建体验和运行时边界。

本轮复现确认，“刷新构建卡在构建中”不是前端按钮状态机本身失效，而是 shared view generated 图标把 vendor 全量 SVG 带进了 Vite build。修复前的稳定证据是：

- `src/components/icons.ts` 通过 `import.meta.glob('../../vendor/**/**/*.svg?raw')` 把 vendor SVG 扫入构建输入
- `dist/assets` 膨胀到 `15709` 个文件
- `runBuildCommand()` 约 `92s`
- 正式 `POST /api/rebuild` 约 `75s ~ 38s`

修复后证据收敛为：

- `dist/assets` 降到 `3` 个文件
- `runBuildCommand()` 约 `20.8s`
- 正式 `POST /api/rebuild` 约 `27s`

因此，这轮需要沉淀的不是一次性能观察，而是 generated 图标 SVG 供应链的正式交付合同。

## decision

### 1. generated 图标 SVG 不再通过 `import.meta.glob` 进入 Vite build

共享视图 generated 图标的 SVG 正式不再通过 `import.meta.glob(...svg?raw)` 进入前端 bundle，也不再让 Vite build 在构建期扫描 `vendor` 全量 SVG。

generated registry 继续只承载元数据真相源，例如：

- `id`
- `packId`
- `outputPath`
- `searchText`

它不再隐式绑定“构建时把所有 raw SVG 一起打进 bundle”这条旧交付方式。

### 2. 后端新增 `GET /api/shared-view-icon-pack?packId=...` 作为 pack 级原始 SVG 交付入口

shared view generated 图标的原始 SVG 正式改由后端按包提供：

- 路由：`GET /api/shared-view-icon-pack?packId=...`
- 返回值：该 `packId` 对应整包 SVG 的 `Record<string, string>` raw SVG map

`server.mjs` 负责：

- 把 `packId` 映射到正式 vendored pack root
- 递归读取 pack 内 `.svg`
- 以 `outputPath -> raw SVG text` 的形式返回

这条接口把“构建期资产展开”改成了“运行时按需取包”，并把 pack 边界固定在服务端协议上。

### 3. 前端 `src/components/icons.ts` 按包 fetch 后再注册图标组件

前端正式交付链路改为：

1. 继续从 generated registry 读取 icon metadata
2. 在 `loadSharedViewIconPack(packId)` 中调用 `fetch('/api/shared-view-icon-pack?packId=...')`
3. 取得 raw SVG map 后，用 `createStreamlineIcon(...)` 注册到 `sharedViewIconRegistry`

这意味着 shared view icon runtime registry 的长期 contract 是：

- 搜索、分组、pack 归属仍由 generated metadata 提供
- 可渲染组件只在 pack 被显式加载后进入 `sharedViewIconRegistry`
- build 产物不再承担 generated SVG 全量展开职责

### 4. 刷新构建问题的正式修法是收缩供应链，而不是延长等待

`handleRefreshBuild()` 继续等待 `POST /api/rebuild` 完成，这一点没有改变。正式改变的是 build 输入面：

- 不再让 shared view generated SVG 放大 Vite build
- 不通过增大前端超时或弱化等待语义掩盖构建膨胀

因此，后续再出现“构建中持续较久”时，默认先检查是否偏离这条 runtime pack delivery 合同，而不是先改按钮状态逻辑。

### 5. 未加载 generated 图标包时，不常驻逐图标元信息

对 generated 图标包，前端默认不在内存中常驻逐图标元信息；未加载时只保留包级标签、别名与加载状态。

逐图标 `id` 和 `searchText` 只在用户显式加载该包后，通过 `GET /api/shared-view-icon-pack-manifest?packId=...` 按需进入浏览器缓存，再由 `src/components/icons.ts` 写入运行时搜索与注册缓存。

这条边界意味着：

- `sharedViewGeneratedManifestEntry` 属于按包加载后的运行时事实，不是默认常驻的前端静态数据
- 未加载包不应被假设具备逐图标搜索、数量统计或命中展开能力
- 前端维护的默认状态只需要知道包是否可加载、是否已加载、以及该包的包级展示文案

### 6. 未加载 generated 图标包不渲染整页占位卡片

未加载图标包的默认展示收敛为包级空态和加载动作，不再渲染整页占位卡片。

如果当前实现没有引入服务端搜索接口，那么未加载 generated 图标包也不提供逐图标全局搜索、数量展示与收藏命中展开；搜索能力只保留在已加载包、最近、收藏与 legacy 这些轻量范围内。

这条决策把“没加载”与“可浏览但不可操作”的旧占位语义拆开，避免用户把整页占位误解为已经拥有可搜索的图标集合。

## alternatives considered

- 保留 `import.meta.glob('../../vendor/**/**/*.svg?raw')`：会继续把 vendored SVG 全量带进 Vite build，使刷新构建成本随资产树规模一起膨胀。
- 继续把 raw SVG 直接打进前端 bundle：会把 build 成本和 runtime pack 范围重新耦合，违背按包加载边界。
- 只通过放大超时或修改“构建中”文案处理：只能掩盖等待，不会收缩真实 build 输入面。

## related code

- `src/components/icons.ts`
- `src/components/ViewTabs.tsx`
- `server.mjs`
- `src/shared-view-icon-manifest.mjs`
- `src/generated/streamline-shared-view-icons.mjs`
- `src/generated/tabler-shared-view-icons.mjs`
- `tests/generated-streamline-registry.test.mjs`
- `tests/generated-tabler-registry.test.mjs`
- `tests/data-editor.spec.ts`
- `.claw/tasks/排查刷新构建卡在构建中/plan.json`
- `.claw/truth/shared-view-icon-refresh-build-fix.md`

## consequences

- shared view generated 图标的 build 成本与 vendored SVG 总量解耦，`/api/rebuild` 不再被全量 raw SVG 扫描主导。
- generated registry 与 runtime asset registry 的职责进一步收紧：前者负责 metadata，后者负责按包装载后的真实组件。
- pack 装载协议从本地构建细节上升为明确的前后端接口合同，后续新增 pack 或继续扩充 generated 图标时不应回到全量 `import.meta.glob`。
- 未加载包不再承担逐图标元信息常驻、整页占位卡片或全局搜索假象，前端只保留包级空态和加载动作。
- 若没有服务端搜索接口，未加载 generated 图标包的搜索能力必须继续收窄为已加载包、最近、收藏与 legacy 的轻量范围。
- 当前验证面已经覆盖 `tests/generated-streamline-registry.test.mjs`、`tests/generated-tabler-registry.test.mjs`，以及 `icon picker shows built-in and streamline family groups`、`icon favorites stay disabled in local mode and persist through selected profile reload` 两条关键 Playwright 用例。

## search terms

`import.meta.glob('../../vendor/**/**/*.svg?raw')`、`GET /api/shared-view-icon-pack`、`loadSharedViewIconPack`、`sharedViewIconRegistry`、`runBuildCommand()`、`/api/rebuild`、`dist/assets 15709`、`dist/assets 3`、`92s`、`20.8s`、`75s`、`38s`、`27s`
