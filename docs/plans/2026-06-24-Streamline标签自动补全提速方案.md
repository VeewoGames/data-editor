# Streamline 标签自动补全提速方案

## 概述

### 1. 总体目标和范围

本方案的目标是把当前 `micro-solid` 标签补全链路从“高质量、低吞吐”的批次式推进，升级为“高质量、可流水线批处理”的提速版本，在不回退到高频官网抓取的前提下，显著提升剩余标签任务的处理效率。

本方案覆盖：

- 当前离线自动补全链路为什么仍然慢
- 哪些环节是真正的吞吐瓶颈
- 如何把现有“按前缀逐批显式规则”升级为“两阶段流水线 + 批量语义归类”
- 如何在提速的同时保留现有 `manifest -> registry -> searchText` 的质量闭环
- 后续大量空缺标签任务如何复用这套提速框架

本方案不覆盖：

- 恢复大批量访问 `streamlinehq.com`
- 改造 shared-view 搜索消费模型
- 放弃质量门禁，直接把低置信候选大规模写回 manifest

### 2. 各阶段任务概要

第一阶段：拆分“候选生产”和“正式回写”  
主要工作：把当前每个 batch 都重复执行的闭环，拆成独立的候选生成阶段和独立的统一回写阶段  
预期成果：减少重复 dry-run、重复 registry 重建、重复 search 验证的成本  
执行顺序：先做

第二阶段：建立批量语义归类器  
主要工作：把现在按 `share/time/user` 手工写 profile 的方式，升级为可批量处理多个稳定簇的 profile 生成器  
预期成果：一次处理多个 prefix cluster，而不是一轮只推进 8 到 20 个图标  
执行顺序：在流水线拆分后进行

第三阶段：引入批量门禁与统一 apply  
主要工作：按置信度和规则稳定性，把建议结果分为 `auto_accept`、`review_required`、`reject`，再按簇批量 apply  
预期成果：把当前“每批一套完整闭环”改成“多批共享一次闭环”  
执行顺序：在批量语义归类器后进行

第四阶段：沉淀复用规范  
主要工作：把 prefix profile、门禁阈值、批量 apply 规则沉淀成稳定指南  
预期成果：后续其他图标族或后续剩余标签任务可以复用同一框架  
执行顺序：最后

### 3. 整体结构框架

```text
micro-solid manifest
  -> 候选生成层
    -> 名称信号
    -> 已有官方 tags
    -> 稳定前缀 profile
  -> 批量语义归类层
    -> stable cluster
    -> profile synthesis
    -> confidence gate
  -> 建议产物层
    -> auto_accept bucket
    -> review_required bucket
    -> reject bucket
  -> 统一回写层
    -> dry-run apply
    -> real apply
    -> registry rebuild
    -> runtime search verify
```

## 当前瓶颈复盘

当前离线自动补全已经摆脱了官网高频抓取，但吞吐量仍然偏低，原因不在“候选生成能力不足”，而在“执行形态仍然是人工批次收敛”。

结合当前实际推进情况：

- 已完成 `batch1` 到 `batch7`
- 当前 `micro-solid` 为 `success = 1080`
- 当前 `pending = 824`
- 当前 `review_required = 483`

现有低效点主要有 4 个：

### 1. 处理粒度过细

当前模式是按稳定前缀簇逐批推进：

- `share`
- `time`
- `warning`
- `number`
- `watch`

每一批都要单独经历：

- 规则设计
- 专用脚本
- 专用测试
- dry-run
- real apply
- registry 重建
- runtime 验证
- truth / ADR 收口

这会让每一批的固定成本远高于有效回写量。

### 2. 规则设计仍然是“逐批手工 profile”

虽然现在不再访问官网，但 `user`、`text`、`shopping`、`laptop` 这类簇，仍然需要人工逐个判断：

- 哪些子语义稳定
- 哪些噪音词需要压制
- 哪些 tags 可以保留

也就是说，现在的自动补全更接近“半自动规则生产”，而不是“批量自动补全”。

### 3. 验证闭环重复执行

当前每推进一批，都要重复执行完整验证闭环。  
但实际上：

