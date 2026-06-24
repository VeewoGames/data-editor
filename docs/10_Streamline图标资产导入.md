# Streamline 图标资产导入

## 概述

### 1. 总体目标和范围

本文档沉淀 `data-editor` 当前已经验证可用的 Streamline 图标导入链路，目标是把网页端图标稳定落盘为本地 `SVG` 资产，并批量生成运行时可消费的 registry。

需要额外说明的是：`SVG` 导入主链路当前可用，但“高频在线批量回填官方 tags”不再应被视为正式生产方案。虽然详情页内嵌 JSON 仍然能提供正确 tags，但真实站点会对高频脚本访问触发 `403 Forbidden` / Vercel 风控，因此该路径只能改造成低频、串行、拟人化的浏览器访问流程，不能继续按高并发抓取器组织执行。

本文档只描述当前仓库里已经存在且已验证的机制，包括：

- Streamline 图标清单 manifest
- 逐个详情页 DOM 提取 `SVG`
- 逐个详情页内嵌 JSON 提取官方 `tags`
- 从离线官方真值文件批量回填 `tags`
- 断点恢复与失败补跑
- slug collision 修复与稳定别名
- 从 manifest 批量生成共享视图图标 registry
- 最终校验与人工抽检

本文档不包含：

- Streamline 登录态获取
- 官方批量下载链路
- `svg -> jsx/tsx` 转换
- 第三方 npm 图标包发布

### 2. 各阶段任务概要

#### 阶段一：生成或准备 manifest

主要工作：

- 为目标 family 准备图标清单
- 把每个图标写成可追踪的 manifest item
- 约定输出目录、状态位、来源 URL 和唯一标识

预期成果：

- `artifacts/streamline-export/*.manifest.json`

执行顺序：

1. 准备图标列表
2. 生成 manifest
3. 确认输出目录和初始状态

#### 阶段二：逐个提取 SVG 并落盘

主要工作：

- 打开 Streamline 图标详情页
- 直接读取详情区当前图标的 inline SVG
- 写入本地 `.svg`
- 即时回写 manifest 状态

预期成果：

- `vendor/streamline-svg/<family>/*.svg`
- manifest 成功/失败状态

执行顺序：

1. 打开目标 family 页面
2. 遍历 pending 项
3. 进入图标详情 URL
4. 提取 `outerHTML`
5. 落盘并回写状态

#### 阶段二点五：补充官方 tags metadata

主要工作：

- 小样本验证时，可打开 Streamline 图标详情页
- 解析页面内嵌 `application/json` state 中的官方 `tags`
- 正式批量执行时，优先导入离线官方真值文件
- 若必须在线回填，只能复用已登录浏览器会话，按低频串行 human-mode 执行
- 即时回写 manifest metadata 状态

预期成果：

- manifest 中每个图标具备可用于搜索的 `tags` metadata

执行顺序：

1. 小样本验证时，复用已登录的 Chrome 会话
2. 进入图标详情 URL
3. 解析详情页内嵌 JSON state，确认真值结构
4. 正式批量执行时，优先准备离线官方 metadata 文件
5. 若离线源暂不可得，则切到低频 human-mode 浏览器串行回填
6. 通过 `hash` 优先、`slug` 兜底的规则回写 `tags` / `metadataStatus`

当前限制：

- 该阶段的数据解析逻辑已验证正确
- 但真实站点会对批量详情页访问触发风控封锁
- 因此这一步目前不能再按“全量在线批处理”组织执行
- 当前正式首选方案仍是“离线官方真值源导入”
- 当离线源缺失时，可使用仓库内的 human-mode 浏览器 runner 做低频串行回填
- 详情页高频抓取只保留为调试失败案例，不再作为执行入口

#### 阶段三：修复 collision 并补跑缺口

主要工作：

- 识别同 slug 但不同图标内容的变体 collision
- 为变体分配稳定 `itemId` / `sourceId`
- 重置缺失输出文件对应项为 `pending`
- 仅补跑缺口，不重跑全量

预期成果：

- 不同变体不再覆盖同一个 `.svg` 文件

执行顺序：

1. 审计 manifest collision
2. 修复 manifest
3. 仅补跑被重置的 pending 项

