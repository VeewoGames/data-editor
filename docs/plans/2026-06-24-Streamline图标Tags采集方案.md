# Streamline 图标 Tags 采集方案

## 方案概述

### 1. 总体目标和范围

本方案用于把 Streamline 外层列表视图中可见的真实 `tags` 接入 `data-editor` 当前共享视图图标链路，让 icon picker 的搜索能够基于官方标签命中图标，而不是只依赖 `slug`、`name`、`itemId` 和手工分组别名。

本次目标如下：

- 保留当前已经验证稳定的“详情页 DOM 直提 SVG”主链路
- 新增一条“外层列表补充元数据”的辅助链路
- 把每个图标的 `tags` 持久化到 manifest
- 让 registry 生成阶段把 `tags` 纳入搜索索引
- 为历史 manifest 提供可重跑的补全机制

本次范围包括：

- Streamline 列表页 `tags` 采集策略
- manifest 结构扩展
- registry 搜索索引扩展
- 增量补全和验证流程

本次不包含：

- 重写现有 SVG 提取链路
- 依赖详情页 `Description` 猜测 tags
- 手工维护大规模离线 tags 映射表
- icon picker 的 UI 视觉改版

### 2. 各阶段任务概要

#### 阶段一：数据源和字段模型收敛

主要工作：

- 明确 `tags` 真相来源是 Streamline 外层列表/编辑页，而不是下载详情页
- 确定 manifest 新字段和匹配键
- 收敛失败重跑与历史 manifest 升级策略

预期成果：

- 统一的数据源边界
- 可执行的 manifest 扩展方案

执行顺序：

1. 先确认页面真值来源
2. 再确认字段模型
3. 最后定义回写规则

#### 阶段二：列表页元数据采集

主要工作：

- 新增脚本在外层列表页读取图标卡片或编辑面板中的 `tags`
- 把 `name`、`tags`、`iconUrl`、`sourceId` 一起组织成可回写记录
- 支持分页、懒加载和增量重跑

预期成果：

- 一条独立于 SVG 提取的 tags 采集链

执行顺序：

1. 定位列表页稳定 DOM
2. 抽取卡片元数据
3. 与 manifest 对齐回写

#### 阶段三：manifest 与 registry 接入

主要工作：

- 在 manifest 中持久化 `tags`
- 在 registry 生成阶段输出 `tags`
- 将 `tags` 合并进 `searchText`

预期成果：

- icon picker 搜索可直接命中 Streamline 官方 tags

执行顺序：

1. 先扩展 manifest
2. 再扩展 generator
3. 最后验证前端搜索

#### 阶段四：历史数据补全与验证

主要工作：

- 对现有 `micro-solid` 和 `micro-line` manifest 批量补 tags
- 跑定向测试
- 在 UI 中抽检若干标签词的实际命中结果

预期成果：

- 历史图标池获得完整 tags 搜索能力

执行顺序：

1. 先补 manifest
2. 再重建 registry
3. 最后做命中抽检

### 3. 整体结构框架

本方案把 Streamline 图标数据链路拆成五层：

1. 列表元数据层
   - 从 Streamline 外层列表/编辑页抓取 `tags`、`name`
2. manifest 持久化层
   - 把采集结果按 `itemId` / `iconUrl` 回写到本地 manifest
3. 详情页 SVG 提取层
   - 继续负责本地 `.svg` 资产导出
4. registry 生成层
   - 把 `tags` 和原有字段一起写入生成产物
5. 前端搜索消费层
   - 用 `searchText` 和显式 `tags` 字段做运行时匹配

核心边界如下：

- `SVG` 真相仍在详情页预览区
- `tags` 真相在外层列表/编辑页
- 两条链路职责分离，但最终在 manifest 汇合
- manifest 是本地唯一持久化真相

## 当前事实与问题定义

### 1. 已确认的仓库现状

当前 Streamline 导入链路已经分成两部分：

- `manifest-store.mjs` 负责 manifest 的创建、加载和状态回写
- `extract-streamline-svg-dom.mjs` 负责详情页 DOM 提取 SVG
- `generate-shared-view-streamline-icons.mjs` 负责从 manifest 生成 registry

