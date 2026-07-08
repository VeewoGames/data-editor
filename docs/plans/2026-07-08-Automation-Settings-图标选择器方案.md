# Automation Settings 图标选择器方案

## 方案概述

### 1. 总体目标和范围

本方案的目标，是把 `Automation Settings` 中每条自动化规则的 `Icon` 配置，从当前的纯文本输入框升级为与共享视图标签接近的一致化图标选择体验。

本次方案范围包括：

- 梳理 `Automation Settings` 当前 `Icon` 字段的真实职责与限制
- 对齐现有共享视图图标体系的可复用能力
- 收敛自动化规则图标选择器的正式实现方向
- 明确状态模型、交互流程、组件拆分与验证重点

本次不包括：

- 直接进入代码实现
- 新增第二套自动化专属图标 registry
- 自定义上传图标、emoji、颜色主题
- 基于 `skill` 自动推荐图标
- 自动化规则与共享视图之间的图标联动推断

### 2. 各阶段任务概要

#### 阶段一：现状收敛

主要工作：

- 确认 `Automation Settings` 当前 `Icon` 只是字符串输入框
- 确认自动化规则 `icon` 的合法值校验已经复用共享视图图标体系
- 确认共享视图已有成熟的图标 picker 与图标包机制

预期成果：

- 明确这是“复用现有能力”的问题，而不是“新建图标系统”的问题
- 找到最小正式切口

执行顺序：

- 先查 Automation Settings
- 再查 shared view icon picker
- 最后对齐二者边界

#### 阶段二：方案决策

主要工作：

- 比较“继续手填”“复制一套 picker”“抽共享组件复用”三条路径
- 明确推荐方案与原因
- 收敛收藏、最近、图标包加载、字段编辑方式等关键边界

预期成果：

- 给出正式推荐方案
- 明确不推荐路线与原因

执行顺序：

- 先判断真值是否需要变化
- 再判断 UI 是否完整复用
- 最后决定收藏/最近是否共用

#### 阶段三：实施与验证设计

主要工作：

- 设计组件拆分与状态流
- 设计用户交互流程
- 明确验证重点、风险和不做项

预期成果：

- 形成一份可直接转执行计划的实施方案
- 避免后续实现阶段再重新讨论图标体系边界

执行顺序：

- 先定组件和状态
- 再定交互和保存
- 最后定验证

### 3. 整体结构框架

本方案把 Automation Settings 图标能力拆成四层：

1. 数据层：`automationProfile.rules[].icon`
2. 候选层：复用 shared view icon registry / groups / pack
3. 交互层：Automation Settings 中的可视化图标选择器
4. 验证层：规则保存、回显、搜索、收藏、pack 加载与回归验证

核心边界如下：

- 自动化规则图标的正式真值仍然是 `automationProfile.rules[].icon`
- 图标合法值继续复用 `normalizeSharedViewIcon(...)`
- 不为自动化规则单独维护第二套图标白名单
- UI 上以可视化 picker 为主，不再让纯文本手填承担主交互职责

## 一、当前事实

### 1. Automation Settings 当前只有字符串输入

当前 `Automation Settings` 的规则编辑区位于 `src/App.tsx`，`Icon` 字段仍然是普通 `<input>`：

- 用户直接输入 `wand`、`shield` 之类的 icon id
- 没有图标预览
- 没有搜索、分组、收藏、最近
- 非法值只能等到保存或校验阶段暴露

这说明当前实现更像工程配置入口，而不是正式产品交互。

### 2. 自动化规则图标的合法值已经绑定到 shared view icon 体系

`src/automation-profile.mjs` 中的 `normalizeIcon(...)` 现在直接调用 `normalizeSharedViewIcon(...)` 做合法性校验。

这意味着：

- 自动化规则 `icon` 并不是自由文本
- 它天然共享了与 shared view 相同的图标 id 空间
- 如果 UI 再单独做一套自动化图标系统，状态和校验会天然分叉