#### 阶段四：生成 registry 并验证

主要工作：

- 从 manifest 生成前端图标 registry
- 生成 collision 报告
- 跑定向测试和 build
- 做人工抽检

预期成果：

- `src/generated/streamline-shared-view-icons.mjs`
- `src/generated/streamline-shared-view-icons.d.ts`
- `artifacts/streamline-export/shared-view-collision-report.json`

执行顺序：

1. 生成 registry
2. 生成 collision 报告
3. 跑测试和构建
4. 在 UI 中抽检

### 3. 整体结构框架

当前链路分成四层：

1. **清单层**
   - `manifest-store.mjs`
   - 管理 manifest 创建、加载、状态回写、collision hydration

2. **提取层**
   - `extract-streamline-svg-dom.mjs`
   - `extract-streamline-detail-metadata.mjs`
   - `import-streamline-official-metadata.mjs`
   - `import-streamline-detail-source-metadata.mjs`
   - `sync-streamline-metadata-from-mcp.mjs`
   - `run-streamline-svg-export-session.mjs`
   - `run-streamline-metadata-session.mjs`
   - 控制浏览器逐个提取详情页 SVG、抽样验证详情页 tags，以及从离线官方真值文件或官方 MCP 回填 metadata

3. **修复层**
   - `audit-streamline-collisions.mjs`
   - `repair-streamline-manifest-collisions.mjs`
   - 识别并修复 slug / outputPath collision

4. **消费层**
   - `generate-shared-view-streamline-icons.mjs`
   - `src/components/icons.ts`
   - 负责把本地 SVG 资产接进前端运行时

---

## 当前已验证结论

### 真实可用的主路径

当前推荐路径不是官方批量下载，也不是 `SVG Copy`，而是：

```text
图标详情页 URL -> 读取详情区 inline SVG + 页面内嵌 JSON tags -> 回写 manifest -> 落盘为本地 .svg -> 从 manifest 生成 registry
```

原因是：

- 连续大量下载 `SVG` 会被官方阻断
- `SVG Copy` 会卡在 `COPYING...`，`core-solid` 不再应作为正式批量主路径
- 同页 `JSX Copy` 虽然可用，但不是我们要沉淀的主资产格式
- 页面详情区已经渲染出可直接提取的 SVG 真值

对于 `tags metadata`，当前结论要单独看：

- 详情页内嵌 `application/json` 的确是正确真值结构
- 但批量打开详情页会触发站点封锁
- 所以“详情页 JSON 作为 tags 真值结构”成立
- “在线详情页批量回填可以作为正式执行方案”不成立

关于替代来源的最新结论：

- Streamline 官方存在 Public API，入口文档为 `https://docs.streamlinehq.com/`
- API 通过 `x-api-key` 头鉴权，未带密钥时会返回 `401` 和 `Api secret key is required`
- 当前公开的 `Global search`、`Family search`、`Get all icons from a family`、`Get icon by hash` schema 只暴露 `hash`、`name`、`family/category/subcategory`、`imagePreviewUrl`、`isFree`、`colors` 等字段
- 当前公开文档没有提供 icon-level `tags` 字段
- 这意味着 Public API 是稳定的正式接入点，但按当前文档还不足以替代网页详情页的 `tags` 真值

当前仓库内已经落地的正式折中方案是：

- 保留详情页 JSON 解析器，作为官方 `tags` 真值结构校验工具
- manifest 开始保留官方 `hash`
- 可通过官方 API `GET /v1/families/{familyHash}/icons` 批量回填 `hash`
- 全量回填优先不直接打官网详情页，而是消费离线官方 metadata 文件
- 离线文件导入时按 `hash` 优先匹配，缺失 `hash` 时再降级到 `slug`
- 当前已实测的 REST 与 MCP 响应虽然都能稳定返回 `hash/webUrl/svg`，但在实际响应中仍未看到可直接消费的 icon-level `tags`
- 仓库现已提供直接调用官方 MCP `get_icon_by_hash` 的批处理 runner，但真实小样本结果仍是“无 tags 返回”
- 仓库现已把浏览器 metadata runner 扩展为 low-frequency human-mode，可在已登录会话中以串行、小批次、带随机抖动的方式补齐 tags
- 对 `core-solid`，真实网页导出还会受到 `weekly exports` 配额约束；当页面出现 `100% of your weekly downloads used` 弹窗时，不应继续把后续项记成普通导出失败
- 因此仓库内新增了两条正式兜底能力：
  - `import-streamline-item-hashes.mjs`：从 `core-solid-full-items.json` 这类官方清单回填 manifest `hash`
  - `import-streamline-svg-from-mcp.mjs`：预留 `get_icon_by_hash -> svg -> 本地文件 -> manifest success/failed` 的非浏览器 SVG 导入路线

