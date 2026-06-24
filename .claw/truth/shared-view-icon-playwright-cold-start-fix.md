# 共享视图图标 Playwright 冷启动修复：静态 webServer 链路与高位端口隔离

status: accepted

## context

这条 truth 记录共享视图图标 Playwright 冷启动链路已经修复后的稳定结论。核心价值不是复盘一次失败，而是固定后续 e2e 应该走哪条启动链路，以及为什么这条链路比直接起 Vite dev 更稳。

## fix truth

### 1. 默认 e2e 端口 `8787/8791` 会与当前正式服务冲突，不能拿来做真正隔离

复现已经证明，默认 e2e 端口 `8787/8791` 会撞上用户当前正式服务，因此 Playwright 的 `webServer` 不能靠这组默认端口实现有效隔离。

这意味着后续 e2e 不应再假设“默认端口 + dev 启动”就足以隔离测试环境，启动链必须显式改到独立端口和独立服务形态。

### 2. 高位独立端口下，`/api/health` 可通，但 Vite 首页链路会挂起

把 e2e 切到高位独立端口后，`server.mjs` 的 `/api/health` 可以正常返回，说明 API 层和服务进程本身可用。

但同一条链路下，Vite dev 根路径 `/`、`/index.html`、`/@vite/client`、`/src/main.tsx` 会挂起或最终 `socket hang up`。这说明 `page.goto('/')` 的阻塞点来自隔离环境里的 Vite 首页不可用，而不是共享视图图标业务逻辑回归。

### 3. 当前可行修复是切到静态构建链路

`playwright.config.ts` 已改为把 `webServer` 从 `dev.mjs` 切到静态构建链路：

- 先执行 `tests/fixtures/make-scratch-root.mjs`
- 再执行 `npm run build`
- 最后执行 `node server.mjs --project ./tests/.scratch --port 42173 --static dist --bridge-port 42175 --registry-home ./tests/.scratch/.data-editor/e2e-home`

对应的稳定配置要点是：

- 默认端口改为 `42173 / 42175`
- `webServer.timeout` 调整为 `180000`
- 由 `server.mjs` 直接服务 `dist` 静态产物，而不是再依赖 Vite dev 首页

这条链路是后续共享视图图标 Playwright e2e 的正式修复路径。

### 4. 关键 e2e 已在新链路上通过

在这条静态构建链路上，关键用例已经通过：

- `icon picker shows built-in and streamline family groups`
- `icon favorites stay disabled in local mode and persist through selected profile reload`

这说明修复点已经覆盖了共享视图图标的关键可见性与收藏持久化路径，当前问题不应再按业务逻辑回归处理。

## related code / docs

- `playwright.config.ts`
- `dev.mjs`
- `server.mjs`
- `tests/fixtures/make-scratch-root.mjs`
- `tests/data-editor.spec.ts`
- `.claw/truth/shared-view-icon-playwright-cold-start-planning-entry.md`
- `.claw/truth/shared-view-icon-final-closeout.md`

## 关键检索词

`8787/8791`、`42173/42175`、`make-scratch-root`、`npm run build`、`server.mjs --static dist`、`/api/health`、`socket hang up`、`page.goto('/')`、`icon picker shows built-in and streamline family groups`、`icon favorites stay disabled in local mode and persist through selected profile reload`
