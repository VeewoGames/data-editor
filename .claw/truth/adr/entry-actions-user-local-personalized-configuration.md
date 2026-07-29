# entryActions 第二版改为双层个人化配置

<!-- document-state: accepted -->

## context

第一版已经验证条目级 Codex 自动化的基础链路成立：

- `DetailPanel` 可以按条目显示动作按钮
- 前端通过 `POST /api/entry-actions/run` 发起动作
- 服务端可以完成白名单校验、handoff 文件写入和固定包装器调用

但第一版把 `entryActions` 放在 `project-registry -> /api/projects -> client` 这一条项目共享配置链上，长期会和第二版目标冲突。

`entryActions` 真正要承载的不是抽象按钮壳，而是用户的自动化意图和当前设备的执行能力。这里有两个不同层级的问题：

- 用户想在哪些条目上看到什么按钮
- 当前这台设备如何把这个按钮真正执行起来

如果继续保留项目共享方向，只会落入两类不可持续状态之一：

- 项目配置不绑定真实执行细节，最终只剩“项目里有按钮，但当前用户或当前设备并不能执行”的空壳动作
- 项目配置直接绑定某个人、某台机器的 skill、路径或本地入口，导致共享配置被个人环境污染，天然不可移植

如果进一步把第二版收成“所有个人配置都完全本地”或“所有个人配置都完全跨设备同步”，同样会失真：

- 完全本地化会丢掉用户跨设备复用自己的动作规则的价值
- 完全跨设备同步又会把某台设备上的执行绑定错误同步到另一台设备

因此第二版体验方案最终收敛为更稳定的长期方向：双层个人化配置。

## decision

### 1. 放弃项目共享 `entryActions` 作为长期产品方向

`project-registry` 中的 `entryActions` 只视为第一版 MVP 的运行时承载，不再作为第二版及后续长期产品形态继续增强。

后续产品和架构设计，不再以“团队共享动作定义”作为目标，也不再围绕 `Project Settings` 扩展这套能力。

### 2. 第二版正式改为双层个人化配置

条目动作配置的长期真值归属拆成两层：

- 用户共享动作规则
- 设备本地执行绑定

第二版不再把“动作规则”和“执行绑定”塞成单层模型。

### 3. 用户共享动作规则负责描述自动化意图

共享规则层至少负责描述：

- `label`
- `icon`
- `targets[]` 中的精确 `{ file, collection }` 对
- `payload.includeRow`
- `payload.includeNeighbors`
- `enabled`

这层适合放在独立于 `selectedViewProfile` 的用户级正式配置面里。

这里进一步固定一条长期约束：目标范围不能再用两组独立的 `files[]` / `collections[]` 笛卡尔式解释。规则命中与设置页展示都必须围绕精确 target pair 展开，否则会重新引入“文件和 collection 分别看起来都命中，但其实不是同一个目标”的歧义。

这里不把“跨设备共享”写成硬承诺。默认只定义它是正式用户配置；是否跨设备共享，由 profile home 或后续部署方式决定。

第一阶段已经把这层具体落成为每项目唯一的 `automation profile` 模块与 API。

这意味着：

- 自动化规则不进入 `UserViewProfile`
- 自动化规则也不参与 `selectedViewProfile` 的切换语义
- 第二版不新增命名 automation profile，而是固定每个项目只有一份 automation profile 真值

### 4. 设备本地执行绑定负责描述当前设备怎么执行

设备本地绑定层至少负责描述：

- 绑定哪个 `provider`
- 绑定哪个 `skill`
- 当前设备是否启用
- 当前设备是否可用

这层明确不跨设备同步。

这层也不使用 `localStorage` 作为长期承载，而应放在独立的本地正式配置面中。

第一阶段已经把这层具体落在 `<project>/.data-editor/local/automation-bindings.json`。

这条路径属于 project-local machine-local 存储边界，读取和保存都与 `DATA_EDITOR_PROFILE_HOME` 解耦，不跟随 view profile 的 profile home 漫游。

### 5. 按钮显示与执行都采用双层判定

第二版中，按钮只有在以下条件同时成立时才应显示并可执行：

- 用户共享动作规则命中当前条目
- 当前设备存在可用的本地执行绑定

系统不再试图统一不同用户的 skill 命名、Codex 入口或本地工作流，也不再假设同一用户跨设备有相同绑定。

### 6. UI 入口从 `Project Settings` 迁出

既然配置归属已经拆为用户层和设备层，第二版正式入口就不能继续挂在 `Project Settings`。

后续实现应提供独立的用户级自动化配置入口，例如 `Automation Settings`、`My Entry Actions` 或等价语义，而不是继续把这套能力伪装成项目设置的一部分。

自动化规则不绑定 `selectedViewProfile`。view profile 负责视图偏好，自动化规则负责个人动作意图，两者语义分离。

### 7. 第二版首批范围只保留双层最小闭环

第二版首批实现只保留：