### 当前已验证的产物规模

截至本次沉淀，已完成两套 family 的全量导入：

- `micro-solid`: `1904/1904`
- `micro-line`: `2035/2035`

当前三套 family 已全部进入主 registry，总图标数为 `9535`。

`core-solid` 当前已完成全量导入并正式接入主 registry：

- manifest 状态为 `success 5603 / failed 0 / pending 0`
- 去重后的权威总量为 `5603/5603`
- 网页导出被周配额卡住后，后续处理应优先切到 `API/MCP` 路线验证，而不是继续依赖 `SVG Copy`
- 当前已验证 `streamline:import-mcp-svg:session --continue-on-failure` 能在存在单个失败项时继续消化后续 pending
- 当前已识别的失败模式除 `forbidden`、`clipboard-svg-not-found` 外，还新增了瞬时网络簇 `TypeError: fetch failed`
- `initial-letter` 的单项定向重试已恢复成功，因此 `TypeError: fetch failed` 目前不应直接视为不可恢复失败
- 后续又通过 `--retry-failed` 收口了之前的 `38` 个失败项，说明它们也属于可恢复导入，不是永久缺失资源
- 再后续通过 `streamline:repair-collisions:core-solid` 清掉了 `12` 组 exact duplicate，解决了 “manifest 数量大于 registry 数量” 的长期漂移

---

## 目录与关键文件

### 资产与中间产物

```text
artifacts/streamline-export/
  core-solid-full.manifest.json
  core-solid-full-items.json
  micro-solid-full.manifest.json
  micro-line-full.manifest.json
  shared-view-collision-report.json

vendor/streamline-svg/
  core-solid/
  micro-solid/
  micro-line/
```

### 脚本入口

- `scripts/streamline-export/lib/manifest-store.mjs`
- `scripts/streamline-export/extract-streamline-svg-dom.mjs`
- `scripts/streamline-export/extract-streamline-detail-metadata.mjs`
- `scripts/streamline-export/import-streamline-official-metadata.mjs`
- `scripts/streamline-export/import-streamline-detail-source-metadata.mjs`
- `scripts/streamline-export/import-streamline-item-hashes.mjs`
- `scripts/streamline-export/import-streamline-svg-from-mcp.mjs`
- `scripts/streamline-export/hydrate-streamline-manifest-hashes.mjs`
- `scripts/streamline-export/sync-streamline-metadata-from-mcp.mjs`
- `scripts/streamline-export/run-streamline-svg-export-session.mjs`
- `scripts/streamline-export/run-streamline-metadata-session.mjs`
- `scripts/streamline-export/lib/chrome-session.mjs`
- `scripts/streamline-export/lib/streamline-metadata-manifest.mjs`
- `scripts/streamline-export/lib/streamline-mcp-client.mjs`
- `scripts/streamline-export/lib/streamline-official-metadata-source.mjs`
- `scripts/streamline-export/audit-streamline-collisions.mjs`
- `scripts/streamline-export/repair-streamline-manifest-collisions.mjs`
- `scripts/streamline-export/reset-streamline-manifest-items.mjs`
- `scripts/streamline-export/generate-shared-view-streamline-icons.mjs`

### 当前可直接执行的 core-solid 入口