- dry-run 可以按多簇合并
- apply 可以按多簇合并
- registry 重建可以按多簇共享一次
- runtime 搜索验收也可以按多簇共享一轮

这部分当前存在明显重复成本。

### 4. 高置信建议与正式回写耦合过紧

现在是“生成一小批建议 -> 立即进入正式回写”。  
这会导致：

- 候选积累不起来
- 统一质量筛选做不起来
- 不能按大批次合并执行 apply / rebuild / verify

## 提速核心思路

提速的关键不是牺牲质量，而是把当前链路从“串行批次式闭环”改成“分层流水线”。

### 核心原则

1. 候选生产和正式回写分离  
2. 多个稳定簇共享一次闭环  
3. 把“手工写 profile”升级为“批量 profile 合成”  
4. 保留现有 `searchText` 真实消费验证，不降低验收门槛

## 推荐方案

## 方案 A：继续当前模式，只扩大 batch 大小

### 做法

- 继续按稳定前缀簇逐个写脚本
- 只是把每次处理的簇从 1 个扩大到 2 到 3 个

### 优点

- 改动最小
- 可直接复用现有 batch 模式

### 缺点

- 固定成本仍然存在
- 规则设计仍然是人工逐批
- 吞吐量会提升，但不会质变

### 结论

只能作为临时缓解，不适合作为主提速路线。

## 方案 B：两阶段流水线

### 做法

把当前链路拆成两个阶段：

第一阶段：批量候选生产

- 一次性对多个 prefix cluster 生成建议
- 只输出建议文件，不立即写 manifest
- 生成统一的 `auto_accept / review_required / reject` 分桶

第二阶段：统一 apply

- 只对 `auto_accept` 且满足门禁的项统一 dry-run
- 再统一 real apply
- 统一重建 registry
- 统一做 runtime search 验证

### 优点

- 立即减少重复 dry-run / rebuild / verify 的成本
- 不需要推翻现有 suggestions / apply 链路
- 能和当前脚本体系平滑兼容

### 缺点

- 规则设计成本仍然存在
- 只是解决“闭环重复”，没有完全解决“profile 生产慢”

### 结论

这是最稳的短期提速方案，应该优先落地。

## 方案 C：两阶段流水线 + 批量语义归类器

### 做法

在方案 B 基础上，再引入一个“批量 stable profile 合成层”：

- 从当前 `review_required` 中自动发现稳定簇
- 对 `user-*`、`shopping-*`、`laptop-*`、`text-*` 这类簇做统一 profile 模板化
- 用名称 token、已有官方 tags、前缀簇共现规则，自动为每个 item 生成 profile 候选

这层不直接写 manifest，而是先产出：

- `cluster`
- `profile`
- `suggestedTags`
- `removedNoiseTags`
- `confidence`
- `decision`

### 优点

- 能把当前“每次只推进一个前缀簇”的模式升级为“每轮推进多个稳定簇”
- 人工成本从“写具体 item 规则”收缩为“校对 profile 模板”
- 长期吞吐量提升最大

### 缺点

- 需要补一层新的批量 profile 框架
- 初期设计比方案 B 更重

### 结论

这是推荐的正式主路线。  
建议分两步做：

- 先落方案 B
- 再快速抬升到方案 C

## 具体提速设计

### 第一部分：把 batch 改成 wave

不要再按 `batch1/batch2/batch3` 这种“每批单簇”模式长期推进。  
改成 `wave`：

- `wave1`: user + shopping + laptop
- `wave2`: text + volume + select
- `wave3`: list + location + wifi

每个 `wave` 的产物包含：

- `wave-suggestions.json`
- `wave-apply-dry-run.json`
- `wave-apply.json`
- `wave-verify.json`

这样可以把多个稳定簇共享一次完整闭环。

### 第二部分：把 profile 从脚本文件提升为数据文件

当前每个 batch 都是一个专用 `mjs` 脚本。  
提速后应该改成：

- 一个通用 `promote-streamline-stable-clusters.mjs`
- 一个 profile 数据文件，例如 `streamline-stable-cluster-profiles.json`

profile 数据文件中定义：

