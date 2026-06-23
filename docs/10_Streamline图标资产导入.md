# Streamline 图标资产导入

## 概述

### 1. 总体目标和范围

本文档沉淀 `data-editor` 当前已经验证可用的 Streamline 图标导入链路，目标是把网页端图标稳定落盘为本地 `SVG` 资产，并批量生成运行时可消费的 registry。

本文档只描述当前仓库里已经存在且已验证的机制，包括：

- Streamline 图标清单 manifest
- 逐个详情页 DOM 提取 `SVG`
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
   - `run-streamline-svg-export-session.mjs`
   - 控制浏览器逐个提取详情页 SVG

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
图标详情页 URL -> 读取详情区 inline SVG -> 落盘为本地 .svg -> 从 manifest 生成 registry
```

原因是：

- 连续大量下载 `SVG` 会被官方阻断
- `SVG Copy` 会卡在 `COPYING...`
- 同页 `JSX Copy` 虽然可用，但不是我们要沉淀的主资产格式
- 页面详情区已经渲染出可直接提取的 SVG 真值

### 当前已验证的产物规模

截至本次沉淀，已完成两套 family 的全量导入：

- `micro-solid`: `1904/1904`
- `micro-line`: `2035/2035`

合计进入 registry 的图标数为 `3932`。

---

## 目录与关键文件

### 资产与中间产物

```text
artifacts/streamline-export/
  micro-solid-full.manifest.json
  micro-line-full.manifest.json
  shared-view-collision-report.json

vendor/streamline-svg/
  micro-solid/
  micro-line/
```

### 脚本入口

- `scripts/streamline-export/lib/manifest-store.mjs`
- `scripts/streamline-export/extract-streamline-svg-dom.mjs`
- `scripts/streamline-export/run-streamline-svg-export-session.mjs`
- `scripts/streamline-export/lib/chrome-session.mjs`
- `scripts/streamline-export/audit-streamline-collisions.mjs`
- `scripts/streamline-export/repair-streamline-manifest-collisions.mjs`
- `scripts/streamline-export/generate-shared-view-streamline-icons.mjs`

### 前端消费入口

- `src/generated/streamline-shared-view-icons.mjs`
- `src/generated/streamline-shared-view-icons.d.ts`
- `src/components/icons.ts`

---

## Manifest 结构约定

每个 manifest item 至少包含以下信息：

- `slug`
- `name`
- `iconUrl`
- `status`
- `attempts`
- `outputPath`
- `error`
- `extractedAt`

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

当前链路依赖真实 Chrome 登录态。推荐做法：

- 保留用户已登录的 Streamline 会话
- 自动化新开临时标签页执行
- 不要直接复用并关闭用户正在操作的现有标签页

原因：

- 可以继续使用已有登录态
- 不会打断用户手上的 Streamline 页面

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
- 搜索文本映射
- 分组信息

### 6. 构建与抽检

至少执行：

```powershell
node --test tests/streamline-export/manifest-store.test.mjs tests/streamline-export/extract-streamline-svg-dom.test.mjs tests/streamline-export/browser-runner.test.mjs tests/streamline-export/generate-shared-view-streamline-icons.test.mjs tests/streamline-export/audit-streamline-collisions.test.mjs
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

### 最终验证

```powershell
node --test tests/streamline-export/manifest-store.test.mjs tests/streamline-export/extract-streamline-svg-dom.test.mjs tests/streamline-export/browser-runner.test.mjs tests/streamline-export/generate-shared-view-streamline-icons.test.mjs tests/streamline-export/audit-streamline-collisions.test.mjs
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
- registry 图标数：`3932`
- `outputPathVariantCollisionGroups`: `0`

---

## 后续复用建议

如果后面还要接新的 Streamline family，按这个顺序做：

1. 准备该 family 的 manifest
2. 先跑小批量试采
3. 全量提取 SVG
4. 跑 `streamline:repair-collisions`
5. 补跑新增 pending
6. 跑 `streamline:sync-registry`
7. 跑测试与 build
8. 在 UI 里抽检 collision 组

这条顺序的关键点是：

- 不信官方批量下载
- 不依赖 `SVG Copy`
- 以 manifest 为唯一进度真相
- 以本地输出文件和 registry 结果为最终验收真相