- `npm run streamline:reset-manifest-items -- artifacts/streamline-export/core-solid-full.manifest.json --from-slug <slug> --only-status failed --error-contains <text> --contiguous --clear-attempts`
- `npm run streamline:import-item-hashes -- artifacts/streamline-export/core-solid-full.manifest.json artifacts/streamline-export/core-solid-full-items.json`
- `npm run streamline:import-mcp-svg -- artifacts/streamline-export/core-solid-full.manifest.json --max-items <n>`
- `npm run streamline:generate-registry:core-solid-preview`
- `npm run streamline:generate-registry`
- `npm run streamline:audit-collisions:core-solid`
- `npm run streamline:repair-collisions:core-solid`
- `npm run streamline:repair-collisions:core-solid:dry-run`
- `npm run streamline:verify-svg:core-solid`

说明：

- `streamline:repair-collisions:*` 是会改写 manifest 的修复入口
- 首次操作 `core-solid` 时，优先跑 `:dry-run` 版本确认影响面，再决定是否执行真正修复
- `streamline:verify-svg:*` 现在会额外报告 `successMissingFiles`、`pendingExistingFiles`、`failedExistingFiles` 等 manifest/磁盘漂移信号，适合在批量修复或切换导出方案后做状态核对

### 前端消费入口

- `src/generated/streamline-shared-view-icons.mjs`
- `src/generated/streamline-shared-view-icons.d.ts`
- `src/components/icons.ts`

---

## Manifest 结构约定

每个 manifest item 至少包含以下信息：

- `slug`
- `hash`
- `name`
- `iconUrl`
- `status`
- `attempts`
- `outputPath`
- `error`
- `extractedAt`
- `tags`
- `metadataStatus`
- `metadataError`
- `metadataUpdatedAt`

对于普通无冲突图标：

- `itemId` 等于 `slug`
- 输出文件名直接使用 `slug.svg`

对于同 slug 的变体 collision：

- `itemId` 使用 `<slug>--<sourceId>`
- `sourceId` 从 `iconUrl` 末尾数字解析
- 输出文件名使用 `<slug>-<sourceId>.svg`

例如：

```json
{
  "slug": "leaf",
  "itemId": "leaf--26423",
  "sourceId": "26423",
  "iconUrl": "https://www.streamlinehq.com/icons/download/leaf--26423",
  "outputPath": "vendor/streamline-svg/micro-line/leaf-26423.svg",
  "status": "success"
}
```

这样做的目的只有一个：避免不同变体静默覆盖同一个输出文件。

---

## 标准执行流程

### 1. 准备或更新 manifest

如果是首次导入，先准备目标 family 的 manifest。

如果是历史 manifest 接入新 collision 规则，先执行：

```powershell
npm run streamline:repair-collisions
```

这个命令会：

- 为变体项补齐 `itemId` / `sourceId`
- 把缺失新输出文件的变体项重置为 `pending`
- 保留已成功且文件存在的普通项

### 2. 连接已登录的 Chrome 会话

`SVG` 导出和详情页 tags 抽样验证依赖真实 Chrome 登录态。推荐做法：

- 保留用户已登录的 Streamline 会话
- 自动化新开临时标签页执行
- 不要直接复用并关闭用户正在操作的现有标签页

原因：

- 可以继续使用已有登录态
- 不会打断用户手上的 Streamline 页面

如果只是执行正式的离线 metadata 回填，则不需要浏览器会话。

### 2.5 批量补齐官方 hash

当 manifest 还没有官方 `hash` 时，可以先用授权 API 批量补齐：

```powershell
$env:STREAMLINE_API_KEY="<your_key>"
npm run streamline:hydrate-hashes -- artifacts/streamline-export/micro-solid-full.manifest.json fam_N4qLKacuxV5kMUq4
```

这一步会：

- 调用 `GET /v1/families/{familyHash}/icons`
- 按 `webUrl === iconUrl` 精确匹配 manifest item
- 将官方 `hash` 回写到 manifest

已验证结果：

- `micro-solid` family 官方返回总数 `2035`
- 当前 manifest 命中 `1904/1904`
- `hash` 成功补齐 `1904/1904`

注意：

- 这一步只解决官方主键补齐
- 目前实测的 REST 与 MCP `get_icon_by_hash` 响应仍未返回可直接消费的 `tags`
- 因此 tags 正式回填仍需要离线官方 metadata 文件或后续可用的官方 tags 接口

### 2.5.1 从外部采集的详情页源文本回填官方 tags

如果后续能在代理环境或其他可访问环境中导出一批详情页 HTML / `application/json` 源文本，可以直接使用桥接脚本：