其中搜索文本目前由以下字段直接拼接：

- `family`
- `item.slug`
- `displayName`
- `item.itemId`
- `sourceId`

这意味着：

- 现在并没有官方 `tags` 进入搜索索引
- 搜索命中高度依赖英文 slug 和名称
- 列表页看得到的标签语义没有进入本地资产链

### 2. 已确认的页面真值

基于本轮确认，`tags` 的真实来源不是下载详情页，而是 Streamline 外层列表/编辑页中的图标信息面板。

也就是说：

- 详情页适合提取 `SVG`
- 外层列表/编辑页适合提取 `tags`

如果继续从详情页 `Description` 或 `style` 词推断 tags，会出现两个问题：

- 数据并不等价于官方 `tags`
- 命中词会混入描述性噪音，偏离用户在 Streamline 里实际看到的标签词

所以本方案明确拒绝“从描述猜 tags”的做法。

## 设计原则

### 1. 真实来源优先

哪个页面承载哪类真值，就从哪个页面抓。`SVG` 和 `tags` 不要求同源页面，只要求最终映射到同一个 manifest item。

### 2. 不破坏已验证主链

当前“详情页 DOM 直提 SVG”已经有文档、有测试、有历史产物。tags 能力应作为附加元数据链路接入，而不是推翻现有主链。

### 3. manifest 单一真相

不引入额外长期并行的 `itemId -> tags` 离线补丁文件。所有最终搜索元数据都应该回写到 manifest，再由 manifest 生成 registry。

### 4. 增量重跑优先

历史 manifest 规模已经较大，tags 补全必须支持增量重跑，避免每次都重走全部 SVG 导出流程。

### 5. collision 安全优先

同 `slug` 变体已经在现有链路中被证明真实存在，所以 tags 回写和搜索索引都不能仅靠 `slug` 对齐。

## 推荐方案

推荐采用“列表页补 tags + manifest 汇总 + generator 扩展”的三段式方案。

### 1. 新增列表页 tags 采集脚本

建议新增脚本：

- `scripts/streamline-export/extract-streamline-list-metadata.mjs`

职责：

- 打开 Streamline 外层列表或编辑页
- 遍历可见图标卡片
- 在卡片或侧边信息区提取：
  - `name`
  - `tags`
  - `iconUrl`
  - `sourceId`
  - `slug`
- 将结果组织成可回写的元数据记录

这个脚本不负责导出 `SVG`，只负责补充元数据。

### 2. 列表页入口契约

为了避免脚本依赖“人工当前正好停留在某个页面”的脆弱前提，第一版必须先明确列表页入口契约。

建议约定如下：

- 每个 manifest family 都有一个显式的起始页面配置
- 脚本启动时先按 family 打开对应入口，再开始滚动采集
- 入口配置与 manifest 路径一一对应，而不是依赖临时 UI 状态

建议新增一个静态配置，例如：

```ts
const streamlineFamilyEntryConfig = {
  "micro-solid": {
    family: "micro-solid",
    entryUrl: "<待实现时填入真实列表页 URL>",
  },
  "micro-line": {
    family: "micro-line",
    entryUrl: "<待实现时填入真实列表页 URL>",
  },
};
```

第一版要求：

- `extract-streamline-list-metadata.mjs` 必须接收 `manifestPath + family`
- family 到入口 URL 的映射必须是脚本内可见配置
- 如果入口缺失，脚本直接失败，不进入采集

这样可以保证后续实现是“可重跑的自动化流程”，而不是“半人工接管当前浏览器状态”。

### 3. 扩展 manifest 字段

建议为每个 manifest item 新增以下字段：

- `tags: string[]`
- `metadataUpdatedAt?: string`
- `metadataStatus?: "pending" | "success" | "failed"`
- `metadataError?: string | null`

其中最小必需字段是：

- `tags`

其余字段用于支持独立重跑和故障定位。

### 4. 采用双状态模型

当前 manifest 的 `status` 只表达 SVG 导出状态。为了避免把 tags 采集和 SVG 导出绑死在一起，建议引入独立元数据状态：

- `status` 继续表示 SVG 导出状态
- `metadataStatus` 表示 tags 元数据采集状态

这样可以实现：

