# Streamline core-solid 非 Copy 导出方案

## 概述

### 1. 总体目标和范围

本文档只覆盖 `core-solid` 这一个 family，目标是在不再依赖网页端 `Copy SVG` / `Download SVG` 的前提下，继续推进全量 `SVG` 落盘，并保持 manifest、磁盘文件、后续 registry 生成三者可追踪一致。

本方案聚焦以下范围：

- `artifacts/streamline-export/core-solid-full.manifest.json`
- `artifacts/streamline-export/core-solid-full-items.json`
- `vendor/streamline-svg/core-solid/`
- `scripts/streamline-export/import-streamline-svg-from-mcp.mjs`
- `scripts/streamline-export/run-streamline-mcp-svg-session.mjs`
- `scripts/streamline-export/verify-streamline-svg.mjs`
- 后续 `core-solid` registry 生成、collision 审计与正式接入

不包含：

- 继续浏览器逐个 `Copy SVG`
- 继续网页端大量 `Download SVG`
- JSX 资产生成
- 对官方配额策略的规避

### 2. 各阶段任务概要

#### 阶段一：确认现状与执行前提

主要工作：

- 复核当前 manifest counts
- 复核已有本地 SVG 文件是否有效
- 确认是否具备 `STREAMLINE_API_KEY`

预期成果：

- 明确当前剩余工作量
- 明确是否满足批量导入前提

执行顺序：

1. 跑 `streamline:verify-svg:core-solid`
2. 检查 `STREAMLINE_API_KEY`
3. 记录当前 counts 与阻塞点

#### 阶段二：切换到 hash -> MCP/API -> svg 主路径

主要工作：

- 以 manifest 里的官方 `hash` 为主键
- 逐批调用 `get_icon_by_hash`
- 直接取返回的 `svg` 文本写入本地文件
- 同步回写 manifest success / failed

预期成果：

- pending 项持续下降
- 不再依赖浏览器 copy/download

执行顺序：

1. 小批量验证 5-20 个 item
2. 观察失败模式是否稳定
3. 再按批次放大

#### 阶段三：核对漂移并收敛失败模式

主要工作：

- 校验 manifest success 与本地文件一致
- 区分真实失败与前置条件缺失
- 明确记录可复用错误类型

预期成果：

- manifest、磁盘和错误模式保持一致

执行顺序：

1. 每批导入后跑 `streamline:verify-svg:core-solid`
2. 统计新增 `failed`
3. 对可恢复项决定是否重试

#### 阶段四：生成 registry 并完成正式接入

主要工作：

- 为当前 `core-solid` 成功子集生成 registry
- 跑 collision audit
- 清理 exact duplicate
- 正式并入共享视图 registry

预期成果：

- `artifacts/streamline-export/core-solid-preview-registry.mjs`
- `artifacts/streamline-export/core-solid-collision-report.json`
- `src/generated/streamline-shared-view-icons.mjs`
- `src/generated/streamline-shared-view-icons.d.ts`

执行顺序：

1. 生成 preview registry
2. 生成 collision report
3. 清理 exact duplicate
4. 正式重生主 registry

### 3. 整体结构框架

本方案分成四层：

1. **真相层**
   - `core-solid-full.manifest.json`
   - 记录每个图标的 `hash`、`status`、`outputPath`、`error`

2. **导入层**
   - `import-streamline-svg-from-mcp.mjs`
   - `run-streamline-mcp-svg-session.mjs`
   - 调用官方 MCP/API，按 `hash` 直接取 `svg`

3. **校验层**
   - `verify-streamline-svg.mjs`
   - 校验 manifest 与磁盘文件是否漂移

4. **消费层**
   - `generate-shared-view-streamline-icons.mjs`
   - 把成功落盘的图标编入 preview registry / 主 registry

---

## 当前结论

### 为什么不能再走 Copy

当前 `core-solid` 已经不是“某些图标 copy 偶发卡住”，而是整条浏览器导出链路已经不再适合作为主路径，理由有三点：

