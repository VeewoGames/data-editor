# skills `全部` 组公共筛选同步：更新 shared view 本体，保留各叶子 `advancedRoot`

status: accepted

## context

本条 truth 记录 `skills.json` 的“全部”标签组内叶子标签页公共筛选条件不一致时的稳定收口入口。当前这类问题的真值层是 `C:\Code\Nocturnel\.data-editor\shared-views.json` 里的 shared view 本体，不是 profile draft，也不是个人 `viewLayouts`。

在本轮已确认的稳定样本里：

- `data/skills.json:skills` 的“攻击”页视图 id 为 `tag-melee-copy-2`。
- 该视图的公共层条件位于 shared view 本体：`sorts` 为 `sort: dev_status asc`，`filters.topLevelRules` 包含 `owner contains player` 与 `skill_category contains general`。
- 各叶子标签页自己的标签语义仍由 `filters.advancedRoot` 承接，例如 `spell`、`melee`、`ranged`、`critical`、`ignite`。

## 结论

1. 当用户要求“把 `skills.json` 的‘全部’组其他标签页同步攻击页的公共筛选条件”时，优先把它视为 shared view 本体的批量同步任务，而不是 profile 布局对齐任务。
2. 稳定做法是以“攻击”页 `tag-melee-copy-2` 为模板，只批量复制公共层 `sorts` 与 `filters.topLevelRules` 到同组其它叶子标签页。
3. 同步公共层时必须保留每个标签页原有的 `filters.advancedRoot`，不能用模板页的标签过滤覆盖各页专属语义。
4. 这类同步不涉及 profile layout、shared view 分组树、叶子数量、名称、图标或标签专属过滤重写；边界是“统一公共层条件”，不是“重建整组结构”。

## 长期规则

- `shared-views.json` 负责 shared view 的团队基线结构、公共筛选与排序定义。
- profile `viewLayouts` 负责个人列布局状态，不承接这类公共筛选同步。
- 同组叶子标签页如果只需要共享一套公共入口条件，应复制 `sorts` 与 `topLevelRules`，同时保留各自 `advancedRoot`。
- 看到某页缺少 `owner contains player`、`skill_category contains general` 或 `dev_status asc` 这类公共层条件时，优先检查 shared view 本体，不要先怀疑 profile draft。

## 真实链路

- `C:\Code\Nocturnel\.data-editor\shared-views.json` 是本轮公共筛选真值源。
- `src/shared-views.mjs` 负责加载和保存 `<project>/.data-editor/shared-views.json`。
- `src/App.tsx` 通过 `loadSharedViews(...)` / `saveSharedViews(...)` 进入 shared view 配置链路。
- `src/view/view-state.mjs` 的 `mergeSharedViewWithDraft(...)` / `saveSharedViewDraftsToConfig(...)` 说明 shared view 正式配置与 draft/profile 是分层关系，不应把本类 shared base 同步误判成个人布局问题。
- `docs/05_数据与配置模型.md`、`docs/07_校验与保存机制.md` 已明确 shared view 正式配置与 profile/layout 的职责边界。

## 本轮稳定例子

- 模板视图为“攻击”页 `tag-melee-copy-2`。
- 批量同步字段为 `sorts` 与 `filters.topLevelRules`。
- 抽样 `tag-spell`、`tag-melee`、`tag-ranged`、`tag-critical`、`tag-ignite-copy-3` 后，公共层均已具备 `owner contains player`、`skill_category contains general`、`sort: dev_status asc`。
- 上述抽样页的 `advancedRoot` 仍分别保留 `spell`、`melee`、`ranged`、`critical`、`ignite` 等标签过滤。

## 适用边界

- 适用于“同一 shared group 内部，多页应共享同一套公共筛选/排序基线，但保留各自标签过滤”的场景。
- 不适用于字段隐藏、列顺序、列宽、换行、详情顺序等个人布局问题；这些仍应优先走 profile `viewLayouts`。
- 不适用于重排 shared 分组树、增删叶子视图或整体改写标签 taxonomy 的场景。

## 关联代码

- `C:\Code\Nocturnel\.data-editor\shared-views.json`
- `src/shared-views.mjs`
- `src/App.tsx`
- `src/view/view-state.mjs`
- `docs/05_数据与配置模型.md`
- `docs/07_校验与保存机制.md`

## 验证标准

- `tag-melee-copy-2` 的公共层条件已确认来自 `shared-views.json` 本体，而不是 profile draft。
- 同组目标叶子标签页均收到同一份 `sorts` 与 `filters.topLevelRules`。
- 抽样多个标签页后，公共层与模板页一致，但各自 `advancedRoot` 仍保留标签专属过滤。
- shared view 分组结构未被改写，profile layout 未作为本轮同步目标。

## 关键检索词

`skills.json`、`全部`、`攻击`、`tag-melee-copy-2`、`shared-views.json`、`topLevelRules`、`advancedRoot`、`dev_status`、`owner contains player`、`skill_category contains general`、`公共筛选`、`批量同步`
