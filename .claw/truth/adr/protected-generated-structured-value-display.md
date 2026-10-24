# 受保护生成字段的通用只读结构展示

status: accepted

## context

受保护字段的表格分支曾直接展示完整 JSON，绕过普通嵌套值摘要，导致长结构撑开界面。字段保护决定能否编辑，不应使内容失去可读展示边界。该问题适用于通用产品，不依赖项目字段名或业务语义。

## decision

2026-10-22 用户明确修正：受保护结构必须复用 Data Editor 统一嵌套规则。对象/数组走原 `nested-summary` → 根详情 → 集合 rail / NodeEditorHost / 未知 schema 只读 fallback，不再内联 details 展开整段 JSON。前一轮 `ReadonlyGeneratedValue` 与专用样式已删除。标量生成产物仍可只读查看。

保护权限按当前条目和根字段计算并向全部后代传递，不复制进导航栈。表格与详情复用同一策略匹配：有 rowSelector 时按精确 ID 选中，缺 marker 不能解锁；无 selector 时沿 requiresFields。未知权限明确只读，不能出现可输入外观而静默丢弃。集合增删/复制/排序、类型切换、重置和迟到回调均受约束，最终根写回再核对最新权限及行身份；未保护结构保持原编辑能力，服务端保护仍是最终 authority。

## consequences

受保护字段与普通结构具有同一浏览体验，差别仅为写入资格。新增业务字段不增加专用展开组件；未知 schema 复用既有 fallback，不为组件字段新增 JSON 编辑器。显示统一不构成机制写回能力的证据。

## related code

- `src/field-write-policy-match.mjs`
- `src/detail/NodeEditorHost.tsx`
- `src/detail/DetailPanel.tsx`
- `src/table/table-columns.tsx`
- `src/detail/inline-template-text.mjs`
- 当前事实：[`nocturnel-limit-request-project-command-preenable-boundary.md`](../nocturnel-limit-request-project-command-preenable-boundary.md)。

## verification scope

2026-10-22 当前修正包含 11 项相关 Node 测试、typecheck/build；正式页面核实 effects 与 component_contributions 使用原摘要，保护集合新增/修改禁用、未知 schema 无可编辑控件，未保护 effects 的新增入口可用。不是全 schema/所有弹层排列的 UI 穷举；源码守卫与服务端保护共同保留。
