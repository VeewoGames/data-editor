# 方案概述

## 1. 总体目标和范围

本方案用于给 `RelationConfigDialog` 的“目标文件”选择增加快速搜索筛选能力，并明确要求与自动化设置里的目标文件筛选共用同一套前端框架，而不是再维护一套独立实现。  
本轮范围只覆盖 relation 配置弹框中的“目标文件”选择器；`目标集合`、`目标主键` 继续保留现有 `Select` 交互，不进入本轮改造范围。  
本轮不改动 relation 配置的数据模型、保存结构、后端接口、文档加载逻辑和主键解析逻辑。

## 2. 各阶段任务概要

### 阶段一：抽离公共 searchable picker
- 主要工作：从自动化目标文件选择器中抽离通用 `Popover + 搜索框 + 列表 + 空态 + 选中回写` 外壳
- 预期成果：形成可被多个业务场景接入的公共组件，而不是继续在 `App.tsx` 内手写一段专用 JSX
- 执行顺序：先稳定公共 API，再迁移现有自动化入口

### 阶段二：自动化目标文件切到公共组件
- 主要工作：保留自动化现有文件候选、筛选 helper 和文案，替换底层 UI 壳为公共组件
- 预期成果：自动化设置行为不变，但不再持有一份专用 picker 结构
- 执行顺序：先替换文件选择器，不扩展到技能选择器或目标集合选择器

### 阶段三：relation 目标文件接入同一组件
- 主要工作：将 `RelationConfigDialog` 的“目标文件”从 `Select` 改为公共 searchable picker
- 预期成果：relation 配置也拥有快速搜索能力，且与自动化共用同一套交互框架
- 执行顺序：保持其余字段不动，只替换目标文件

### 阶段四：验证与收口
- 主要工作：补充针对公共组件复用、relation 搜索选择和自动化回归的验证
- 预期成果：确认 UI 行为一致、保存链路不受影响、没有引入第二套实现
- 执行顺序：先单测，再 E2E 或交互回归

## 3. 整体结构框架

- 公共层：`SearchablePicker` 负责弹层、搜索输入、列表、空态、选中关闭
- 业务层：自动化和 relation 各自负责候选数据、过滤策略、触发器文案、选中后的写回逻辑
- 现有保留层：`loadDocument(...)`、relation 配置保存、自动化 target catalog 构建与筛选 helper 继续留在原业务侧

---

# 背景与证据

当前 relation 与自动化在“目标文件选择”上存在明显不一致：

- [src/components/RelationConfigDialog.tsx](/C:/Code/data-editor/src/components/RelationConfigDialog.tsx:129) 的“目标文件”仍使用 `Select.Root + Select.Item`，没有搜索筛选能力。
- [src/App.tsx](/C:/Code/data-editor/src/App.tsx:6587) 的自动化目标文件选择已经改成 `Popover + input + listbox`，并带有 `筛选文件...` 输入框。
- [src/App.tsx](/C:/Code/data-editor/src/App.tsx:7130) 已经存在 `buildTargetFileOptions(...)`、`describeTargetFileName(...)`、`matchesAutomationTargetFileQuery(...)` 这类目标文件业务 helper。
- [src/styles.css](/C:/Code/data-editor/src/styles.css:1806) 已经存在搜索型 picker 所需的样式壳，但它们仍然绑定在 `automation-*` 语义命名下。

这说明仓库里已经有“可搜索文件选择器”的实际交互形态，但还没有被抽成公共组件。  
如果直接在 relation 里复制自动化那段实现，会把同一类 UI 能力继续散落在两个位置，后续样式、可访问性和键盘行为都要维护两份，不符合本轮“使用同一套框架”的目标。

# 设计目标

1. relation 的“目标文件”支持快速搜索筛选，解决文件列表过长时难以定位的问题。
2. 自动化和 relation 共用同一个 searchable picker 组件，不新增第二套前端框架。
3. 保持业务真值和保存结果不变，本轮只改 UI 交互层。
4. 将改造范围限定在“目标文件”选择，避免为了追求统一把 `目标集合`、`目标主键` 一起卷入本轮。

# 方案选择

## 方案 A：抽通用 `SearchablePicker` 组件，然后分别接入自动化和 relation

这是本轮推荐方案。

特点：
- 公共组件只负责通用交互外壳，不理解 relation 或 automation 业务语义
- 业务侧通过 props 提供候选列表、过滤后的可见项、选中判定、触发器显示和点击回写
- 自动化先迁移到公共组件，relation 再复用同一组件

优点：
- 复用价值最高，后续别的可搜索选择器也可以继续接入
- 自动化与 relation 的业务逻辑仍各自留在原位置，公共层不背业务包袱
- 更容易把样式命名从 `automation-*` 收敛成中性命名

代价：
- 首轮要多做一次“现有自动化 picker UI 抽壳”的整理

## 方案 B：抽业务型 `FileTargetPicker` 组件

不推荐作为本轮主方案。