- `prefix`
- `matchTokens`
- `baseTags`
- `shapeTags`
- `variantTags`
- `blockedTags`
- `maxTags`

例如 `user` 可以声明：

- 基础主体：`user`
- 形态修饰：`circle`、`square`、`multiple`
- 动作修饰：`add`、`delete`、`edit`、`check`
- 语义修饰：`warning`、`off`、`search`、`share`
- 黑名单：`bubble`、`chat`、`payment`、`charity`、`cash`

这样新增一个稳定簇时，不再需要新写一套完整脚本，只需要补 profile 数据。

### 第三部分：把测试从“每批一个测试文件”改成“通用 profile 测试”

当前每个 batch 都有一个专用测试文件。  
提速后应该改成：

- 一个通用 promotion 测试入口
- 一组按簇组织的 fixture

测试结构建议：

```text
tests/streamline-export/fixtures/stable-clusters/
  user.json
  shopping.json
  laptop.json
  text.json
```

每个 fixture 描述：

- 输入 `itemId`
- 原始 suggestions
- 期望 `suggestedTags`
- 期望 `decision`

这样新增簇时只补 fixture，不再复制测试骨架。

### 第四部分：把 runtime 验证改成抽样验证

当前每个 batch 都会做运行时验证。  
提速后可以保留真实消费验收，但从“逐项验证”改成“每簇抽样验证”：

- 每个簇抽 2 到 4 个代表项
- 验证 `manifest tags`
- 验证 `generated registry`
- 验证 `searchText`

例如 `user` 簇只抽：

- `user-add`
- `user-circle`
- `user-search-magnifier`
- `user-warning`

这样仍然是真实消费验证，但成本显著下降。

### 第五部分：把 truth / ADR 收口从“每小批一次”改成“每 wave 一次”

当前 `.claw` 收口频率也偏高。  
提速后建议：

- 小范围局部推进不单独做 round closeout
- 一个 `wave` 结束后再统一做 truth / ADR 收口

这样既保留知识沉淀，又不会让文档收尾成本超过标签本身。

## 推荐落地顺序

### 阶段 1：短期提速

先落方案 B：

- 候选生产和正式回写分离
- 多个稳定簇共享一次 dry-run / apply / rebuild / verify
- 把当前 `batch` 模式升级为 `wave` 模式

这一阶段的目标不是彻底重构，而是先把执行吞吐量拉起来。

### 阶段 2：中期提速

再落方案 C 的核心部分：

- 把稳定簇规则从专用脚本提升为 profile 数据文件
- 把专用测试文件提升为通用 fixture 测试
- 用统一 promotion 引擎处理多个簇

这一阶段完成后，新增稳定簇的成本会显著下降。

### 阶段 3：长期复用

最后沉淀成一套长期规范：

- 什么样的簇适合进入 stable cluster profile
- 什么样的项必须继续 `review_required`
- 什么样的 noise tags 必须全局压制

## 预期收益

如果按当前模式继续推进，后续效率仍然会主要受这些固定成本限制：

- 单簇规则设计
- 单簇测试骨架
- 单簇 apply
- 单簇 rebuild
- 单簇 verify

切到提速方案后，预期收益主要来自 3 点：

1. 合并闭环成本  
多个簇共享一次回写与验证，直接减少重复操作

2. 降低新增簇成本  
新增簇从“写一套脚本”降到“补一段 profile 数据”

3. 提高单轮有效回写量  
从“每轮推进 8 到 13 条”提升到“每轮推进多个稳定簇”

## 当前建议结论

推荐结论分为两层：

### 立即执行的推荐

立即停止继续增加新的 `batchN` 专用脚本，转为：

- 先做 `wave1`
- 把 `user + shopping + laptop` 合并成一轮候选生产和统一回写

### 正式主路线推荐

正式主路线应改为：

- `wave` 取代 `batch`
- 通用 promotion engine 取代专用 batch 脚本
- profile 数据文件取代手写规则分散实现
- 通用 fixture 测试取代批次复制测试

这条路线的本质不是放松质量，而是把当前已经验证有效的策略，从“工匠式逐批推进”升级为“可复用流水线”。
