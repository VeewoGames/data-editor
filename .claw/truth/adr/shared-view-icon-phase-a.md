# 共享视图图标 Phase A：收藏归属、分层 registry 与 pack 加载边界

status: accepted

## context

共享视图图标 picker 的 Phase A 已完成，核心目标不是把 UI 做成更多变体，而是先把长期会影响数据语义、加载边界和维护成本的三条决策定死：

1. 收藏状态必须归属用户 profile，而不是 shared view 配置本身。
2. 图标体系必须拆成 metadata registry 与 runtime asset registry 两层，而不是继续维持单一 eager registry。
3. Phase A 的 pack 真相源、加载状态和卸载边界必须稳定下来，避免后续在 UI、性能和运行时行为上反复漂移。

本 ADR 只沉淀这些可长期复用的结构性决定，不记录实现过程或阶段性进度。

## decision

### 1. 收藏归属 `UserViewProfile.favoriteSharedViewIconIds`

收藏状态归属 `UserViewProfile.favoriteSharedViewIconIds`，并且沿 profile 持久化链路读写：

- `src/api/client.ts` 定义 `favoriteSharedViewIconIds`
- `src/view-profile.mjs` 负责 normalize / serialize / empty value
- `src/App.tsx` 负责 mutate / save / reload

明确边界：

- 收藏不进入 shared view config
- 收藏不落 `localStorage`
- 无 profile 时禁用收藏写入

### 2. 共享视图图标采用 metadata registry / runtime asset registry 分层

图标系统拆为两层：

- `sharedViewIconMetadataRegistry` 负责保存图标元数据
- `sharedViewIconRegistry` 只保存当前已加载的真实渲染组件

metadata registry 负责承载：

- `id`
- `group`
- `packId`
- `searchText`
- `outputPath`

runtime asset registry 只负责运行时可渲染组件的装载与卸载，不再承担搜索、分组和元数据归档职责。

### 3. Phase A pack 真相源与运行时边界

Phase A 的 pack 真相源固定为：

- `Base`
- `Micro S`
- `Core S`
- `Micro L`
- `Legacy`

对应规则：

- `Base` 使用手写 allowlist，且永远可用
- `Legacy` 使用静态映射真相源
- `Base` 不可卸载
- 其他 pack 仅在当前会话内加载 / 卸载
- pack 加载状态是纯内存会话态，不写 profile、不写 `localStorage`、刷新后回到默认仅 `Base`

## alternatives considered

- 直接把收藏写入 shared view config：会把个人偏好混进团队共享语义，语义边界不清。
- 继续使用单一 eager registry：搜索、分组和渲染会继续耦合，无法建立明确的按包加载边界。
- 把 pack 状态持久化到 profile 或本地存储：会把 Phase A 的实验性加载策略固化成长期用户状态，刷新语义也会变差。

## consequences

- 收藏可以随 profile 文件稳定落盘，并在 reload 后恢复。
- 图标搜索、分组和渲染可以分别演进，未加载图标也能走统一 fallback，而不是依赖“registry 里一定有组件”。
- `Base` 作为最小保底图标集永远保持可用，避免 icon picker 因包卸载而失去基础入口。
- Phase A 的 pack 状态只影响当前会话，便于验证按包加载的性能收益，也避免把实验边界混入长期数据模型。

## phase a execution contract

本轮实施计划已经把 Phase A 的执行边界收束为可复用约束，后续做 Tabler、pack 管理或图标执行任务时应继续沿用：

- Phase A 的正式范围固定为 `最近 / 收藏 / Micro S / Core S / Micro L / Legacy`，不包含 `Tabler S / Tabler L` full set。
- `Base` 必须默认加载且不可卸载；非 `Base` 包只保留会话态加载状态，刷新后回到默认仅 `Base`。
- 计划层必须继续把“搜索可见”和“运行时可渲染”拆成两层，`metadata registry` 与 `runtime asset registry` 不能合并回单一 eager registry。
- `docs/plans/2026-06-24-共享视图图标Phase-A实施计划.md` 不是普通 todo list，而是下一轮代码执行入口，必须显式写出阶段拆分、固定 contract、验收标准、实现顺序与性能采集口径。
- `Tabler` 来源扩展必须作为在现有 Phase A contract 上追加的新来源处理，而不是回头改写 Phase A 的真相源。

### 4. 统一 fallback 与性能基线

Phase A 的未加载图标处理和性能验证也已经收束为固定契约：

- 任何未加载 icon 在 `view tab`、`menu trigger`、`picker card`、`recent` 卡片和 `drag ghost` 上都必须走同一套 fallback，不允许因入口不同而出现不同语义。
- fallback 只负责占位和引导加载，不得直接访问缺失的 runtime asset component。
- Phase A 的性能基线与复测结果必须落盘到 `artifacts/icon-pack-performance/phase-a-baseline.json` 和 `artifacts/icon-pack-performance/phase-a-after.json`，终端输出不能作为唯一证据。
- 性能记录至少覆盖 build 时长、主 bundle 体积、dev health ready 时长、picker 首开时长、单包加载时长与 `EMFILE` 复现情况。