```powershell
npm run streamline:import-detail-sources -- artifacts/streamline-export/micro-solid-full.manifest.json C:\path\to\captured-detail-sources.json
```

输入文件支持两种顶层结构：

- `[]`
- `{ "items": [] }`

每条记录至少需要：

```json
{
  "slug": "attachment-1",
  "iconUrl": "https://www.streamlinehq.com/icons/download/attachment-1--26582",
  "source": "<html or application/json text>"
}
```

脚本会：

- 复用现有 `parseStreamlineDetailMetadataRecord`
- 从源文本中解析 `data.tags`
- 按 `iconUrl` 精确匹配 manifest item
- 批量回写 `tags / metadataStatus / metadataError / metadataUpdatedAt`

这个桥接脚本的意义是：

- 不要求本机重新访问被封锁的网站
- 只要外部环境能拿到官方详情页源文本，就能在本地直接完成回填
- 与当前 manifest 批量写回、registry 搜索消费链路完全兼容

### 2.5.2 在外部可访问环境中批量抓取详情页源文本

仓库现在也提供了配套抓取器，用于在“能访问 Streamline 详情页”的环境中先生成离线源文件：

```powershell
npm run streamline:capture-detail-sources -- artifacts/streamline-export/micro-solid-full.manifest.json C:\path\to\captured-detail-sources.json --max-items 50 --concurrency 2
```

输出格式直接兼容上一节的 `streamline:import-detail-sources`。

截至 `2026-06-24` 的本机直连小样本验证结果：

- 取样 `attachment-1`、`binocular`
- 抓取器命令可以正常执行并落盘失败清单
- 当前失败状态是 `429 Too Many Requests`

这说明：

- 抓取器本身的输入/输出契约已可用
- 当前本机网络环境仍不适合作为正式全量采集面
- 后续应把该命令放到代理可用、限流更宽松的环境执行，再把产出的 JSON 带回本地导入

### 2.6 直接尝试官方 MCP tags 回填

如果想直接验证官方 MCP 当前是否已经返回 `tags`，可以执行：

```powershell
$env:STREAMLINE_API_KEY="<your_key>"
npm run streamline:sync-mcp-metadata -- artifacts/streamline-export/micro-solid-full.manifest.json --max-items 10 --concurrency 4
```

这一步会：

- 对 manifest 里已具备 `hash` 的图标逐个调用 MCP `get_icon_by_hash`
- 复用当前 manifest metadata 批量写回链路
- 如果 MCP 真正返回 `tags`，会直接回写 `tags/metadataStatus`
- 如果 MCP 没有返回 `tags`，会把该项标记为 `metadataStatus: failed` 并记录明确错误

截至 `2026-06-24` 的真实小样本验证结果：

- 临时 manifest 取样 `attachment-1`、`binocular` 两个 `micro-solid` 图标
- 两者都已具备官方 `hash`
- 运行 MCP runner 后结果为 `0/2 success`、`2/2 failed`
- 失败原因一致为：`Official MCP metadata returned no tags for hash ...`

因此当前结论不是“官方 MCP 不可用”，而是：

- 官方 MCP 已可稳定连接
- `get_icon_by_hash` 已可稳定返回基础 metadata
- 但当前真实响应仍不足以完成官方 tags 全量回填

### 3. 执行逐个 SVG 提取

核心入口是：

- `runStreamlineSvgExtractionFromNodeRepl`
- `runStreamlineSvgExtractionLoopFromNodeRepl`

它们的职责是：

- 只处理 manifest 中 `status !== success` 的项
- 逐个打开 `iconUrl`
- 从详情区 `[data-sentry-component="EditionPanelPreviewSection"] [role="img"] svg` 提取 `outerHTML`
- 写入 `outputPath`
- 成功则标记 `success`
- 失败则记录错误并累加 `attempts`

推荐批量补跑策略：

- 小批次循环
- `batchSize` 取 `10` 或 `25`
- 失败不阻断全量统计，但要看 manifest 状态决定是否继续

### 3.5 提取官方 tags metadata

当前官方 tags 的稳定真值源不是外层列表 DOM，而是详情页页面内嵌的：

