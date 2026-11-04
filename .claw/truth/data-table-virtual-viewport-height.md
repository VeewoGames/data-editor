# DataTable 虚拟滚动视口高度

<!-- state: current -->
## 当前行为

`src/table/DataTable.tsx` 在布局阶段读取滚动容器的 `clientHeight`，并通过 `ResizeObserver` 在容器尺寸变化时重新测量；组件卸载时断开观察。高度变化同步到滚动指标和 `viewportHeight`，无需等待滚动事件。滚动事件仍负责更新滚动位置与指标。

普通行根据视口高度、行高和 overscan 计算渲染窗口；存在换行字段时，`buildVariableRowWindow` 使用行高索引、视口高度和滚动位置计算窗口。尺寸测量本身不主动重置滚动位置。改动此链路时应验证大视口首屏、容器缩放、普通行及换行行，并检查已有滚动位置。