- SVG 已成功但 tags 仍待补全
- tags 采集失败时不影响已有 SVG 资产
- 后续只重跑 metadata，而不是整条导出链

迁移策略应明确如下：

- manifest 读取层统一做字段归一化
- 缺失 `tags` 时默认视为 `[]`
- 缺失 `metadataStatus` 时默认视为 `pending`
- 这些缺省规则应放进 manifest helper，而不是散落在调用方分支中

### 5. 回写匹配规则

manifest 回写建议采用以下优先级：

1. `iconUrl`
2. `itemId`
3. `slug + sourceId`

不建议只用 `slug`，原因是：

- 现有 collision 机制已经证明同 slug 会对应多个真实图标
- 只用 `slug` 可能把 tags 写到错误变体上

采集记录的最小可回写字段契约建议定义为：

- `name`
- `tags`
- `iconUrl`
- `sourceId`

其中：

- `iconUrl` 是首选匹配键，也是采集去重主键
- `sourceId` 必须可由 `iconUrl` 或显式字段稳定解析得到
- 如果某条记录拿不到 `iconUrl`，该条应直接记为 `metadataFailed`，而不是退化成模糊 `slug` 匹配

### 6. generator 搜索索引扩展

在 `generate-shared-view-streamline-icons.mjs` 中，为每个 icon 输出：

- `tags`
- 扩展后的 `searchText`

新的 `searchText` 建议组成如下：

- `family`
- `item.slug`
- `displayName`
- `item.itemId`
- `sourceId`
- `tags.join(" ")`

这样可以兼顾：

- 老的 slug/name 搜索路径
- 新的官方 tags 搜索路径
- 保持第一版搜索语义只围绕官方 tags，不额外引入派生词噪音

### 7. `style` 的处理边界

第一版不建议把 `style` 作为 manifest 正式字段或搜索字段接入。

原因：

- 用户当前明确要的是官方 `tags`
- `style` 是另一套独立语义，容易把方案从“真 tags 接入”扩成“混合派生词索引”
- 当前 family 本身已经通过 `micro-solid` / `micro-line` 区分风格，第一版没有必要再把 style 重复塞进搜索索引

如果后续确实需要支持 style 搜索，应作为二期单独评估，而不是混入本轮主方案。

## 数据结构建议

### Manifest item 建议结构

```json
{
  "itemId": "attachment",
  "slug": "attachment",
  "sourceId": "26409",
  "name": "Attachment",
  "iconUrl": "https://www.streamlinehq.com/icons/download/attachment--26409",
  "status": "success",
  "attempts": 1,
  "outputPath": "vendor/streamline-svg/micro-solid/attachment.svg",
  "error": null,
  "extractedAt": "2026-06-24T08:00:00.000Z",
  "tags": ["attachment", "paperclip", "clip", "affix", "attach"],
  "metadataStatus": "success",
  "metadataError": null,
  "metadataUpdatedAt": "2026-06-24T08:10:00.000Z"
}
```

### Registry item 建议结构

```ts
type StreamlineSharedViewIconMeta = {
  id: StreamlineSharedViewIconId;
  family: string;
  itemId: string;
  slug: string;
  sourceId: string | null;
  name: string;
  outputPath: string;
  tags: string[];
  searchText: string;
};
```

## 采集流程设计

### 1. 列表页采集路径

建议流程如下：

1. 按 family 配置打开目标列表/编辑页入口 URL
2. 确保列表已加载足够多图标
3. 遍历可见卡片
4. 点击卡片或聚焦卡片
5. 从信息区读取 `name/tags`
6. 从卡片或链接中读取 `iconUrl`
7. 解析 `sourceId`
8. 回写 manifest

### 2. 懒加载与分页策略

由于 Streamline 列表很可能存在虚拟滚动或懒加载，建议：

- 以“滚动一屏 -> 采集当前可见项 -> 去重 -> 继续滚动”的模式处理
- 用 `iconUrl` 作为去重主键
- 当连续若干轮没有新增项时停止

这样比一次性依赖 DOM 全量渲染更稳。

### 3. 幂等策略

脚本应满足以下幂等要求：

