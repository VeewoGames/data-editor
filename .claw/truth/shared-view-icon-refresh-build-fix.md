# 共享视图图标刷新构建卡在构建中：等待语义与按包 SVG 供应链收缩

status: accepted

## context

这条 truth 记录共享视图图标“刷新构建卡在构建中”问题已经修复后的稳定结论。它保留的是可复用的判断：刷新按钮为什么会长时间处于构建中、根因是什么、以及现在应该依赖哪条更小的构建供应链。

## fix truth

### 1. `handleRefreshBuild()` 一直等待 `/api/rebuild`，所以按钮显示“构建中”不天然代表死锁

前端 `handleRefreshBuild()` 会等待后端 `/api/rebuild` 完成后才恢复状态，因此刷新按钮长期显示“构建中”本身并不自动意味着 UI 死锁或前端卡住。

后续判断这类现象时，应先区分：

- 正常的长耗时构建等待
- 真实的构建供应链膨胀
- 仅仅是按钮状态还没回来

### 2. 根因是 vendor 全量 SVG 被 Vite build 扫进来了

共享视图图标接入后，`src/components/icons.ts` 使用 `import.meta.glob('../../vendor/**/**/*.svg?raw')`，把 vendor 全量 SVG 带进了 Vite build。

这会直接放大构建成本，具体表现为：

- `dist/assets` 一度膨胀到 `15709` 个文件，约 `20.44 MB`
- `runBuildCommand()` 约 `92s`
- 正式 `/api/rebuild` 约 `75s ~ 38s`

这条事实说明，卡在“构建中”的根因不是刷新按钮逻辑本身，而是 build 输入面过大。

### 3. 修复方案是把 generated 图标 SVG 供应链改成运行时按包拉取

新的正式链路是把图标 SVG 的供应链从“build 时扫描全部 vendor SVG”收缩成“运行时按包拉取”：

- 后端新增 `GET /api/shared-view-icon-pack?packId=...`，返回整包 raw SVG
- 前端 `src/components/icons.ts` 按包 fetch 后再注册图标组件
- Vite build 不再扫描 vendor 全量 SVG

这条改法的核心收益是把静态构建和图标资产展开解耦，避免每次 build 都背着整棵 vendor SVG 树跑。

### 4. 修复后构建和刷新耗时显著下降

修复后，稳定结果已经收敛为：

- `runBuildCommand()` 约 `20.8s`
- 正式 `/api/rebuild` 约 `27s`
- `dist/assets` 降到 `3` 个文件

这说明构建卡顿问题已经从根上被收缩，而不是靠延长超时或者掩盖等待状态解决。

### 5. 关键验证已通过

本轮关键验证已经通过：

- `tests/generated-streamline-registry.test.mjs`
- `tests/generated-tabler-registry.test.mjs`
- `icon picker shows built-in and streamline family groups`
- `icon favorites stay disabled in local mode and persist through selected profile reload`

这些验证说明运行时按包加载、生成 registry 和共享视图关键 e2e 都保持成立。

## related code / docs

- `src/App.tsx`
- `src/components/icons.ts`
- `server.mjs`
- `tests/generated-streamline-registry.test.mjs`
- `tests/generated-tabler-registry.test.mjs`
- `tests/data-editor.spec.ts`
- `.claw/truth/shared-view-icon-playwright-cold-start-fix.md`

## 关键检索词

`handleRefreshBuild`、`/api/rebuild`、`import.meta.glob('../../vendor/**/**/*.svg?raw')`、`GET /api/shared-view-icon-pack`、`dist/assets 15709`、`20.44 MB`、`runBuildCommand 92s`、`/api/rebuild 75s 38s`、`runBuildCommand 20.8s`、`/api/rebuild 27s`、`dist/assets 3`
