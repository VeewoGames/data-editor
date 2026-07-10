# Multi Relation 语义与主键同步实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `Multi-select` 字段可以正式承载 `relation mode = multi` 语义，并补齐 multi relation 在主键改名场景下的自动同步、保存与验证链路。

**Architecture:** 保持现有“字段基础显示类型”和“字段语义角色”分层不变，只放宽 relation 配置资格，让 `Text` 字段与“当前值形状可被推断为 `Multi-select` 的顶层数组字段”都能进入 relation 配置入口；一旦配置 relation，列模型继续统一提升为 `Relation` 显示类型，由 `RelationCellEditor` 接管主表和详情编辑。主键改名同步沿用现有 `buildPrimaryKeySyncPlan -> buildMaintenanceLookupState -> buildPrimaryKeySyncSaveSnapshot -> confirmPrimaryKeySyncSave` 链路，但扩展其对顶层 multi relation 数组值的 rewrite 计划、UI 暴露与实际落盘能力。

**Tech Stack:** React、TypeScript、Node `node:test`、Playwright、现有 `view-config` / relation maintenance / primary key sync 保存链路

---

## 概述

### 1. 总体目标和范围

本轮目标是把“多值外键数组”正式收敛为 relation 语义，而不是继续停留在普通 `Multi-select` 选项字段。这里的 `Multi-select` 指运行时根据数组值形状推断出来的显示类型，而不是 `view-config` 中可持久化保存的正式字段 `type`。用户可以从列头菜单把 `Text` 字段或当前被推断为 `Multi-select` 的顶层数组字段配置为 relation，并在 `RelationConfigDialog` 中选择 `mode = multi`。配置完成后，该字段在主表、详情面板、筛选与校验链路中统一按 relation 处理，业务 JSON 中继续只保存目标主键值数组，不写入 label 或 option 元数据。

本轮还要补齐 multi relation 的主键改名自动同步。当前代码会把 `mode !== "single"` 的命中直接归入 `skipped`，保存快照也只支持顶层单值字段改写，因此功能并不完整。本轮要把“顶层字段的 multi relation 数组重写”纳入正式支持范围，并保持嵌套路径 relation 仍然明确留在 out of scope，不顺手扩容。

### 2. 各阶段任务概要

第一阶段聚焦资格与渲染入口收敛：确认列头菜单、`App.tsx` 字段资格判断、列模型与 relation 编辑器的协作边界，并先用失败测试锁定“`Multi-select` 字段可以配置 relation，但配置后统一按 relation 渲染”这一行为。

第二阶段聚焦配置与运行时链路：调整 relation 配置资格、保留 `view-config.json` 中 `relations` 为唯一语义源，确保 relation 配置后不再依赖普通 `multiSelectOptions` 解释业务值，同时明确保留旧 `multiSelectOptions` 作为撤销 relation 后可恢复的历史显示配置，并验证业务 JSON 仍只写主键数组。

第三阶段聚焦主键改名同步：扩展 `buildPrimaryKeySyncPlan(...)`、`buildMaintenanceLookupState(...)` 和 `buildPrimaryKeySyncSaveSnapshot(...)`，让顶层 multi relation 命中不再进入 `unsupported-multi`，而是形成真实 rewrite、被 UI 维护态正确暴露并最终落盘。

第四阶段聚焦端到端验证与文案收尾：补齐 UI 提示、同步摘要、Playwright 用例与单元测试，确认“配置 -> 编辑 -> 主键改名 -> 自动同步保存”链路闭环。

### 3. 整体结构框架

- 配置资格层：`src/table/field-capabilities.mjs`、`src/App.tsx`
- 列模型与渲染层：`src/table/table-column-models.mjs`、`src/table/CellRenderer.tsx`、`src/table/RelationCellEditor.tsx`、`src/detail/DetailPanel.tsx`
- relation 维护层：`src/model/relation-maintenance.mjs`、`src/model/relationMaintenance.ts`、`src/model/maintenance-lookup.mjs`
- 保存落盘层：`src/model/primary-key-sync-save.mjs`
- UI 文案与摘要层：`src/App.tsx`、`src/components/RelationBacklinksPanel.tsx`
- 验证层：`tests/field-capabilities.test.mjs`、`tests/relation-maintenance.test.mjs`、`tests/primary-key-sync-save.test.mjs`、`tests/data-editor.spec.ts`

## 范围边界

### In Scope