### 3. 共享视图已经有成熟图标 picker

当前 `src/components/ViewTabs.tsx` 与 `src/components/icons.ts` 已经提供了完整的图标能力：

- 图标预览
- 搜索
- `最近 / 收藏 / Micro S / Core S / Tabler S / Micro L / Tabler L / Legacy`
- 图标包加载与卸载
- 最近记录
- 收藏记录
- 未加载 pack 的空态提示

所以当前问题不是“图标选择器不存在”，而是“它还没有从 shared view 语义里抽出来复用到 Automation Settings”。

## 二、需求判断

用户想要的并不是“保留当前输入框，再加一点提示”，而是：

- 像标签视图那样直观看到图标
- 能自己选择图标，而不是记住 icon id
- 选择体验和现有产品保持一致
- 保存后结果稳定，不需要猜字段值是否合法

换句话说，这个需求本质上是：

**把 shared view 图标体系提升为一套可复用的产品级图标选择能力，并接入 Automation Settings。**

## 三、方案对比

### 方案 A：继续保留纯文本输入，只补预览或提示

做法：

- 保留现在的 `Icon` 输入框
- 旁边补一个预览
- 保存前再提示非法值

优点：

- 改动最小

缺点：

- 仍然要求用户知道 icon id
- 不能解决“像标签视图那样选择”的核心诉求
- 仍然把主要负担留给用户

结论：

- 不推荐作为正式方案

### 方案 B：在 Automation Settings 里复制一套图标 picker

做法：

- 把 `ViewTabs` 里的 picker 代码复制一份到 Automation Settings
- 针对自动化规则单独接线

优点：

- 初看实现快

缺点：

- 搜索、分组、收藏、pack 管理会形成两套逻辑
- 后续 shared view 图标体系演进时，Automation Settings 容易掉队
- 长期维护成本高

结论：

- 不推荐

### 方案 C：抽共享组件，Automation Settings 复用同一套图标 picker

做法：

- 从 `ViewTabs.tsx` 中抽出通用图标 picker 组件或 hook
- Automation Settings 用受控方式接入
- 真值仍回写到 `automationProfile.rules[].icon`

优点：

- 交互一致
- 合法值空间一致
- 收藏、最近、pack 加载行为一致
- 后续维护成本最低

缺点：

- 需要做一次组件拆分
- 需要处理 Dialog 内嵌 Popover 的焦点与层级问题

结论：

- 正式推荐方案

## 四、推荐方案

### 1. 正式真值不变

自动化规则的图标真值继续保持为：

```ts
automationProfile.rules[].icon
```

原因：

- 当前存储与校验链已经成立
- 用户要变的是选择方式，不是数据模型
- 不需要为这次需求重开 profile schema

### 2. 正式候选源完全复用 shared view icon 体系

继续使用现有：

- `SharedViewIconId`
- `sharedViewIconGroups`
- `sharedViewIconPackLabels`
- `sharedViewIconSearchAliases`
- `loadSharedViewIconPack(...)`
- `readRecentSharedViewIconIds(...)`
- `favoriteSharedViewIconIds`

原因：

- 当前自动化图标已经处在同一合法值空间
- 用户也明确要求“像标签视图那样”
- 不应该在产品内出现两套长得相似、却不一致的图标选择体验

### 3. Automation Settings 中改为“可视化选择为主”

`Icon` 字段建议改成以下结构：

- 左侧：当前图标预览按钮
- 中间：当前 icon id 的只读或弱编辑展示
- 点击图标按钮：打开 picker
- 选择图标后：立即更新当前 rule draft

我推荐：

- 默认不再把纯文本输入当成主入口
- 如果要保留高级能力，可以做“展开高级编辑”或次级文本框

原因：

- 大多数用户并不会记忆 icon id
- 主路径应该是“看见 -> 搜索 -> 点选”
- 手填更适合作为调试能力，而不是正式交互

### 4. 收藏与最近继续走用户级复用

