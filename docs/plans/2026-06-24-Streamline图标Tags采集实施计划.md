# Streamline 图标 Tags 采集实施计划

## 方案概述

### 1. 总体目标和范围

本计划用于在当前官网风控约束下，继续为 `micro-solid` manifest 回填 Streamline 官方 `tags`，并确保 icon picker 搜索持续消费这些 tags。当前已经确认：官网页面可以访问，但不能再以大批量脚本方式抓取，只能低频率、拟人化地模拟真实用户访问。

本计划只覆盖以下范围：

- 以 `artifacts/streamline-export/micro-solid-full.manifest.json` 为权威真相源推进 tags 回填
- 仅使用低频拟人化页面访问推进真实页面侧回填
- 在每轮回填后重建 registry 并抽检搜索命中
- 持续收敛 failed / pending 项，而不是重新设计整条导入链路

本计划不再包含以下内容：

- 把官网页面作为高并发或批量脚本抓取面
- 依赖详情页 description 或其他文案反推 tags
- 把 API/MCP 描述成可以稳定覆盖剩余全量 tags 的主执行面

### 2. 各阶段任务概要

#### 阶段一：执行边界收敛

主要工作：

- 把页面侧正式执行策略固定为低频拟人化微批次
- 明确 manifest 是唯一验收面，runner telemetry 只能作为辅证
- 更新计划与 truth，移除“页面批处理可持续推进”的表述

预期成果：

- 文档、执行口径、代码入口三者一致

执行顺序：

1. 修订实施计划
2. 复核 runner 当前受控入口
3. 固定本轮批次参数

#### 阶段二：低频微批次回填

主要工作：

- 使用浏览器真实登录态做小批量串行回填
- 优先处理当前 manifest 顶部 failed 项或语义相邻的小组项
- 控制单轮规模，避免触发站点级封禁

预期成果：

- 每轮稳定吃回少量 failed / pending 项
- 不新增 polluted tags，不扩大 failed 面

执行顺序：

1. 读取当前 summary 和候选项
2. 执行 1 轮低频微批次
3. 复核 manifest 落盘结果

#### 阶段三：消费侧验证

主要工作：

- 重建 `src/generated/streamline-shared-view-icons.mjs`
- 对新写回 tags 的图标做定向 query 验证
- 确认 `searchText` 仍然包含官方 tags

预期成果：

- 搜索消费链路继续正确

执行顺序：

1. 生成 registry
2. 选取新回填样本做 query 验证
3. 记录命中结果

#### 阶段四：批次化持续推进

主要工作：

- 以“多轮小批次”替代“单轮大批量”
- 每轮都记录 before / after summary 与样本命中
- 根据官网实际稳定性动态调整批次大小与节奏

预期成果：

- 在不触发封禁的前提下持续压降 `pending`

执行顺序：

1. 固定一轮标准节奏
2. 观察结果
3. 再决定是否扩大或缩小窗口

### 3. 整体结构框架

当前执行结构固定为四层：

1. 页面访问层
   - Chrome 真实登录态
   - 低频拟人化串行访问
2. metadata 回写层
   - 页面 payload 提取官方 `tags`
   - 批量安全回写 manifest
3. registry 生成层
   - 把 `tags` 合并进 `searchText`
4. 验证与记录层
   - manifest summary
   - query 命中验证
   - truth / ADR / plan 落盘

## 当前执行约束

- 官网页面只允许低频率、拟人化的真实用户访问，不再适合作为批量脚本抓取面。
- `humanMode` 串行执行是当前唯一可接受的页面侧正式策略，必须保持 `concurrency = 1`。
- 单轮应优先使用小批次语义分组或 failed 重试分组，不再默认跑大窗口连续批次。
- 最终是否成功必须以 manifest 权威计数与实际样本 tags 为准，不能只看 tool 是否超时或 runner 是否完整返回。

## 当前推荐参数

页面侧微批次默认参数如下：

```js
{
  humanMode: true,
  concurrency: 1,
  retryFailed: true,
  waitMs: 2500,
  postLoadJitterMs: 1200,
  preNavigationDelayMs: 3000,
  preNavigationJitterMs: 2200,
  postItemDelayMs: 4000,
  postItemJitterMs: 3000,
}
```

单轮建议规模：

- 优先 `1 x 1` 到 `1 x 4`
- 只在连续多轮稳定后再考虑 `1 x 5+`

## 本轮执行清单

- [x] 复核当前 `micro-solid` manifest summary 与顶部 failed 项
- [x] 选定 1 组小批次 itemIds
- [x] 用低频拟人化模式执行 1 轮真实回填
- [x] 重建 registry
- [x] 抽检搜索命中
- [ ] 更新 truth / ADR / 计划记录

## 验收标准

满足以下条件才算本轮有效推进：

- manifest 的 `success / withTags` 增加，且 `pending` 或 `failed` 减少
- 新写回样本的 `tags` 已持久化到 manifest
- `npm run streamline:generate-registry` 后，样本关键词能命中对应图标
- `pollutedCount` 保持为 `0`

## 风险与应对

风险一：访问节奏稍快即再次触发官网封禁  
应对：继续缩小单轮 item 数，拉长 item 间延时，只保留串行访问。

风险二：tool timeout 与真实推进不同步  
应对：始终回到 manifest summary 和最新成功项做最终判定。

风险三：API/MCP 对部分剩余项返回空 tags  
应对：不把它当作页面批抓替代面，只把它当作辅助诊断或 hash 元数据参考。

## 执行决策

当前推荐方案：

- 页面侧彻底放弃大批量脚本访问
- 后续推进统一切到低频拟人化微批次
- 每轮批次结束都做 manifest + registry 双复核

推荐理由：

- 这和你刚确认的站点约束一致
- 可以避免文档、代码、执行口径继续背离
- 能在可控风险下继续推进真实 tags 回填
