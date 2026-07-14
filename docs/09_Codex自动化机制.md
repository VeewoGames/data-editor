# Codex 自动化机制

## 概述

### 1. 总体目标和范围

Data Editor 的 Codex 自动化把“某个集合中的某条记录”交给本机 Codex 技能处理。它不是通用任务队列，也不替代 Codex；它负责在详情面板中配置可执行动作、校验本机绑定、传递受限的条目上下文，并展示异步结果。

### 2. 各阶段任务概要

1. 配置规则：定义动作名称、适用的数据文件与 collection，以及可选的运行参数。
2. 配置本机绑定：把规则映射到当前设备可用的 Codex skill。
3. 执行与观察：从详情面板启动动作，读取 started、result 与 Markdown 输出。

### 3. 整体结构框架

```text
自动化规则（项目或个人 profile）
        + 本机绑定与默认运行参数
        -> API 校验 active project、目标与条目
        -> handoff JSON
        -> run-entry-action 子进程 / Codex CLI / skill
        -> result JSON 与 reply.md
        -> 详情面板反馈
```

## 配置分层

自动化规则保存为 `.data-editor/automation-profile.json`。每条规则至少包含稳定的 `id`、显示 `label`、启用状态和 `targets`；目标精确到数据文件与 collection。规则可覆盖 `model`、`reasoning`、`verbosity` 与 `timeoutMs`。

本机绑定保存为 `.data-editor/local/automation-bindings.json`，不应作为团队共享规则。它包含：

- `bindings.<ruleId>.provider`：当前仅支持 `codex`；
- `bindings.<ruleId>.skill`：本机 skill 名称；
- `bindings.<ruleId>.enabled`：是否允许执行；
- `defaults`：所有未被规则覆盖的运行参数。

运行参数优先级是：规则覆盖 > 本机 `defaults` > 系统默认值。系统默认值为 `gpt-5.6-terra`、`medium` 推理、`low` 输出详略和 120 秒超时。

## 前置条件与可用性

执行前服务会确认：当前项目处于 active 状态、规则存在且已启用、本机绑定存在且启用、provider 为 `codex`、可执行 Codex CLI 存在，以及指定 skill 可从项目 `.agents/skills` 或用户 Codex skill 目录解析到 `SKILL.md`。

任一条件不满足时，动作不会启动；前端应显示绑定状态或服务返回的具体原因。

## 执行链

详情面板通过 `POST /api/entry-actions/run` 提交 `projectId`、`actionId`、`sourcePath`、`collectionPath`、`sourceRowIndex` 和可选 `rowId`。服务会验证该动作允许处理该文件与 collection，重新读取源文档并解析目标行。

服务随后生成唯一 `runId`，将动作、绑定、最终运行参数和当前行及相邻行摘要写入：

```text
<project>/.data-editor/runtime/entry-actions/<runId>.json
```

后台 `run-entry-action.mjs` 消费 handoff，并以 detached 子进程执行，避免阻塞 Data Editor 服务。Windows 下该子进程隐藏窗口运行。

## 结果与排查

运行目录还会产生：

```text
<runId>.started.json  # 已被执行器接收
<runId>.result.json   # 成功或失败状态
<runId>.reply.md      # 面向用户的 Markdown 输出
```

前端通过以下接口轮询或读取状态：

- `GET /api/entry-actions/result?runId=...`
- `GET /api/entry-actions/output?runId=...`

如果 result 尚未生成但 handoff 存在，服务返回 `started`；未知 `runId` 返回 404。排查时先检查绑定可用状态、handoff 文件、result JSON，再检查 Codex CLI 与 skill 本身的执行输出。

## 使用边界

- 动作只能作用于当前 active project 中规则允许的目标 collection。
- Data Editor 传递的是受限的条目上下文；skill 的具体行为由 Codex skill 自己定义。
- 自动化不会自动保存或改写当前数据记录，除非被调用 skill 在其授权范围内另行操作。
- 本机绑定包含设备相关能力，不应和团队规则混为同一份共享配置。