- 若 `metadataStatus === success` 且 `tags.length > 0`，默认跳过
- 支持 `--force` 强制重采
- 只更新本次实际抓到的字段，不覆盖已存在但本次未抓到的有效值为空数组

## 最小实施切片

为了避免一开始就把 `micro-solid` / `micro-line` 全量铺开，建议先用一个最小切片验证链路：

1. 固定一个 family 入口
2. 只采集前 20 个图标
3. 把 `tags` 回写到临时 manifest
4. 跑 generator
5. 在 icon picker 中验证 `tags-only` 搜索命中

这个切片通过后，再扩展到全量 family。

## 测试与验证

### 1. 单元测试

至少新增以下测试：

- manifest create/load/save 能保留 `tags`
- generator 会把 `tags` 输出到 runtime 和 d.ts
- `searchText` 中包含 `tags`
- collision 场景下不同 `itemId` 的 tags 不串写

### 2. 端到端抽检

建议抽检以下场景：

- 搜一个只存在于官方 `tags`、不在 `slug` / `name` / `itemId` 中的词，确认新增命中
- 搜一个原本只靠 `slug` 就能命中的词，确认命中结果不退化
- 对同 slug 多变体图标做抽样，确认 tags 没有串写

验收时应避免只拿 `attachment / paperclip / attach` 这类可能同时出现在名称和 slug 中的词作为唯一证据，因为那不足以证明“新增命中来自 tags”。

### 3. 回归边界

需要确认以下能力不受影响：

- 现有 SVG 导出成功率
- collision 修复结果
- registry 生成数量
- icon picker 分组浏览

## 风险与应对

### 1. 列表页 DOM 不稳定

风险：

- Streamline 外层列表和信息区选择器可能比详情页更容易变

应对：

- 把 DOM 查询逻辑集中在单独 helper 中
- 允许脚本输出结构化诊断信息
- 优先依赖稳定文本区域和链接属性，而不是脆弱层级路径

### 2. 图标列表存在虚拟滚动

风险：

- 一次性 query 全部卡片可能拿不全

应对：

- 使用滚动采集 + 去重，而不是假设 DOM 中永远有全量节点

### 3. 变体映射错误

风险：

- 同 slug 不同变体可能拿错 tags

应对：

- 回写优先使用 `iconUrl`
- 其次使用 `itemId`
- 明确禁止仅靠 `slug`

### 4. 历史 manifest 结构升级成本

风险：

- 现有脚本和测试默认没有 `tags`

应对：

- 所有读取逻辑默认把 `tags` 视为空数组
- 所有读取逻辑默认把缺失的 `metadataStatus` 视为 `pending`
- 通过一次性结构升级和测试补齐消除迁移期分叉

### 5. 现有 collision 审计与 tags 一致性

风险：

- 同 slug 多变体在补 metadata 后可能出现 tags 串写，但现有 audit 只关注输出文件 collision

应对：

- tags 采集不改变现有 collision 审计逻辑
- 在 collision report 对应样本中增加人工抽样复核
- 至少确认若干同 slug 多变体项的 tags 仍与各自 `iconUrl` 对齐

## 实施建议

建议按以下顺序实施：

1. 先扩展 manifest 数据结构与测试
2. 再补列表页入口契约配置
3. 再实现列表页元数据采集脚本
4. 先跑单 family 小样本切片
5. 再把 `tags` 接进 generator
6. 最后对 `micro-solid` 和 `micro-line` 全量补 tags 并重建 registry

不建议的做法：

- 先改前端搜索逻辑，后补数据
- 用详情页 `Description` 代替真实 tags
- 手工维护长期离线 tags 覆盖表
- 为了 tags 重写现有 SVG 导出主链

## 结论

本方案的核心判断是：

- `tags` 和 `SVG` 来自不同页面，这是正常的，不需要强行合并成同一抓取步骤
- 当前最稳的做法不是推翻详情页 SVG 提取，而是在外层列表新增一条元数据补全链
- 只要 manifest 成为两条链路的汇合点，最终搜索索引就可以稳定使用官方 tags

按本方案落地后，icon picker 搜索将从“只认名称和 slug”升级为“可命中 Streamline 官方标签语义”，并保持现有 SVG 资产链路不被破坏。
