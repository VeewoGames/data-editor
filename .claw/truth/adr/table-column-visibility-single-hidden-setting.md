# ADR：表格列显隐统一使用隐藏字段设置

<!-- document-state: accepted -->
<!-- state: current -->

## 背景与决策

表格曾根据 inline template 的 `advancedFields` 再次过滤列，并提供独立的高级字段按钮和 `showAdvanced` 状态。这让同一字段存在两套显隐入口。2026-10-27 用户批准删除这项独立功能：表格列显隐统一由既有 `fieldConfig.hidden` 设置管理，保留原字段内容及用户隐藏设置。

## 当前实现

`DataTable` 从普通字段、嵌套字段、只读字段和反向关联列构建 `allColumns`，仅按 `snapshot.fieldConfig.hidden` 过滤可见列。标题及模板字段的排序逻辑继续独立生效；表格不再使用 `showAdvanced` 或模板 `advancedFields` 做第二层过滤。

`readInlineTemplateDefinitions()` 返回的公开 presentation 投影及 `InlineTemplateDefinition` 类型已移除 `advancedFields`。模板语言、标签和 `writePolicies` 仍保留。这次清理不删除项目源配置或业务字段，不迁移个人 `hidden` 集合，也不改变生成字段的写保护合同。

详情 nested schema 的 `presentation.advancedFields` 属于另一份合同，`node-schema` 的类型及克隆仍保留。不能因本次表格入口移除而全局删除所有同名字段，或把详情 advanced fallback 一并移除。

共享视图与个人 profile 的隐藏字段覆盖语义继续遵循[既有隐藏字段排障合同](../shared-view-profile-viewlayouts-hidden-override.md)。只读结构和写入资格继续遵循[受保护生成字段展示合同](./protected-generated-structured-value-display.md)。

## 验证范围

本次完成记录包含：16 项相关测试、类型检查及构建通过；generation 6 受保护升级后，精确写集 10 项均为 `after`，候选退役后的升级验证仍完成；正式页面无高级字段按钮，隐藏字段菜单可以打开。以上为交付时的验证结果，不代表后续运行状态的持续保证；知识收口未重跑测试或操作服务。

## 实现依据

- `src/table/DataTable.tsx`：候选列构建与 `visibleBaseFields`。
- `src/detail/useInlineTemplateDefinitions.ts`、`src/inline-template-context.mjs`：模板公开元数据及保留的写保护策略。
- `src/detail/node-schema.mjs`、`src/detail/node-schema.d.ts`：独立 nested schema presentation 合同。