1. 网页端 `Copy SVG` 会停在 `COPYING...`
2. 网页端大量 `Download SVG` 会触发官方导出限制
3. 站点已经明确出现 `100% of your weekly downloads used` 提示

这说明浏览器端 copy/download 很可能共用同一套导出配额或风控面，继续投入自动化只会增加干扰，不会恢复批量吞吐。

### 当前仓库里的可用替代路线

仓库已经具备非浏览器批量导入入口：

- [import-streamline-svg-from-mcp.mjs](/C:/Code/data-editor/scripts/streamline-export/import-streamline-svg-from-mcp.mjs)
- [streamline-mcp-client.mjs](/C:/Code/data-editor/scripts/streamline-export/lib/streamline-mcp-client.mjs)

执行逻辑是：

```text
manifest item.hash
-> get_icon_by_hash
-> 返回 svg
-> 写入 vendor/streamline-svg/core-solid/*.svg
-> 回写 manifest success / failed
```

这条路线的优点：

- 不开大量标签页
- 不依赖剪贴板
- 不触发 `COPYING...` 卡死
- 可按 manifest 断点续跑

---

## 当前已确认状态

截至 `2026-06-24` 当前工作区实测状态：

- manifest 总量：`5603`
- `success`: `5603`
- `pending`: `0`
- `failed`: `0`
- 官方 `hash`：`5603/5603`
- 本地现存成功 SVG 文件：`5603`

`streamline:verify-svg:core-solid` 当前结论：

- `successMissingFiles = []`
- `successInvalidSvg = []`
- `successEmptyFiles = []`
- `pendingExistingFiles = []`
- `failedExistingFiles = []`

这说明：

- 已成功落盘的 `5603` 个文件当前是干净的
- 当前主要矛盾不是“已有文件损坏”
- 当前 `core-solid` 全量 SVG 已全部导入完成

补充说明：

- 当前批量 runner 切到 `--continue-on-failure` 后，单个失败项不会再提前终止整轮导入
- 已确认的新增瞬时失败模式包含 `TypeError: fetch failed`
- 当前新增的这类瞬时失败样本为 `initial-letter`，与既有 `forbidden` / `clipboard-svg-not-found` 属于不同簇
- `initial-letter` 已通过一次定向单项重试恢复成功，证明这类 `fetch failed` 至少部分属于可恢复瞬时网络抖动
- 当前主体批量导出已经完成，manifest 不再存在 `pending` 项
- 之前被标记为 `failed` 的 `38` 项，经过 `--retry-failed` 收口后已全部恢复成功
- 后续又清理了 `12` 组 exact duplicate，manifest 权威总量收敛为 `5603`
- 当前最终状态为 `success 5603 / pending 0 / failed 0`
- `core-solid` preview registry 与主 registry 已同步重生，当前不再只是 preview-only 状态

---

## 执行前提

当前批量主路径的唯一硬前提是：

```powershell
$env:STREAMLINE_API_KEY="<your_key>"
```

没有这个环境变量时，`streamline:import-mcp-svg` 无法真正执行。

因此当前阶段要区分两类状态：

### 可继续推进

- 文档更新
- manifest / verify / registry / collision 链路维护
- 本地测试与校验
- 小批量命令准备

### 无法跨越的外部前提

- 没有 `STREAMLINE_API_KEY` 时，无法继续把剩余 pending 真正导入为 SVG

---

## 标准命令

### 1. 先确认当前状态

```powershell
npm run streamline:verify-svg:core-solid
```

如果当前还没有 `STREAMLINE_API_KEY`，先跑 preflight：

```powershell
npm run streamline:import-mcp-svg:session -- artifacts/streamline-export/core-solid-full.manifest.json --preflight-only --pending-head 20
```

它会直接返回：

- 当前 `success / pending / failed`
- `hash` 覆盖情况
- pending 头部
- `verify-svg` 收口结果
- `blockers`
- 当前是否满足真正启动批量导入的前提

当前已额外确认两条限制：