这里需要先区分“产品理想语义”和“当前真实存储语义”。

当前代码里：

- 最近使用图标来自 localStorage
- 收藏图标来自当前 `selectedViewProfile.favoriteSharedViewIconIds`

也就是说，**最近** 确实已经是浏览器/用户侧偏好，但 **收藏** 还不是独立用户级真值，而是绑定在当前 view profile 上。

基于这个事实，本方案正式要求 **Automation Settings 与 ViewTabs 完全共用当前已有的收藏与加载状态**，不允许再新增一套 automation 专属偏好配置。

也就是说，直接复用当前已有的：

- `favoriteSharedViewIconIds`
- recent icon localStorage
- loaded icon packs localStorage / runtime state

正式 contract 是：

- `最近`：继续按当前浏览器本地 recent 语义复用
- `收藏`：继续按当前选中 `view profile` 的 `favoriteSharedViewIconIds` 复用
- `加载状态`：继续按当前 shared view icon pack 的本地持久化与运行态复用
- 因此用户切换 `view profile` 后，Automation Settings 中看到的收藏图标集合也会随之变化

原因：

- 用户明确要求两侧完全一致，没有必要保存两份配置
- 当前 shared view 图标体系已经具备收藏、最近、加载三类状态链路
- 当前需求的重点是“复用现有图标能力”，不是“复制一套 automation 偏好模型”

补充边界：

- 这里复用的是“现有图标偏好与加载链路”，不是新增正式独立用户偏好模型
- 自动化规则图标真值仍保存在 `automation profile` 里，不会写回 `view profile`
- 本轮禁止引入 `automationFavoriteIconIds`、`automationLoadedIconPacks`、`automationRecentIconIds` 之类的第二份配置
- 如果后续希望把收藏真正抽成跨 view-profile 的统一用户偏好，应先升级 shared view 现有收藏模型，而不是给 Automation Settings 单独开分支

## 五、建议的交互模型

### 1. 规则卡中的基础信息区

当前：

- `Rule Id`
- `Label`
- `Icon`
- `Skill`

建议改为：

- `Rule Id`
- `Label`
- `Icon`
  - 图标预览按钮
  - 当前图标 id 展示
  - 可选的“清除为默认图标”动作
- `Skill`

### 2. 图标选择流程

推荐流程：

1. 用户点击当前规则的图标预览按钮
2. 打开图标选择器
3. 默认停在：
   - 当前图标所在分组，或
   - `最近`
4. 用户可搜索、切换分组、点选图标
5. 选中后立即更新当前规则 draft
6. 关闭 picker
7. 最终通过“保存自动化设置”持久化

### 3. 空态与默认值

新增规则时，默认图标仍使用：

```ts
"wand"
```

原因：

- 当前已经有默认值
- 与“自动化动作/技能入口”语义匹配
- 不引入新的默认值迁移

### 4. 未加载 pack 的行为

Automation Settings 应沿用 shared view 的正式 contract：

- 当前分组未加载时，显示“该图标包未加载”
- 用户可以手动加载对应 pack
- 如果当前规则已经使用了某个 pack 的图标，应确保能正常回显

但这里还要补一条当前 shared view 没有直接覆盖到的事实：

- 现有 pack 保护链只扫描 shared view 正在使用的图标
- `protectedSharedViewIconPackIds` 当前不会自动把 automation rule icon 算进去

因此，Automation Settings 第一轮必须明确自己的 pack contract：

1. **打开设置页时继续基于同一套 pack runtime 做自动补载**
   - 扫描 `automationProfile.rules[].icon`
   - 解析出对应 pack
   - 若该 pack 未加载，则自动调用现有加载链

2. **Automation Settings 打开期间，当前规则所需 pack 进入不可误卸载保护**
   - 图标包选项中若出现“当前自动化规则正在使用”的 pack，应展示为不可卸载
   - 文案不能继续只写“当前共享视图正在使用”，需要改成更中性的“当前配置正在使用”

