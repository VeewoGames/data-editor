# runes shared view 分组结构对齐 traits

status: accepted

## context

本条 truth 记录 `C:\Code\Nocturnel\.data-editor\shared-views.json` 中 `data/runes.json:$` 的长期结构收口规则。当前稳定做法是把 `runes` 的 shared view 分组结构对齐到 `data/traits.json:traits`，并把 `traits` 当前 shared view 分组当作布局真值源。

## 结论

1. `data/runes.json:$` 的 shared view 结构应重建为 `全部` + `攻击/伤害/功能/状态/代理` 五个组。
2. 组内叶子视图的 `名称`、`图标`、`filters`、`sorts` 全部沿用 `traits` 对应项，不再单独维护一套偏差版本。
3. `runes` 旧的半成品默认视图，如 `强化`、`Damage`、旧攻击组，不应与新结构并存；收口时应直接清理，避免双结构共存。
4. 这类对齐的判断基准是 `traits` 当前 shared view 分组，而不是 `runes` 旧草稿或旧默认视图状态。

## 关联代码

- `docs/05_数据与配置模型.md`
- `docs/07_校验与保存机制.md`
- `src/App.tsx`
- `src/view/shared-view-structure.mjs`
- `tests/data-editor.spec.ts`

## 验证标准

- JSON 解析通过。
- `data/runes.json:$` 结构摘要只剩 `全部` 和五个目标分组。
- 不再出现旧默认视图与新结构并存。

## 关键检索词

`data/runes.json:$`、`data/traits.json:traits`、`shared-views.json`、`全部`、`攻击`、`伤害`、`功能`、`状态`、`代理`
