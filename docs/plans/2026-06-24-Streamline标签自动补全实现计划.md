# Streamline 标签自动补全实现计划

> **For agentic workers:** 本计划按 TDD 拆成小步执行，优先交付离线可批处理的第一版能力。

**Goal:** 为 `micro-solid` 建立第一版离线标签自动补全链路，能够从已标注官方样本构建知识库，并对未标注图标生成带证据和置信度的建议标签。

**Architecture:** 第一版不再访问官网，而是直接消费本地 manifest 和 SVG。实现拆成两层：一层构建已标注样本知识库，另一层基于名称 token、slug 前缀和 SVG 结构特征为未标注项召回近邻并生成建议标签。

**Tech Stack:** Node.js ESM、现有 manifest-store、node:test、原生文件系统

---

## 文件结构

- 新增 `scripts/streamline-export/lib/streamline-svg-feature-tokens.mjs`
  - 从 SVG 文本提取结构 token，作为“图像”输入的离线代理
- 新增 `scripts/streamline-export/lib/streamline-tag-suggestion-knowledge.mjs`
  - 构建已标注样本知识库、名称 token、前缀、SVG token、标签统计
- 新增 `scripts/streamline-export/build-streamline-tag-knowledge.mjs`
  - CLI：从 manifest 构建知识库 JSON
- 新增 `scripts/streamline-export/suggest-streamline-tags.mjs`
  - CLI：对未标注图标生成建议文件
- 新增 `tests/streamline-export/streamline-svg-feature-tokens.test.mjs`
  - SVG 特征提取测试
- 新增 `tests/streamline-export/streamline-tag-suggestion-knowledge.test.mjs`
  - 知识库构建和建议生成测试

## 实施阶段

### 阶段 1：SVG 特征提取

- 目标：先把“图像输入”落成一个稳定、可测试的离线特征层
- 范围：只提取结构 token，不引入复杂视觉模型

### 阶段 2：知识库与建议引擎

- 目标：从已标注样本构建受控词表和近邻召回逻辑
- 范围：名称 token、slug 前缀、SVG token、标签频次、标签建议

### 阶段 3：CLI 落地

- 目标：让链路能直接对真实 manifest 产出建议文件
- 范围：知识库导出 CLI、建议生成 CLI

### 阶段 4：验证

- 目标：用真实样本和小规模 spot check 验证第一版输出结构正确
- 范围：先确保格式、证据和候选逻辑正确；holdout 评估可作为下一轮增强

## 当前执行假设

- 默认只处理 `micro-solid`
- 默认不回写 manifest，只生成建议文件
- 建议标签默认只来自当前官方 tags 受控词表

## 当前执行结果

截至 `2026-06-24` 当前实现已经落地到仓库：

- 已新增 `scripts/streamline-export/lib/streamline-svg-feature-tokens.mjs`
- 已新增 `scripts/streamline-export/lib/streamline-tag-suggestion-knowledge.mjs`
- 已新增 `scripts/streamline-export/build-streamline-tag-knowledge.mjs`
- 已新增 `scripts/streamline-export/suggest-streamline-tags.mjs`
- 已新增对应测试，当前相关测试通过

真实 `micro-solid` 运行结果：

- 知识库快照：`artifacts/streamline-export/micro-solid-tag-knowledge.json`
- 建议文件：`artifacts/streamline-export/micro-solid-tag-suggestions.json`
- 样本统计：`1904 total / 859 labeled / 1045 unlabeled / 3276 unique tags`
- 当前门禁结果：`29 auto_accept / 647 review_required / 369 reject`

这说明第一版已经具备：

- 离线批处理能力
- 受控词表约束
- 可追踪证据输出
- 搜索文本预览能力

但仍未做：

- manifest 自动回写
- review_required 批量人工复核流
- holdout 量化评估