- `script[type="application/json"]`
- `props.pageProps.initialState.streamlineApi.queries.getIconDetailsBySlugAndSubcategoryId(...)`

该查询的 `data.tags` 已实测包含官方标签数组，例如 `attachment-1` 会返回 `attachment / paperclip / clip / affix / attach ...`。

当前 metadata 链路职责：

- `extract-streamline-detail-metadata.mjs`
  - 遍历 manifest 中尚未成功的 metadata 项
  - 打开详情页 URL
  - 解析内嵌 JSON state
  - 回写 `tags`、`metadataStatus`、`metadataError`、`metadataUpdatedAt`

- `run-streamline-metadata-session.mjs`
  - 复用现有 Chrome browser session 形态
  - 保持 handoff tab 策略
  - 只负责会话编排，不做 metadata 解析本身

说明：

- `status` 继续表达 SVG 提取状态
- `metadataStatus` 只表达 tags metadata 状态
- 两条链路汇合点仍然是 manifest

### 4. 审计 collision

提取完成后执行：

```powershell
npm run streamline:audit-collisions
```

重点看两类指标：

- `duplicateSlugVariantCollisionGroups`
- `outputPathVariantCollisionGroups`

判定规则：

- `duplicateSlugVariantCollisionGroups > 0` 表示上游确实存在同 slug 变体
- `outputPathVariantCollisionGroups = 0` 才表示本地输出路径已经不再互相覆盖

### 5. 生成 registry

执行：

```powershell
npm run streamline:generate-registry
```

或直接执行：

```powershell
npm run streamline:sync-registry
```

`streamline:sync-registry` 等于：

1. 生成 registry
2. 生成 collision 报告

生成结果会包含：

- 运行时图标列表
- 图标 id 类型声明
- `tags` 数组
- 搜索文本映射
- 分组信息

### 6. 构建与抽检

至少执行：

```powershell
npm run test:streamline-export
npm run build
```

然后在 UI 中人工确认：

- 图标能正常显示
- collision 变体对应的是不同图标
- 搜索和分组能找到新图标

---

## 推荐命令顺序

### 全量修复 + 增量补跑

```powershell
npm run streamline:repair-collisions
```

然后在已登录 Chrome 会话中执行增量提取循环，只补 `pending` 项。

### 提取后生成 registry

```powershell
npm run streamline:sync-registry
```

在此之前，如只做小样本验证，可通过已登录的 Chrome browser session 执行 metadata 同步：

- `runStreamlineMetadataExtractionFromNodeRepl`
- 或直接调用 `runManifestMetadataExtraction({ manifestPath, tab })`

不要再把这一步当成高并发生产回填命令。真实高频批量执行已验证会触发 `403 Forbidden` / Vercel 风控。

### 在线 tags 回填的人类节奏模式

如果必须在线访问详情页取 tags，当前推荐只走已登录浏览器会话，并显式启用 human-mode：

```js
await runStreamlineMetadataExtractionLoopFromNodeRepl({
  manifestPath: "C:/Code/data-editor/artifacts/streamline-export/micro-solid-full.manifest.json",
  batchSize: 20,
  maxBatches: 1,
  reuseBrowser: true,
  stopOnFailure: true,
  retryFailed: true,
  humanMode: true,
  connectBrowser,
});
```

`humanMode: true` 的当前默认节奏是：

- `concurrency = 1`
- `waitMs = 1200`
- `postLoadJitterMs = 800`
- `preNavigationDelayMs = 900`
- `preNavigationJitterMs = 1400`
- `postItemDelayMs = 1500`
- `postItemJitterMs = 2500`

执行原则：

- 一次只跑小批次，不要持续长时间无人值守扫全量
- 必须复用真实已登录浏览器会话，不要新建纯脚本环境
- 站点一旦出现 `403` / `429`，立即停批，不要自动提频重试
- 每批结束后先看 manifest `success/failed/pending`，再决定是否继续下一批
- 这条链路的定位是“低频补录”，不是“官网可持续全量同步接口”

### 最终验证

```powershell
npm run test:streamline-export
npm run build
```

---

## Collision 处理原则

### 什么是无害重复

如果多条记录：

