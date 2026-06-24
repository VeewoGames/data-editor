# 共享视图图标 Playwright e2e：隔离静态 webServer 链路

status: accepted

## context

共享视图图标关键 Playwright e2e 在默认隔离链路下曾长期卡在 `page.goto('/')`。这轮需要长期固定的不是某次排障过程，而是后续这组关键用例应该依赖什么启动形态、默认端口和就绪边界。

复现已经收敛出两条稳定事实：

1. 默认 e2e 隔离端口如果继续使用 `8787 / 8791`，会直接与用户正式服务冲突，无法形成真正隔离。
2. 即使把隔离端口抬到高位，隔离 Vite dev 链路下的 `/`、`/index.html`、`/@vite/client`、`/src/main.tsx` 仍会长时间挂起或最终 `socket hang up`；此时 `/api/health` 可通，只能证明 API server 存活，不能证明首屏可导航。

因此，这个问题的长期解法不是继续给隔离 Vite dev 追加等待或放大超时，而是改写共享视图图标关键 e2e 的正式启动合同。

## decision

### 1. 默认隔离端口固定为 `42173 / 42175`

共享视图图标 Playwright e2e 的默认隔离端口固定为：

- HTTP 服务端口：`42173`
- recovery bridge 端口：`42175`

这组端口的目标是与用户正式服务 `8787 / 8791` 明确隔离，避免 `webServer` 抢占真实工作端口。

### 2. 正式链路改为静态构建 webServer，不再依赖隔离 Vite dev

共享视图图标关键 e2e 的 `webServer` 正式改为：

1. 先执行 `tests/fixtures/make-scratch-root.mjs`
2. 再执行 `npm run build`
3. 最后执行 `node server.mjs --project ./tests/.scratch --port 42173 --static dist --bridge-port 42175 --registry-home ./tests/.scratch/.data-editor/e2e-home`

这意味着后续这组关键用例的正式隔离链路是“scratch root + build 产物 + `server.mjs --static dist`”，而不是“scratch root + Vite dev 首页”。

### 3. `webServer.timeout` 固定提升到 `180000`

既然正式链路已经包含 `make-scratch-root` 与 `npm run build`，`webServer.timeout` 必须与这条链路的真实启动成本匹配，当前 accepted 值固定为 `180000`。

这条超时调整是链路切换的配套 contract，不是为了掩盖隔离 Vite dev 冷启动问题。

### 4. 共享视图图标关键回归用例以新链路为正式验证入口

当前至少以下关键用例已经在新链路上通过，应视为这条 ADR 的最小验证入口：

- `icon picker shows built-in and streamline family groups`
- `icon favorites stay disabled in local mode and persist through selected profile reload`

后续如果这组用例再次卡在首页导航，默认先检查是否偏离本 ADR 的静态 webServer 合同，而不是先回头怀疑共享视图图标业务逻辑。

## alternatives considered

- 继续使用 `8787 / 8791` 作为默认隔离端口：会与正式服务冲突，不能形成可信隔离。
- 保留隔离 Vite dev 并继续追加 ready 等待：现有证据已经证明 API health 与 Vite 首屏 ready 不是同一层信号，继续在 dev 链路上补等待并不能把它变成稳定 contract。
- 单纯放大测试级 `goto` 超时：只能延后失败，不会改变首页链路本身挂起或 `socket hang up` 的事实。

## related code

- `playwright.config.ts`
- `tests/fixtures/make-scratch-root.mjs`
- `server.mjs`
- `dev.mjs`
- `tests/data-editor.spec.ts`
- `.claw/tasks/修复共享视图图标Playwright冷启动链路/plan.json`
- `.claw/truth/shared-view-icon-playwright-cold-start-fix.md`

## consequences

- 共享视图图标关键 e2e 与用户正式服务端口彻底解耦，避免测试链路污染日常工作环境。
- Playwright `webServer` 的 ready 语义从“API server 活着”收束为“静态首页可导航”，降低 `page.goto('/')` 冷启动假阳性。
- 后续这组关键用例的排障优先级更清晰：先检查静态构建链路、scratch root 和隔离端口，而不是反复回到隔离 Vite dev 首页。
- 共享视图图标业务逻辑验证与测试基础设施验证边界被明确拆开，避免把基础设施问题误判成产品回归。

## search terms

`42173`、`42175`、`8787`、`8791`、`Playwright webServer`、`make-scratch-root`、`npm run build`、`server.mjs --static dist`、`/@vite/client`、`socket hang up`、`page.goto('/')`、`icon picker shows built-in and streamline family groups`、`icon favorites stay disabled in local mode and persist through selected profile reload`