- 用户级动作配置入口
- 共享规则编辑器
- `target file / target collection` 选择器
- 当前设备绑定编辑器

不把以下能力并入首批重构：

- 结果轮询
- 自动回写
- 运行历史面板
- 模板市场化配置

第一阶段进一步把这个首批范围收窄为“先落新存储与 API，再切运行时真值”。

因此第一阶段明确不做：

- `run-entry-action` 切到新真值
- 旧 `entryActions` 迁移
- `Project Settings` 旧入口清理

这些动作留到后续阶段一次性完成，避免在新存储刚建立时同时维护两套长期真值。

### 8. telemetry 只保留最小必要执行信号

在双层个人化方向下，系统只保留支撑本地执行、排障和最小反馈所必需的 telemetry：

- 顶层执行状态继续使用 `started` / `rejected` / `error`
- 但 `rejected` / `error` 下需要稳定的细分 `reason`，至少覆盖 `binding_missing`、`binding_invalid`、`binding_disabled`、`rule_not_found`、`target_not_matched`、`executor_launch_failed`
- 服务端继续保留 handoff 文件与启动记录这类最小审计产物

第二版不把跨刷新运行态恢复、执行历史、结果轮询或自动回写状态提升为核心协议的一部分。

### 9. 设置页必须承担“缺绑定 / 失效”的可发现性责任

由于详情面板只在“规则命中 + 当前设备绑定可用”时显示按钮，第二版必须在 `Automation Settings` 提供最小状态提示模型：

- 顶部总览：已配置规则数、当前设备已绑定数、缺绑定数、失效数
- 规则级状态：`ready`、`missing_binding`、`invalid_binding`、`disabled_rule`、`disabled_binding`

第二版不要求运行历史面板，但必须保证用户能在设置页直接分辨：

- 规则有没有过来
- 当前设备有没有绑定
- 绑定是不是失效

### 10. 保存链必须采用“服务端严格校验 + 前端最小本地提示”的双层收口

第二版的保存契约固定为：

- `automation profile` 保存时，服务端必须严格校验 `rule id`、`label`、`targets`、`icon` 与重复 `id`
- `automation bindings` 保存时，服务端必须严格校验 provider 白名单、skill 非空与 `enabled` 结构
- 任一非法配置都必须拒绝写入，不允许脏配置落盘后再靠后续读取修补
- `Automation Settings` 在保存前至少要展示一条可读的本地校验提示，并在服务端返回错误时原样回显可理解的错误信息

对应地，读取链允许保留一层 legacy 归一化：如果旧 profile 仍是 `targets.files[] + targets.collections[]` 结构，前后端读取层可以把它迁成新的 target pair 列表；但保存后的正式结构必须收口为 target pair，不能长期保持双真值。

这条合同的长期目标不是把设置页做成完整表单系统，而是保证用户不会只在保存失败后看到一条不可行动的错误。

### 11. `Automation Settings` 的图标选择器必须复用 shared view 图标体系，不再另起自动化专属系统

`Automation Settings` 中每条自动化规则的 `icon` 不再继续作为纯文本工程输入，而是升级为可视化图标选择入口。正式实现方向固定为：

- 第一选择是复用现有 shared view 图标体系，而不是为自动化规则另建一套专属图标系统
- `Automation Settings` 与 `ViewTabs` 在第一版中共用同一套图标 picker 底座
- 收藏、最近使用和图标包加载状态继续沿用 shared view 的现有语义，不新增一份 automation 专属偏好配置
- 落地顺序先做共享组件抽取与状态复用，再把同一 picker 接入 `Automation Settings` 的规则卡

这条决策的核心边界是：`Automation Settings` 只是 shared icon runtime 的消费面，不是第二套图标体系的所有者。任何后续扩展都必须继续沿用 shared view 的图标 registry、加载与持久化合同，不能因为自动化场景不同就重新分叉一套收藏 / 最近 / pack 语义。

### 12. 编辑态规则选择使用原始数组索引，不复用业务 `Rule Id`

`Rule Id` 同时具有可编辑、保存前才严格校验、允许草稿期暂时为空或重复的性质，不能承担
`Automation Settings` 当前规则的 UI 身份。编辑态选择统一由原始 `rules` 数组索引拥有，
搜索结果只携带该索引，新增和删除也必须显式归一化索引。

这项决定只属于设置页草稿状态，不把索引写入 `automation profile`，也不改变 bindings 继续按
合法 `ruleId` 关联的持久化合同。其目的不是把数组顺序升级成业务主键，而是避免用尚未合法化的
业务字段驱动编辑器自身的可达性。

bindings 继续按 `ruleId` 持久化，也意味着编辑态不能只修改 profile：`Rule Id` 改名必须同步
迁移 binding 与状态键，删除必须同步清理，打开、加载与保存前必须剔除 profile 已不引用的孤立
binding。保存判断使用 profile/bindings 的同步 ref 快照，避免 React 异步 state 让界面摘要、
禁用条件与实际提交读取不同版本。该事务允许 id 在草稿期暂时为空，但不降低保存前合法性校验，
也不把 profile/bindings 双保存升级为原子事务。