- `slug` 相同
- `iconUrl` 指向同一内容
- 最终 `outputPath` 也可以收敛到同一文件

这类属于上游重复，可以接受。

### 什么是真实冲突

如果多条记录：

- `slug` 相同
- `iconUrl` 不同
- SVG 内容对应不同图标

这类必须拆成不同本地文件和不同 registry id。

### 当前采用的策略

当前仓库采用的是稳定别名策略：

- 文件名后缀加 `sourceId`
- registry id 也带 `sourceId`
- UI 展示名保留原名，并在需要时追加 `(<sourceId>)`

这样做的优点是：

- 可重复生成
- 不依赖人工手写映射
- 不会因为后续重跑把别名改掉

---

## 失败补跑原则

### 什么时候只补跑缺口

以下情况不要重跑全量，只补 manifest 中的 `pending` 或 `failed`：

- 浏览器会话中断
- collision 修复后新增了带后缀的输出路径
- 少量图标写文件失败
- 单次批量执行超时

### 什么时候需要重新审计

以下情况先跑 collision 审计，再决定是否补跑：

- 新 family 首次接入
- manifest 结构升级
- 输出目录规则变更
- registry 生成结果和 manifest 数量不一致

---

## 人工抽检建议

每次导入完成后，至少抽检以下内容：

1. 同 slug 变体
   - 例如 `leaf`、`next`、`power-off` 这类 collision 组
   - 确认不同 `sourceId` 对应不同图形

2. 普通无冲突图标
   - 随机抽几个 line / solid 图标
   - 确认 SVG 文件不是空文件

3. 前端显示
   - 在图标选择 UI 中确认新图标能显示
   - 确认搜索词可以命中

---

## 当前验收基线

当前这套机制的最低验收标准是：

1. manifest 全量 `pending = 0`
2. `micro-solid` 和 `micro-line` 都达到全量成功
3. `outputPathVariantCollisionGroups = 0`
4. registry 生成成功
5. build 通过
6. UI 抽检确认可显示

本次实测基线为：

- `micro-solid`: `1904/1904`
- `micro-line`: `2035/2035`
- `micro-solid`: `1904/1904`
- `micro-line`: `2035/2035`
- `core-solid`: `5603/5603`
- registry 图标数：`9535`
- `outputPathVariantCollisionGroups`: `0`

关于 `tags metadata` 的额外现状：

- 本地解析与回写链路已验证可工作
- 并行批处理 runner 已完成实现并通过测试
- 高频在线回填在小规模推进后会被站点封锁
- 仓库现已补上 human-mode 串行 runner，用于低频、拟人化的小批次在线补录
- 浏览器本地 IndexedDB / Local Storage / 常见缓存层中暂未发现可复用的官方 tags payload
- Streamline 官方 Public API 已确认存在且稳定，但当前公开 schema 不提供 icon-level `tags`
- 因此当前不能把“高频脚本下 `metadata pending = 0`”作为现实验收目标
- 若采用 human-mode，则验收应按“单批次成功率 + 搜索命中抽检”逐步推进，而不是一次性全量完成

---

## 后续复用建议

如果后面还要接新的 Streamline family，按这个顺序做：

1. 准备该 family 的 manifest
2. 先跑小批量试采
3. 全量提取 SVG
4. 跑 `streamline:repair-collisions`
5. 补跑新增 pending
6. 如需在线补 tags，通过 Chrome browser session 的 human-mode 小批次同步 metadata
7. 跑 `streamline:sync-registry`
8. 跑测试与 build
9. 在 UI 里抽检 collision 组和 tags 搜索

这条顺序的关键点是：

- 不信官方批量下载
- 不依赖 `SVG Copy`
- 以 manifest 为唯一进度真相
- 以本地输出文件和 registry 结果为最终验收真相

关于 tags 的新增限制：

- 不要继续依赖在线详情页批量回填
- 详情页 JSON 仍是 tags 真值结构来源，但在线访问必须降到低频 human-mode
- 浏览器本地缓存目前不能当成正式 tags 真值源
- 官方 Public API 目前只能作为稳定图标元数据入口，不能直接承担 tags 回填
- 能离线导入时优先离线导入；不得已在线处理时，只能按小批次逐步补齐
