# Codex 自动化机制

## 概述

### 1. 总体目标和范围

Data Editor 的条目级 Codex 自动化仍在安全升级中。当前正式产品不提供新任务的执行能力：
`POST /api/entry-actions/run` 固定返回 HTTP 503 与
`ENTRY_ACTION_PROTOCOL_DISABLED`。本页只说明已落地的安全边界和隔离验证，不把未启用的
自动化方案描述为可用功能。

### 2. 各阶段任务概要

1. 安全前置：建立物理文件身份、原子写、Windows Job ownership、fencing 与可证明 recovery。
2. Authority：以 policy、profile ETag、Strict RowId 和 authority snapshot 限定允许的目标与字段。
3. 隔离验证：在临时 scratch 中验证真实 Codex CLI 只能产生严格 proposal，不触碰正式项目。
4. 当前提交基础：正式保存已使用 `canonicalFileKey` 提交互斥、严格 ETag、稳定幂等键和可恢复
   commit journal；proposal commit 复用同一执行器。入口启用仍不在范围内。

### 3. 整体结构框架

```text
正式入口 -> 503 ENTRY_ACTION_PROTOCOL_DISABLED

隔离测试面：fixture -> scratch -> Codex CLI -> 严格 proposal -> 隔离目录
                                          \-> timeout -> Job 树终止 / fencing 释放
```

## 当前正式边界

服务端在任何 profile、binding、环境变量或前端状态之前拒绝新的 legacy direct-write action；
旧 runner 文件或历史结果仍可读取，不代表该入口可以执行。正式保存路径的 allowlist、
`canonicalFileIdentity(...)`、原子写、提交互斥与 journal 已形成受控提交基础，但它们不是自动化
写回入口。

## 已完成的隔离验证

批次 D 已完成以下工具层事实：

- proposal 必须是 version 1，绑定 UUID `runId`、canonical file key、`authorityDigest`、profile ETag、
  fencing token，并且只允许一个既有字段的显式替换。
- 只有真实 Codex CLI 退出码为 0 且 proposal 通过严格 schema 时，才会在隔离目录原子发布；失败、
  无效 payload 或路径异常不会留下 proposal。
- success / timeout 都只运行于临时 scratch fixture。timeout 在观察到 CLI readiness 后终止 Windows Job，
  并验证 Job 树退出、fencing release、10 秒无源文件晚写和空 proposal 目录。

这些验证未向正式项目写入，也未恢复 API 入口。

## 配置与可用性

`.data-editor/automation-profile.json`、本机 bindings、policy 与 authority snapshot 仍是受控执行协议的
输入和验证基础；当前它们不能绕过入口禁用。用户界面或配置中出现的动作、绑定或历史运行记录，
都不代表可以启动新的写回任务。

## 后续边界

批次 E 已完成统一提交 coordinator、proposal commit 共用执行器、commit journal 与恢复判定；它没有
把 proposal 服务接入新任务路由。正式入口仍须完成完整运行时接入、真实项目端到端验证并取得独立
启用授权，才能解除禁用。