- 允许基础类型为 `Text` 或 `Multi-select` 的字段配置 relation
- 允许该 relation 配置为 `mode = multi`
- relation 配置后统一按 `Relation` 角色展示与编辑
- 顶层 multi relation 的主键改名 rewrite 计划与保存落盘
- relation-multi 的矩形删除/清空回归验证
- 对应测试、摘要文案、维护面板提示更新

### Out of Scope

- 嵌套路径 multi relation 的 rewrite 支持
- 把普通 `Multi-select` option 体系和 relation 体系混成单一模型
- 改动业务 JSON 的最终形状为除“主键值数组”之外的任何格式
- 重做 relation config 对话框整体交互结构
- 扩展嵌套路径 relation rewrite 到自动同步支持

## 受影响文件映射

- 修改：`src/table/field-capabilities.mjs`
- 修改：`src/App.tsx`
- 修改：`src/model/relation-maintenance.mjs`
- 修改：`src/model/relationMaintenance.ts`
- 修改：`src/model/maintenance-lookup.mjs`
- 修改：`src/model/primary-key-sync-save.mjs`
- 修改：`src/components/RelationBacklinksPanel.tsx`
- 测试：`tests/field-capabilities.test.mjs`
- 测试：`tests/maintenance-lookup.test.mjs`
- 测试：`tests/relation-maintenance.test.mjs`
- 测试：`tests/primary-key-sync-save.test.mjs`
- 测试：`tests/data-editor.spec.ts`

### Task 1: 锁定 Multi-select relation 资格与显示语义

**Files:**
- Modify: `src/table/field-capabilities.mjs`
- Modify: `src/App.tsx`
- Test: `tests/field-capabilities.test.mjs`
- Test: `tests/data-editor.spec.ts`

- [ ] **Step 1: 先补字段资格失败测试**

在 `tests/field-capabilities.test.mjs` 新增一组断言，覆盖：
- `baseDisplayType: "Multi-select"` 时 `canConfigureRelation === true`
- 同一个 `Multi-select` 字段仍然不能成为标题或主键
- `Document` / `Select` 继续不能配置 relation

- [ ] **Step 2: 跑字段资格测试确认当前失败**

Run: `node --test tests/field-capabilities.test.mjs`
Expected: FAIL，原因是当前 `Multi-select` 仍被视为不可配置 relation。

- [ ] **Step 3: 最小化修改资格判断**

在 `src/table/field-capabilities.mjs` 中把 `canConfigureRelation` 的资格从“仅 `Text`”调整为“`Text` 或 `Multi-select`”，但继续保持：
- `canBeTitle` 仅 `Text`
- `canBePrimaryKey` 仅 `Text`
- `relationConfigured` / `backlink` / nested 字段仍然锁定菜单能力

同时在 `src/App.tsx` 的 `canConfigureRelationForField(...)` 中同步收敛同一规则，避免菜单层和命令处理层出现双标。这里的实现与测试都要明确：`Multi-select` 是运行时推断显示类型，不是 `view-config` 的正式 `type`，所以 E2E 夹具应通过数组值样例触发推断，而不是尝试写入一个持久化 `type = "Multi-select"`。

- [ ] **Step 4: 复跑字段资格测试确认转绿**

Run: `node --test tests/field-capabilities.test.mjs`
Expected: PASS

- [ ] **Step 5: 补 UI 入口失败测试**

在 `tests/data-editor.spec.ts` 基于现有 “eligible text fields” 用例旁新增场景：
- 选中一个 `Multi-select` 顶层字段
- 列头菜单应出现 `[data-relation-action="create"]`
- 不应出现“设为标题”与“设为主键ID”

- [ ] **Step 6: 跑 Playwright 定向用例确认当前失败**

Run: `npx playwright test tests/data-editor.spec.ts -g "multi-select field can configure relation"`
Expected: FAIL，原因是当前列头菜单不会给 `Multi-select` 显示 relation action。