## post-phase-a note

当前运行时已经在这套 contract 上追加了 Tabler 来源，但这不回写 Phase A 的原始范围定义：

- 当前 managed packs 已扩成 `Base / Micro S / Core S / Tabler S / Micro L / Tabler L / Legacy`
- `Tabler S` / `Tabler L` 继续走既有 `metadata registry` / `runtime asset registry` 分层
- “当前共享视图结构正在使用的 pack 不可卸载”这条最小保护，也是追加在现有 Phase A pack 管理边界之上

Tabler 的正式供给链、generated registry、配置归一化与受保护 pack 合同单独沉淀在 `.claw/truth/adr/shared-view-tabler-icon-supply-chain.md`，本 ADR 只保留它与 Phase A 结构的衔接关系。

## closeout round contract

共享视图图标收口轮在 Phase A / Tabler 之后进入长期维护视角时，执行顺序和观测边界已经收敛为稳定 contract：

1. 收口轮的正式优先级固定为：性能复测 -> pack 诊断增强 -> Legacy 治理准备。
2. 性能复测的正式入口固定为 `npm run profile:shared-view-icons`，当前稳定真相源固定为 `tests/.scratch` 下的 `artifacts/icon-pack-performance/shared-view-icons-closeout.json`。
3. pack 管理面板的状态诊断语义已经收敛，`已加载`、`未加载`、`已使用不可卸载` 视为长期 contract，不再按单次实现重新定义。
4. Legacy inventory 的正式入口固定为 `npm run shared-view-icons:inventory-legacy`，当前 `candidateLegacyTightening` 只保留 `json`、`tagsField`、`refresh` 三项。

这组收口规则的含义是：

- 性能结果必须以落盘产物为准，不能把终端输出当成唯一证据。
- pack 诊断只是在既有 contract 上增强可解释性，不再回头修改状态语义。
- Legacy 治理只做 inventory 与最小收窄准备，不把本轮直接扩展成来源重写或大规模迁移。

## closeout round related code

- `package.json`
- `tests/perf/shared-view-icons-profile.mjs`
- `artifacts/icon-pack-performance/shared-view-icons-closeout.json`
- `src/components/ViewTabs.tsx`
- `tests/data-editor.spec.ts`
- `scripts/shared-view-icons/export-legacy-inventory.mjs`
- `artifacts/shared-view-icons/legacy-inventory.json`

## documentation source hierarchy

共享视图图标相关文档后续固定按四层分工维护：

- 总方案：`docs/plans/2026-06-24-共享视图图标收藏与来源分组方案.md`
- 实施计划：`docs/plans/2026-06-24-共享视图图标Phase-A实施计划.md`
- truth：用于沉淀执行后仍需保留、但不属于结构性架构决策的稳定事实
- ADR：用于沉淀长期结构性决策与跨轮次仍要继续沿用的 contract

其中总方案继续保留，但职责正式收窄为上位总方案，只承担背景、目标、范围、整体结构和阶段蓝图，不再承担 `Phase A` 或 `Tabler` 的执行真相源职责。后续若需要回答“当前正式按什么做”，应优先查实施计划与 truth / ADR，而不是把总方案全文当作唯一真相源。

### total plan review rule

后续复核共享视图图标总方案正文时，必须显式按三类处理：

1. 仍有效：继续保留在总方案中，作为背景、目标态或高层结构说明。
2. 已过时：标记为已被后续实施事实或 accepted truth 替代，避免旧执行判断继续污染当前 contract。
3. 应迁移：凡是已经收敛成执行步骤、验证口径、供给链合同或架构决策的内容，迁移到实施计划、truth 或 ADR，而不是继续滞留在总方案正文。

## related code

- `src/api/client.ts`
- `src/view-profile.mjs`
- `src/App.tsx`
- `src/components/icons.ts`
- `src/components/ViewTabs.tsx`
- `tests/view-profile.test.mjs`
- `tests/view-state.test.mjs`
- `tests/data-editor.spec.ts`
- `docs/plans/2026-06-24-共享视图图标Phase-A实施计划.md`
- `docs/plans/2026-06-24-共享视图图标收藏与来源分组方案.md`

## search terms

`favoriteSharedViewIconIds`、`UserViewProfile`、`sharedViewIconMetadataRegistry`、`sharedViewIconRegistry`、`loadSharedViewIconPack`、`unloadSharedViewIconPack`、`Base`、`Micro S`、`Core S`、`Micro L`、`Legacy`、`artifacts/icon-pack-performance/phase-a-baseline.json`、`artifacts/icon-pack-performance/phase-a-after.json`、`unified fallback`
