# 共享视图图标 Playwright 冷启动链路：planning 执行入口与边界收敛

status: accepted

## context

这条 truth 记录的是共享视图图标 Playwright 冷启动链路修复任务的 planning 入口结论。它的作用是先把问题边界收紧到启动链、就绪信号和导航等待策略，而不是重新打开共享视图图标业务逻辑本身。

## planning truth

### 1. 当前问题优先视为 Playwright dev 冷启动 / webServer 就绪信号不足

本轮默认判断是：当前卡点首先应视为 Playwright dev 冷启动链路或 `webServer` 就绪信号不足问题，而不是共享视图图标业务逻辑回归。

这意味着后续排查顺序应先看：

- dev 服务是否真的稳定 ready
- Playwright 配置是否正确等待服务可用
- 冷启动和导航之间是否存在过早跳转

而不是先回到 icon picker、pack、grouping 或视图业务逻辑去找回归。

### 2. 问题边界优先收敛在 `playwright.config.ts`、`dev.mjs`、`server.mjs` 与 `page.goto('/')` 等待策略

本轮的可操作边界固定为四个点：

- `playwright.config.ts`
- `dev.mjs`
- `server.mjs`
- 测试入口 `page.goto('/')` 的等待策略

后续修复应优先围绕这条启动链梳理：

- `playwright.config.ts` 是否给了正确的启动等待与超时语义
- `dev.mjs` 是否在 cold start 阶段正确暴露 ready 信号
- `server.mjs` 是否把真正可用状态和“进程已起来”区分开
- `page.goto('/')` 是否需要更稳妥的等待和重试策略

### 3. 本轮不重新打开共享视图图标业务逻辑，只修启动链与导航等待

本轮的修复目标只包含启动链和导航等待策略，不重开共享视图图标业务逻辑、不扩大到 pack contract、分类 contract 或图标体系本身。

可复用的边界是：

- 只修启动链
- 只修就绪判断
- 只修导航等待
- 不把这次问题当成 icon 业务回归入口

## related code / docs

- `playwright.config.ts`
- `dev.mjs`
- `server.mjs`
- `tests/data-editor.spec.ts`
- `.claw/truth/shared-view-icon-final-closeout.md`

## 关键检索词

`Playwright 冷启动`、`webServer`、`playwright.config.ts`、`dev.mjs`、`server.mjs`、`page.goto('/')`、`等待策略`、`ready 信号`、`共享视图图标业务逻辑回归`