## alternatives

- 继续用 `rule.id` 作为选择身份：拒绝，因为空值、重复值和字段改名都会让选择失效或指向错误规则。
- 为规则草稿新增并持久化独立 UI ID：拒绝，当前规则只在单个设置会话中需要临时稳定身份，
  引入持久字段会扩大 schema 和迁移成本。
- 使用过滤结果下标：拒绝，因为搜索集合变化后下标不再对应原始规则，删除和详情定位会发生错位。
- 只修改 profile 中的 `Rule Id`、等待保存时再猜 binding 对应关系：拒绝，因为旧键会成为界面
  不可见但仍参与全局校验的孤立 binding，清空再输入还会丢失已选择的 Skill。

## consequences

- 后续实现重心将从“项目共享配置编辑”转向“用户共享规则 + 设备本地绑定”编辑。
- `Project Settings` 中现有 `entryActions` 入口属于过渡性 MVP，而不是长期信息架构。
- 用户跨电脑时，动作规则仍可保留；但新设备需要单独补齐执行绑定。
- 第一阶段的正式持久化边界已经固定为“每项目唯一 `automation profile` + project-local `.data-editor/local/automation-bindings.json`”，后续阶段在此基础上继续接管运行时真值。
- 当前第一版的 `project-registry -> server -> client` 链路只作为一次性迁移来源，不保留长期兼容双读。
- 第二版运行时已切到 profile/bindings 与 proposal-only service；项目级 `entryActions` 不再是执行真值。
- action 是否可执行还必须通过项目 eligibility、policy、authority 与 fencing，不能从 profile/binding
  就绪直接推断。
- 执行反馈与审计继续保持最小面，避免在架构归属切换阶段把历史、轮询和回写一并固化成长期负担。
- 设置页的最小体验收口不是一次性 UI 美化，而是持续要求“保存前可发现 + 服务端可拒绝 + 错误可回显”，避免非法配置混入正式真值。
- `automation profile` 与 `automation bindings` 的读写分层会长期保留：`load` 允许宽松归一化，`save` 必须严格校验。
- 自动化规则的目标范围语义已经固定为 file-scoped collection pair；`$` 只在具体文件上下文里解释，不再单独作为全局目标名使用。
- `Automation Settings` 的图标入口将长期复用 shared view 图标体系，避免为自动化规则维护第二套收藏、最近与 pack 状态。
- 设置页可以继续展示和编辑尚未通过 `Rule Id`、Skill 或目标校验的规则；业务合法性仍由本地 issues
  与服务端保存校验负责，编辑可达性不再依赖这些字段已经合法。
- profile 规则与本机 binding 在草稿期必须同步改键、删除和清理；保存链以同步 ref 快照为准，
  不允许孤立 binding 继续禁用一个表面上合法的规则草稿。

## related code

- `src/App.tsx`
- `src/automation-profile.mjs`
- `src/automation-rule-selection.mjs`
- `src/automation-rule-draft.mjs`
- `src/automation-bindings.mjs`
- `src/detail/DetailPanel.tsx`
- `src/entry-actions.mjs`
- `src/api/client.ts`
- `src/project-context.mjs`
- `src/project-registry.mjs`
- `src/components/ViewTabs.tsx`
- `src/components/icons.ts`
- `server.mjs`
- `src/entry-action-route.mjs`
- `src/entry-action-service.mjs`
- `src/entry-action-eligibility.mjs`
- `tests/automation-rule-selection.test.mjs`
- `tests/automation-rule-draft.test.mjs`
- `docs/plans/2026-07-01-entryActions第二版具体执行方案.md`
- `docs/plans/2026-07-01-entryActions第二版体验方案.md`
- `docs/plans/2026-07-01-详情面板条目级Codex自动化方案.md`
- `.claw/truth/adr/detail-panel-entry-codex-automation-integration.md`

## search terms

`entryActions`、`双层个人化配置`、`automation profile`、`UserViewProfile`、`selectedViewProfile`、`selectedRuleIndex`、`automation-rule-selection`、`automation-rule-draft`、`Rule Id`、`remapAutomationRuleBindingKey`、`pruneOrphanAutomationRuleBindings`、`automation-bindings.json`、`DATA_EDITOR_PROFILE_HOME`、`共享动作规则`、`设备本地执行绑定`、`Project Settings`、`binding`、`payload.includeRow`、`payload.includeNeighbors`、`proposal-only`、`eligibility`

<!-- state: history -->
## Evolution history

<!-- dated: 2026-07-29 -->
### 双层配置接入 proposal-only 执行链

profile 与 machine-local bindings 从存储/可见性真值扩展为 proposal-only service 的输入；执行资格
另由项目/action eligibility 和安全 authority 决定。旧 `run-entry-action` direct-write 脚本退出
生产路径，双层个人化配置决定保持不变。