- `core-solid-full-items.json` 只有 `hash / slug / name / imagePublicId / url ...` 这类字段，没有可直接消费的 `svgUrl`
- 未鉴权直接访问 `https://www.streamlinehq.com/icons/download/...` 当前会返回 `429`

因此在没有 `STREAMLINE_API_KEY` 的情况下，不存在一个已经验证可用的“直接从 items 清单推导公开 SVG 下载地址”的替代主路径。

如果需要排查“浏览器已登录态是否能替代 Public API key”，仓库现在提供两个只读诊断入口：

```powershell
npm run streamline:extract-browser-auth
npm run streamline:probe-browser-auth
```

含义：

- `extract-browser-auth`
  - 只读扫描 Chrome 的 Streamline IndexedDB
  - 判断是否存在 Firebase `apiKey / accessToken / refreshToken`

- `probe-browser-auth`
  - 在本机只读尝试用现有浏览器登录态请求下载页和 `public-api /mcp`
  - 当前实测结果仍然是 `429`

因此截至当前结论：

- Chrome 本地登录态是存在的
- 但它尚未证明可以替代 `STREAMLINE_API_KEY` 作为正式批量导入前提

### 2. 小批量试跑

```powershell
$env:STREAMLINE_API_KEY="<your_key>"
npm run streamline:import-mcp-svg -- artifacts/streamline-export/core-solid-full.manifest.json --max-items 10 --concurrency 1
```

建议先从 `--concurrency 1` 开始，先确认真实返回模式，再决定是否加到 `2` 或 `4`。

### 3. 按批次继续推进

```powershell
$env:STREAMLINE_API_KEY="<your_key>"
npm run streamline:import-mcp-svg -- artifacts/streamline-export/core-solid-full.manifest.json --max-items 100 --concurrency 2
```

### 4. 每批后立即校验

```powershell
npm run streamline:verify-svg:core-solid
```

如果希望把“按批导入 + 每批 verify 收口”合成一个入口，直接使用：

```powershell
$env:STREAMLINE_API_KEY="<your_key>"
npm run streamline:import-mcp-svg:session -- artifacts/streamline-export/core-solid-full.manifest.json --batch-size 100 --max-batches 5 --concurrency 2
```

默认行为：

- 每批导入后自动跑一次 `verify-svg`
- 遇到本批失败就停下
- 返回每批 `pendingBefore / pendingAfter / success / failed / verification`

### 5. 生成当前 preview registry

```powershell
npm run streamline:generate-registry:core-solid-preview
```

### 6. 审计 collision

```powershell
npm run streamline:audit-collisions:core-solid
```

---

## 失败模式约定

新的主路径下，失败原因应优先落在以下几类：

- `Missing official hash for <slug>`
- `Official MCP asset returned no svg for hash <hash>`
- `Error: MCP request failed: <status> <statusText>`
- 上游明确返回的业务错误文本

这类错误的意义分别是：

- `Missing official hash...`
  - manifest 准备问题
- `returned no svg...`
  - 上游接口能力不足，或该 asset 当前不返回 svg
- `MCP request failed...`
  - 网络、鉴权或上游服务问题

这比 `clipboard-svg-not-found` 更适合作为后续自动化重试和分流依据。

---

## 推荐执行口径

从现在开始，`core-solid` 的正式主口径应统一为：

```text
浏览器 copy/download 路线停止扩大投入
-> manifest 作为唯一进度真相
-> 以 hash -> MCP/API -> svg 作为批量导入主路径
-> verify-svg 作为每批后的收口校验
-> registry/collision 作为接入前验证
```

这条口径的核心价值是：

- 不再依赖会打扰用户的浏览器自动化
- 不再把剪贴板当成资产传输层
- 可以把“脚本准备完成”和“外部前提未满足”清晰分开

---

## 下一步

当前下一步只有两件事：

1. 提供可用的 `STREAMLINE_API_KEY`
2. 从 `--max-items 10 --concurrency 1` 开始做真实小样本导入

如果小样本成功，再继续批量推进剩余 `pending`。