特点：
- 组件直接知道“目标文件”的业务概念
- relation 与自动化只是在文件候选来源上有所不同

问题：
- 公共层会和“目标文件”语义绑定得过紧
- 如果后续要复用到技能选择器、文档索引选择器或别的 searchable 列表，扩展性会很差

## 方案 C：只共用 helper，不共用 UI

明确不采用。

原因：
- 这等于 relation 再复制一份 `Popover + input + listbox`
- 仍然要维护两套结构和样式，不满足“同一套框架”的目标

# 推荐方案

本轮采用方案 A：抽一个中性的 `SearchablePicker` 公共组件，并只把 relation 的“目标文件”接进去。

推荐理由：

1. 你明确要求“抽公共组件”，这要求复用的是完整交互壳，而不是只共用几个过滤函数。
2. 自动化目标文件已经是最接近最终交互的现成样板，适合作为公共组件的第一位消费者。
3. relation 当前只有“目标文件”存在长列表痛点；`目标集合` 与 `目标主键` 暂时保留 `Select`，可以避免 API 被一次做胖。

# 组件边界设计

## 公共组件职责

建议新增：

- `src/components/SearchablePicker.tsx`

它负责：

- `Popover` 的打开/关闭
- 搜索输入框渲染
- 候选列表容器与空态渲染
- 选择某项后的关闭与 query 清理
- 基础无障碍语义，例如 `role="listbox"`、输入框 `aria-label`、列表 `aria-label`

它不负责：

- 候选数据从哪里来
- 如何匹配搜索词
- 选项显示为文件名、完整路径还是二级说明
- 点击选项后如何更新业务状态

## 建议 props 方向

公共组件 API 应尽量薄，只暴露这类能力：

- `open`
- `onOpenChange`
- `query`
- `onQueryChange`
- `trigger`
- `searchPlaceholder`
- `searchAriaLabel`
- `listAriaLabel`
- `children` 或 `renderOptions`
- `emptyContent`
- `contentClassName`
- `listClassName`

这里的核心原则是：  
公共组件只管理框架，不把“option 结构”强行规定成某一种固定 shape。这样自动化可以继续显示文件 basename，relation 也可以按自己的显示策略接入，而不需要让公共组件理解 `DataFile` 或 `AutomationTargetCatalogItem`。

另外，本轮需要把一个实现边界写死：  
`SearchablePicker` 的 `open` 与 `query` 都必须由业务侧受控传入，公共组件不能把它们内建成自己的长期状态真值。

原因是当前自动化目标文件/目标集合两个 picker 明确共用外部状态：

- [src/App.tsx](/C:/Code/data-editor/src/App.tsx:5722) 的 `targetPickerOpenId`
- [src/App.tsx](/C:/Code/data-editor/src/App.tsx:5723) 的 `targetPickerQuery`
- [src/App.tsx](/C:/Code/data-editor/src/App.tsx:6588) 与 [src/App.tsx](/C:/Code/data-editor/src/App.tsx:6653) 的 `Popover.Root open=...`

这套模型依赖“同一时刻只开一个 target picker，并在关闭时统一清空 query”。  
如果公共组件把 `open/query` 收进内部状态，自动化现有行为会被静默改写，也会削弱 relation 侧后续对弹层状态的可控性。

# 业务接入设计

## 1. 自动化目标文件

自动化目标文件是公共组件的第一位接入者，但其业务 helper 继续留在自动化上下文：

- `buildTargetFileOptions(...)`
- `describeTargetFileName(...)`
- `matchesAutomationTargetFileQuery(...)`

这意味着：

- 文件候选构建逻辑不搬进公共组件
- 搜索匹配规则不搬进公共组件
- 当前选中文件缺失时补入候选列表的容错逻辑继续保留

改造内容只是：

- 把 [src/App.tsx](/C:/Code/data-editor/src/App.tsx:6587) 当前手写的 `Popover.Content` 内部壳，替换成 `SearchablePicker`
- 将样式类名从 `automation-skill-picker-*` / `automation-target-picker-*` 中抽出可通用部分

## 2. relation 目标文件

relation 接入时保持其余逻辑不变：

- 仍然使用现有 `targetFile` 状态
- 仍然在选择文件后重置 `pendingCollection`、`pendingKey`、`targetCollection`、`targetKey`
- 仍然复用现有 `loadDocument(targetFile)` 拉取目标文档模型

变化只在 UI：

- 把 [src/components/RelationConfigDialog.tsx](/C:/Code/data-editor/src/components/RelationConfigDialog.tsx:129) 的“目标文件”从 `Select.Root` 改为 `SearchablePicker`
- 候选来源继续是 `props.files`
- 搜索规则先采用“完整路径 + basename 都可匹配”的轻量规则，与自动化保持一致

# 样式收敛策略

当前样式位于 [src/styles.css](/C:/Code/data-editor/src/styles.css:1806)，但命名偏 automation 专属。  
本轮建议：