### Task 2: 收敛 relation multi 的配置与运行时展示链路

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/table/table-column-models.mjs`
- Test: `tests/data-editor.spec.ts`

- [ ] **Step 1: 先补端到端失败测试锁定目标行为**

在 `tests/data-editor.spec.ts` 新增场景：
- 准备一个顶层数组字段，使用数组样例值使运行时推断结果为 `Multi-select`
- 将其配置为 relation 且 `mode = multi`
- 刷新或重新打开文件后，单元格应由 relation trigger 展示，而不是普通 multi-select option popover
- `view-config.json` 中该字段应存在 `relations[relationKey].mode === "multi"`

优先复用仓库中已有的 relation E2E helper 与 scratch fixture，例如 `configureRelation(...)` 和现有 `keywords` multi relation 场景，而不是临场新造整套交互脚手架。

- [ ] **Step 2: 跑定向 E2E 确认当前失败**

Run: `npx playwright test tests/data-editor.spec.ts -g "multi relation field persists relation config and renders as relation"`
Expected: FAIL，原因是当前 `Multi-select` 无法进入 relation 配置入口，或配置后行为未闭环。

- [ ] **Step 3: 保持列模型统一提升为 Relation**

确认并只做必要收敛：
- `src/table/table-column-models.mjs` 继续以 `relationConfigured` 为准，把 `effectiveDisplayType` 提升为 `Relation`
- `src/App.tsx` 中 relation 配置确认逻辑不新增与普通 `multiSelectOptions` 的耦合
- 若该字段已有 `documentFields` 配置，继续沿用现有“relation 与 document 互斥”规则
- relation 激活期间保留该字段历史 `multiSelectOptions`，但运行时不读取它们；这样用户未来清除 relation 时可以自然回到普通多选显示配置

本任务不新增兼容分支，不保留“既是 multi-select option 又是 relation”的双解释状态。

- [ ] **Step 4: 复跑定向 E2E 用例确认转绿**

Run: `npx playwright test tests/data-editor.spec.ts -g "multi relation field persists relation config and renders as relation"`
Expected: PASS

### Task 3: 补齐顶层 multi relation 的主键改名 rewrite 计划

**Files:**
- Modify: `src/model/relation-maintenance.mjs`
- Modify: `src/model/relationMaintenance.ts`
- Modify: `src/model/maintenance-lookup.mjs`
- Test: `tests/maintenance-lookup.test.mjs`
- Test: `tests/relation-maintenance.test.mjs`

- [ ] **Step 1: 先把 rewrite 计划测试改成失败形式**

扩展 `tests/relation-maintenance.test.mjs` 现有 “rewrites only top-level single relations” 用例：
- 顶层 `mode = multi` 命中不再应进入 `unsupported-multi`
- 顶层 `skills: ["slash", "fire"]` 在主键从 `slash -> slash_2` 时应生成一条 rewrite
- 嵌套路径 relation 仍然保持 `unsupported-nested-path`

- [ ] **Step 2: 跑 relation maintenance 测试确认当前失败**

Run: `node --test tests/relation-maintenance.test.mjs`
Expected: FAIL，原因是当前实现仍会把 `mode !== "single"` 直接塞进 `skipped`。

- [ ] **Step 3: 最小化扩展 rewrite 计划生成**

在 `src/model/relation-maintenance.mjs` 中调整 `buildPrimaryKeySyncPlan(...)`：
- 保留对 nested path 的跳过
- 顶层字段若 `config.mode === "multi"` 且当前值数组中包含旧主键，则生成 rewrite
- rewrite item 继续复用现有结构，不额外引入第二套数据模型

在 `src/model/relationMaintenance.ts` 同步类型导出，确保 `rewrites` / `skipped` 的 TypeScript 声明仍与 JS 实现一致。

同时补 `tests/maintenance-lookup.test.mjs` 与 `src/model/maintenance-lookup.mjs`：
- 确认顶层 multi relation rewrite 会进入 `primaryKeySyncPlan`
- 确认 UI 维护态读取到的 `rewrites` / `skipped` 与底层计划一致，避免出现“纯函数已支持，但详情或维护面板未暴露”的断层

- [ ] **Step 4: 复跑 relation maintenance 测试确认转绿**

Run: `node --test tests/relation-maintenance.test.mjs`
Expected: PASS

### Task 4: 补齐 multi relation 的保存落盘与摘要文案

**Files:**
- Modify: `src/model/primary-key-sync-save.mjs`
- Modify: `src/App.tsx`
- Modify: `src/components/RelationBacklinksPanel.tsx`
- Test: `tests/primary-key-sync-save.test.mjs`
- Test: `tests/data-editor.spec.ts`

- [ ] **Step 1: 先补保存快照失败测试**

在 `tests/primary-key-sync-save.test.mjs` 新增两组用例：
- 同文件顶层 multi relation 数组在 pending save 中把匹配的旧主键替换为新主键
- 外部来源文件顶层 multi relation 数组在加载一次后完成相同 rewrite

- [ ] **Step 2: 跑保存快照测试确认当前失败**

Run: `node --test tests/primary-key-sync-save.test.mjs`
Expected: FAIL，原因是当前实现只支持 `row[field] = rewrite.newValue` 的单值覆盖。

- [ ] **Step 3: 扩展保存快照逻辑**

在 `src/model/primary-key-sync-save.mjs` 中：
- 保留“同文件只 clone 一次、外部来源文件按路径复用快照”的现有架构
- 对顶层 multi relation rewrite，按数组逐项替换旧主键
- 不修改未命中的值顺序，不清洗额外元素，不把数组降级成单值

同时更新 `src/App.tsx` 与 `src/components/RelationBacklinksPanel.tsx` 文案：
- 移除顶层 multi relation 被视为“首版未支持”的提示
- 仅对仍未支持的 nested path 命中保留 skipped 描述
- 把 `src/App.tsx` 中 skipped-reason helper 一并列为明确检查点，避免只改维护面板文案漏掉对话框或状态摘要 copy

- [ ] **Step 4: 复跑保存快照测试确认转绿**

Run: `node --test tests/primary-key-sync-save.test.mjs`
Expected: PASS

- [ ] **Step 5: 增加主键改名端到端用例**

在 `tests/data-editor.spec.ts` 新增场景：
- 先把顶层数组字段配置为 `mode = multi` relation
- 修改目标集合某条记录主键
- 确认同步对话框把该数组字段命中列为可自动同步
- 保存后重新读取来源文件，数组中的旧值已被替换为新值

- [ ] **Step 6: 跑定向 E2E 确认闭环**

Run: `npx playwright test tests/data-editor.spec.ts -g "primary key sync rewrites top-level multi relation arrays"`
Expected: PASS

### Task 5: 补 relation-multi 的矩形删除/清空回归

**Files:**
- Test: `tests/data-editor.spec.ts`

- [ ] **Step 1: 先补失败用例**

在 `tests/data-editor.spec.ts` 基于现有 “delete clears rectangle values for text number checkbox select and multiselect” 场景旁新增 relation-multi 版本：
- 准备一个已配置 `mode = multi` relation 的顶层数组字段
- 用矩形选区覆盖该 relation 字段
- 按 `Delete`
- 断言该格被清空为 relation 语义下的空值，而不是保留旧 chip 或回退成异常文本

- [ ] **Step 2: 跑定向 E2E 确认当前失败**

Run: `npx playwright test tests/data-editor.spec.ts -g "delete clears rectangle values for multi relation"`
Expected: FAIL，原因是当前计划尚未覆盖 relation-multi 在矩形清空路径上的行为。

- [ ] **Step 3: 在实现时把它作为强制回归项**

实现阶段需要明确检查：
- 字段一旦配置 relation，矩形清空路径会走 `effectiveDisplayType = "Relation"`
- relation-single 与 relation-multi 的清空值都与当前 relation 编辑器预期一致
- 不误用普通 `Multi-select` 的 `buildOptionFieldClearPatch(...)`

- [ ] **Step 4: 复跑 relation-multi 清空用例确认转绿**

Run: `npx playwright test tests/data-editor.spec.ts -g "delete clears rectangle values for multi relation"`
Expected: PASS

### Task 6: 整体验证与收尾

**Files:**
- Test: `tests/field-capabilities.test.mjs`
- Test: `tests/maintenance-lookup.test.mjs`
- Test: `tests/relation-maintenance.test.mjs`
- Test: `tests/primary-key-sync-save.test.mjs`
- Test: `tests/data-editor.spec.ts`

- [ ] **Step 1: 跑单元测试集合**

Run: `node --test tests/field-capabilities.test.mjs tests/maintenance-lookup.test.mjs tests/relation-maintenance.test.mjs tests/primary-key-sync-save.test.mjs`
Expected: PASS

- [ ] **Step 2: 跑端到端定向回归**

Run: `npx playwright test tests/data-editor.spec.ts -g "relation|primary key sync|multi relation"`
Expected: PASS

- [ ] **Step 3: 人工核对关键真实结果**

检查点：
- `view-config.json` 中 relation 配置存在且 `mode = "multi"`
- 业务 JSON 中对应字段保存的是目标主键值数组
- 主键改名同步后数组值真实更新
- relation-multi 的矩形删除/清空行为与 relation 语义一致
- nested path 命中若仍存在，应继续被明确标成未支持，而不是静默丢失

- [ ] **Step 4: 提交前收尾**

整理提交说明时应明确写出：
- 本轮只完善“顶层 multi relation”
- 业务 JSON 真实形状为目标主键值数组
- 历史 `multiSelectOptions` 保留，但在 relation 激活时不参与读取
- nested path relation rewrite 仍未纳入范围