3. **保护策略复用同一条 shared view pack runtime 语义**
   - 本轮不新增 automation 专属 loaded-packs 配置
   - 只是在同一套运行态里，把当前 automation rules 引用的 pack 也纳入保护判断
   - 保证用户在编辑 Automation Settings 时，不会因为 pack 状态丢失当前图标回显或误卸载依赖包

这样可以保证：

- 规则里已经选过的 `Tabler` / `Streamline` 图标能稳定显示
- 用户不会在 Automation Settings 里把当前规则依赖的 pack 意外卸载
- 又不会引入第二份 automation pack 配置

这里不建议为 Automation Settings 另开一套简化语义，否则会和 shared view 行为不一致；正确做法是在同一套 shared view icon runtime 上补齐 automation rule 的受保护引用判断。

## 六、组件与实现切口建议

### 1. 不要直接在 App.tsx 里内联实现

当前 `AutomationSettingsDialog` 已经很长，继续把 picker 状态直接写在 `App.tsx` 会进一步恶化可维护性。

推荐拆分：

- `src/components/shared/SharedViewIconPicker.tsx`
  - 通用 picker UI
- `src/components/shared/useSharedViewIconPickerState.ts`
  - 搜索、分组、最近、收藏、pack 状态
- `src/components/automation/AutomationRuleIconField.tsx`
  - Automation Settings 规则卡中的图标字段封装

### 2. 让 ViewTabs 与 Automation Settings 共用同一底座

目标不是“Automation Settings 借用 ViewTabs 的一段 JSX”，而是：

- `ViewTabs` 和 `Automation Settings` 都消费同一个 picker 组件
- 由上层传入：
  - 当前 icon
  - 是否允许收藏
  - 选中回调
  - 关闭回调

这样后续 shared view 图标体系演进时，不会再出现两个界面分叉。

这里还要补一条拆分边界，避免第一轮组件抽取过头：

- **通用层** 负责：
  - 搜索
  - 分组切换
  - recent / favorites 展示
  - pack 加载与候选渲染
- **ViewTabs 专属层** 继续负责：
  - 当前 view id 级别的 open state
  - optimistic view icon 更新
  - view 菜单标题区布局
  - hover preview 的局部菜单协作
- **AutomationSettings 专属层** 负责：
  - 当前 rule 的 `icon` 写回
  - 自动化规则依赖 pack 的自动补载与会话保护
  - Automation Settings 表单内的布局和文案

也就是说，第一轮共享的是 picker 底座，不是把 `ViewTabs` 里的所有交互状态整体搬出来。

### 3. 状态边界

建议按以下层次划分：

- 通用图标体系状态：
  - groups
  - recent
  - favorites
  - loaded packs
- 业务表单状态：
  - 当前 rule 的 `icon`
- 保存状态：
  - 仍由 `AutomationSettingsDialog` 的 `profile` draft 统一管理

也就是说：

- picker 只负责“选什么”
- Automation Settings 负责“把选中的 icon 写到哪条 rule 上”
- 收藏、最近、加载状态都继续由现有 shared view icon runtime 统一负责
- Automation Settings 不保存这三类状态副本

## 七、验证重点

### 1. 状态与保存

至少要验证：

- 选择图标后，当前规则 UI 立即刷新
- 保存后重新打开 `Automation Settings`，图标仍正确回显
- 关闭弹窗但未保存时，行为与当前其它字段保持一致
- 保存后详情面板右上角对应动作按钮能立即使用新图标
- 刷新页面后，详情面板按钮图标与 Automation Settings 中的规则图标保持一致

### 2. 合法值与回退

至少要验证：

- 选择的图标 id 能通过 `validateAutomationProfile(...)`
- 非法 id 不会被新的 picker 主路径写入
- 历史脏数据或未知 icon 仍按现有 normalize / fallback contract 处理

### 3. 分组与搜索

至少要验证：

