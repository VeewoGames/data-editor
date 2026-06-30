# skills `全部` 组叶子标签页布局对齐：优先批量更新 profile `viewLayouts`

status: accepted

## context

本条 truth 记录 `skills.json` 的“全部”标签组内叶子标签页布局不一致时的稳定收口入口。当前这类问题的真值层不是 shared view 结构本身，而是项目 profile 中 `viewLayouts['data/skills.json:skills']` 对各个叶子视图保存的个人布局状态。

在本轮已确认的稳定样本里：

- `C:\Code\Nocturnel\.data-editor\shared-views.json` 中，`data/skills.json:skills` 的“全部”组共有 `41` 个叶子标签页。
- 其中“攻击”标签页对应视图 id 为 `tag-melee-copy-2`。
- 当前实际生效配置位于 `C:\Code\Nocturnel\.data-editor\view-configs\Lans.json` 的 `viewLayouts['data/skills.json:skills']`。

## 结论

1. 当用户要求“把 `skills.json` 的‘全部’组各标签页布局统一到某个参考标签页”时，优先把它视为个人 profile `viewLayouts` 的批量对齐任务，而不是先改 `shared-views.json` 结构。
2. 如果目标只是让同一组内多个叶子标签页共用同一套列布局，稳定做法是选定一个已验证正确的模板视图，然后把其 `hidden`、`wrapped`、`order`、`detailOrder`、`widths`、`overrides` 批量复制到同组其它叶子视图。
3. 这类批量对齐不需要改 shared view 的分组树、叶子数量、filters、sorts、名称或图标；它的边界是“只收口个人布局状态”，不是“重写共享视图结构”。
4. 对 `skills` 的“全部”组，本轮可复用模板是“攻击”页 `tag-melee-copy-2`；其余 `40` 个叶子标签页直接对齐到该模板即可。

## 长期规则

- `shared-views.json` 负责共享视图结构与团队基线定义。
- profile `viewLayouts` 负责浏览器最终使用的个人列布局状态。
- 当问题表现为“同组标签页字段显示顺序、隐藏、换行、详情顺序、列宽不一致”时，优先检查并修正 profile `viewLayouts`，不要默认把 shared 结构当成唯一入口。
- 同一组内若已经存在一个被确认正确的叶子标签页，可以直接把它当作模板进行批量对齐；不需要逐页手工拖拽重排。

## 真实链路

- `src/App.tsx` 读取当前 collection/view 的布局时，会调用 `readViewLayoutState(...)`。
- `src/view-state-storage.mjs` 的 `readViewLayoutState(...)` 会从 profile `viewLayouts` 中取当前 collection/view 的布局状态，并在浏览器侧生成最终使用的列布局。
- `docs/05_数据与配置模型.md` 已明确当前正式布局模型以 `viewLayouts` 为准；`shared-views.json` 与个人布局状态不是同一层职责。

## 本轮稳定例子

- 目标 collection 为 `data/skills.json:skills`。
- “全部”组共有 `41` 个叶子标签页。
- 模板视图为“攻击”页 `tag-melee-copy-2`。
- 批量复制字段为 `hidden`、`wrapped`、`order`、`detailOrder`、`widths`、`overrides`。
- 抽样校验 `tag-spell`、`tag-melee`、`all-copy`、`tag-critical`、`tag-projectile`、`tag-physical`、`tag-ignite` 后，布局签名均与“攻击”页一致。

## 适用边界

- 适用于“同一 shared group 内部，多个叶子标签页只需要共用同一布局模板”的场景。
- 不适用于需要改 shared 分组树、增删叶子视图、调整 filters/sorts 或重构共享逻辑的场景。
- 这条 truth 当前只覆盖 `skills` 的“全部”组个人 profile 布局对齐，不外推为其它组已经同步完成。

## 关联代码

- `src/App.tsx`
- `src/view-state-storage.mjs`
- `docs/05_数据与配置模型.md`
- `C:\Code\Nocturnel\.data-editor\shared-views.json`
- `C:\Code\Nocturnel\.data-editor\view-configs\Lans.json`

## 验证标准

- `shared-views.json` 中目标 shared group 的叶子视图集合已确认。
- profile `viewLayouts['data/skills.json:skills']` 中，除模板视图外的目标叶子标签页都已收到同一份布局字段集合。
- 抽样多个叶子标签页后，`hidden`、`wrapped`、`order`、`detailOrder`、`widths`、`overrides` 与模板视图一致。
- shared view 结构本身未被改动。

## 关键检索词

`skills.json`、`全部`、`攻击`、`tag-melee-copy-2`、`viewLayouts`、`Lans.json`、`profile layout`、`批量对齐`、`hidden`、`wrapped`、`order`、`detailOrder`、`widths`、`overrides`