- 将通用壳样式提炼成中性类名，例如 searchable picker 的 shell、search input、list、option、empty
- 自动化目标文件如有额外宽度或条目密度需求，再在业务侧补 modifier 类
- relation 直接复用中性样式，不再新增一份 relation 专属样式壳

同时补一个范围约束：  
本轮允许 relation 的目标文件弹层使用比现有 `relation-config-select-content` 更适合搜索列表的宽度，但不顺带修改整个 `[src/styles.css](/C:/Code/data-editor/src/styles.css:5708)` 中 `.relation-config-dialog` 的主宽度定义。  
也就是说，只调整 picker content 的宽度策略，不把这轮需求扩展成 relation 整体弹框改版。

这样做的目标不是“把所有 automation 样式都公共化”，而是只抽出 searchable picker 必需的那部分结构样式。

# 数据与行为边界

本轮明确保持以下行为不变：

- relation 配置保存 JSON 完全不变
- 自动化 target catalog 数据结构完全不变
- 选择文件后的后续加载、校验和默认主键推导逻辑完全不变
- `目标集合` 与 `目标主键` 继续使用当前 `Select`

换句话说，本轮只是在“如何从长文件列表中选中一个值”这一步引入搜索能力，并把这一步的 UI 壳公共化。

# 测试与验证设计

## 测试基线约束

当前仓库主测试基线是 `node --test` + `Playwright`，没有现成的 React 组件测试栈。证据见 [package.json](/C:/Code/data-editor/package.json:1)。  
因此本轮验证策略明确收敛为：

1. 不为了 `SearchablePicker` 单独引入 `@testing-library/react`、`vitest` 或 `jest`
2. 能在现有业务测试中覆盖的交互，不额外新建一套组件测试基础设施
3. 若需要纯函数验证，优先放在已有 `node --test` 覆盖的 helper 层

## 单测 / 纯函数层

若本轮新增了独立 helper（例如 relation 侧的文件匹配函数），至少需要覆盖：

1. 输入 query 后只匹配完整路径或 basename 命中的候选
2. 空 query 时返回全部候选
3. 空匹配时业务层能进入空态分支

## E2E / 交互回归

至少需要补两类验证：

1. relation 配置弹框中，输入文件关键字后能筛到目标文件并成功保存 relation 配置。
2. 自动化目标文件选择仍然能搜索、选择并正确写回，不因公共组件抽离发生行为回归。

这里的重点不是新增一套“searchable picker 专属页面”，而是借现有 relation / automation 流程去验证复用后的真实落地。

另外要把一个测试资产调整显式写进任务边界：  
relation 当前的 Playwright helper `[tests/data-editor.spec.ts](/C:/Code/data-editor/tests/data-editor.spec.ts:91)` 中 `chooseDialogSelect(...)` 硬编码依赖 `.select-trigger` 与 `[role="option"]`，而 `[tests/data-editor.spec.ts](/C:/Code/data-editor/tests/data-editor.spec.ts:53)` 的 `configureRelation(...)` 会直接用它操作“目标文件”。  
因此本轮实现必须同步调整 relation 测试 helper：

- 要么把 `目标文件` 的选择拆成 searchable picker 专用 helper
- 要么把 `chooseDialogSelect(...)` 扩展成同时兼容 `Select` 和 searchable picker

这不是可选优化，而是这轮改造的必要回归工作；否则功能代码一改，relation E2E 会先断。

# 不做项

本轮明确不做以下内容：

- 不把 `目标集合` 改成 searchable picker
- 不把 `目标主键` 改成 searchable picker
- 不把自动化技能选择器一并抽进同一个公共组件
- 不改 relation / automation 的数据结构
- 不新增第二份 relation 专属筛选框架
- 不为了这个组件单独引入新的 React 组件测试框架
- 不把公共组件第一版泛化成服务所有富文本 option 布局的“大一统选择器”

# 风险与防错点

1. `RelationConfigDialog` 当前基于 `Select`，切到 `Popover` 后要注意键盘焦点和默认关闭行为，避免弹框内再开弹层时出现焦点异常。
2. 自动化当前 query 状态是 `targetPickerQuery`，若公共组件接入不当，容易把多个 picker 的 query 串用；需要确保 relation 有自己的局部 query 状态，自动化也继续按当前 open-id 范围清理。
3. 样式如果只复制不重命名，最终会变成“公共组件依赖 automation 命名”，这会把语义重新绑死；本轮应顺手做最小必要的样式中性化。
4. 公共组件若过早为技能选择器那类双行 meta 布局做抽象，会让本轮 API 过胖；第一版应只服务当前“目标文件 searchable list”这类单列文本列表，并通过 `children/renderOptions` 保留最小扩展面。

# 验证标准

1. `RelationConfigDialog` 的“目标文件”支持输入关键字快速筛选。
2. 自动化目标文件与 relation 目标文件共用同一个 searchable picker 组件。
3. relation 配置保存结果与现有 JSON 结构完全一致。
4. 自动化目标文件选择行为不退化。
5. 本轮没有引入 relation 专属的第二套筛选实现。