- `最近 / 收藏 / Micro S / Core S / Tabler S / Micro L / Tabler L / Legacy` 都能在 Automation Settings 中出现
- 搜索行为与 shared view 一致
- 未加载 pack 的空态和加载动作正常
- 打开设置页时，当前规则所需但尚未加载的 pack 会自动补载并正确回显
- 当前规则正在使用的 pack 在设置页中不可被误卸载

### 4. 收藏与最近复用

至少要验证：

- 在共享视图里收藏的图标，Automation Settings 中能看到
- 在 Automation Settings 中选择图标，会进入最近使用
- 不会出现 Automation Settings 和 shared view 各自维护一套最近记录的分裂
- 在 Automation Settings 中收藏/取消收藏后，ViewTabs 图标选择器中能看到同一份结果
- 在任一侧加载或卸载图标包，另一侧看到的是同一套加载状态
- 切换 `view profile` 后，收藏集合跟随变化的行为符合本轮既定 contract

## 八、风险与注意事项

### 1. Dialog 内嵌 Popover 的层级与焦点

Automation Settings 本身是 `Dialog`，picker 如果也走 `Popover`，需要重点注意：

- 焦点陷阱
- 键盘导航
- 滚动裁切
- 关闭时机

这属于实现风险，不是方向风险，但必须在执行期前置考虑。

### 2. 当前 ViewTabs picker 状态偏业务内聚

现在很多 picker 状态仍写在 `ViewTabs.tsx` 内部，直接硬复用难度高。

这意味着第一轮实现的真正工作重点不是“接个按钮”，而是：

**先把 shared view icon picker 从 ViewTabs 业务上下文中抽离出来。**

### 3. 收藏字段命名会带一点语义偏差

当前收藏字段名是：

```ts
favoriteSharedViewIconIds
```

从产品语义看，它已经不只是 shared view 专用，而更接近“用户常用图标”。

本轮可以先复用，不必为了命名立即重构；但后续如果图标体系继续扩展，建议再考虑是否抽成更中性的用户偏好字段。

### 4. 第一轮要明确是否保留高级文本 fallback

当前合法值模型仍然允许任意合法 `SharedViewIconId`。即使主路径改为可视化 picker，也需要在执行前明确：

- 第一轮是“只读 id 展示 + 无文本编辑”
- 还是“保留折叠式高级输入框，供熟悉 icon id 的用户直接输入”

推荐第一轮做法：

- 主路径采用 picker
- 默认只读展示当前 id
- 如需保留高级能力，放到次级“高级编辑”入口，而不是继续把文本输入框放在主表单里

这样可以同时满足：

- 普通用户不再面对工程化字段
- 熟悉 id 的用户仍有受控 fallback

## 九、本轮明确不做

本轮方案明确不做以下内容：

- 自动化规则专属图标收藏体系
- 独立于 `view profile` 的全新图标收藏真值迁移
- 自动化规则专属 loaded packs / recent icons 配置
- 根据 `skill` 自动推荐图标
- 图标颜色自定义
- 图标上传
- emoji 选择
- 条件化图标，例如“运行中自动变色”
- 把 automation rule icon pack 保护永久并入全局 shared view pack runtime contract

这些都不是本轮需求的核心，提前打开只会扩大实现面。

## 十、最终推荐

最终推荐按以下方向推进：

1. 保持 `automationProfile.rules[].icon` 为正式真值
2. 保持自动化规则图标合法值继续复用 shared view icon 体系
3. `Automation Settings` 与 `ViewTabs` 完全共用现有 `收藏 / 最近 / 图标包加载` 状态，不新增第二份配置
4. 从 `ViewTabs` 中抽出通用图标 picker 组件
5. 在 `Automation Settings` 中用图标预览按钮 + picker 取代当前纯文本主输入

一句话总结：

**Automation Settings 不应再维护一个“手填 icon id 的工程字段”或第二套图标偏好配置，而应正式接入与标签视图同源、同状态的图标选择体验。**
