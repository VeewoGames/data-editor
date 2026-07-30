# Automation Settings 图标选择器滚轮事件边界

status: accepted

## context

`Automation Settings` 复用 `SharedViewIconPicker`。图标候选较多时，网格必须能在弹窗内独立接收鼠标滚轮；这一交互不应改变图标筛选、收藏、选择或图标包状态的既有归属。

## decision

### 1. 可滚动图标网格在捕获阶段处理滚轮

`SharedViewIconPicker` 的可滚动图标网格负责在 `onWheelCapture` 阶段隔离自身的滚轮事件。事件不再继续交给 Automation Settings 弹窗的外层滚动或滚动锁处理。

该边界只覆盖指针位于图标网格内的滚轮操作；它不扩展为全局滚轮拦截，也不改变弹窗其余区域的默认滚动语义。

### 2. 共享 picker 仍是唯一交互底座

Automation Settings 没有新增专属图标滚动实现。筛选、收藏、图标选择与图标包加载仍由 shared icon runtime 和 `SharedViewIconPicker` 的既有接口承担，自动化表单只消费其选择结果。

## completed evidence

- 图标网格的滚轮事件边界已修复，并有针对该事件边界的回归测试。
- 定向 UI 测试、类型检查和生产构建均已通过。

## verification boundary

当时的浏览器会话未返回可匹配的图标，因此没有可滚动网格可用于直接测量 `scrollTop` 的变化。这不是对滚轮距离的浏览器级实测证据；后续若图标包可返回足量候选，应补做真实网格滚动观察。

## consequences

- 后续修改外层弹窗或滚动锁时，不得移除或绕过图标网格的捕获阶段事件边界。
- 若再次出现“滚轮无法滚动图标网格”，应先检查事件是否在外层接管，而不是复制 picker 或新增 automation 专属状态。
- 图标筛选、收藏、选择和图标包行为的职责边界继续遵循既有 shared icon runtime 治理文档。

## related code

- `src/components/SharedViewIconPicker.tsx`
- `tests/shared-view-icon-picker.test.mjs`
- `src/components/icons.ts`

## search terms

`Automation Settings`、`SharedViewIconPicker`、`onWheelCapture`、`scrollTop`、`wheel event`、`shared icon runtime`
