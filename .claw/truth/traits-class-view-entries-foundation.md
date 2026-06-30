# traits.json 职业视图条目回填基线

status: accepted

## context

本条 truth 记录 `C:\Code\Nocturnel\data\traits.json` 中“职业”视图条目的长期回填规则。当前稳定入口不是扫描全部 traits 草稿，而是先看 `C:\Code\Nocturnel\.data-editor\shared-views.json` 里 `collection` 为 `data/traits.json:traits` 的视图 `职业`。

## 结论

1. 当用户提到“`traits.json` 的职业视图条目”时，优先检查 `C:\Code\Nocturnel\.data-editor\shared-views.json` 中 `data/traits.json:traits` 的 `职业` 视图筛选条件，而不是先扫全量 traits 草稿。
2. 当前可复用的稳定筛选条件是 `category contains class`，本轮实际消费的职业视图记录固定为 4 条：`fighter`、`mage`、`ranger`、`cultist`。
3. 这 4 条职业特质的 Notion 真值页分别对应：
   - `trait_fighter_base`，名称 `攻守兼备`
   - `trait_mage_base`，名称 `奥术节奏`
   - `trait_ranger_base`，名称 `张弛有度`
   - `trait_cultist_base`，名称 `灵骸供仪`
4. 回填这类职业特质时，优先补齐并校准 `id`、`description_zh`、`level`、`rating`、`budget_left`、`budget_deviation`、`type`、`tags`、`use`、`dev_note`，其中 `description_zh` 以 Notion 页面最终落库文案为准。

## 关联代码

- `C:\Code\Nocturnel\data\traits.json`
- `C:\Code\Nocturnel\.data-editor\shared-views.json`
- `https://app.notion.com/p/355668a98f0d809e8372e46d0b88603e`
- `collection://32b668a9-8f0d-818e-abb1-000bf3a3cb5b`

## 长期规则

- 职业视图的判断基准是 `shared-views.json` 里的 `职业` 视图定义，不是 traits 草稿目录里的临时残留。
- 只要筛选条件没有变，职业视图的稳定消费面就以 `category = class` 这一组为准。
- 新增或修补职业特质时，先对齐 Notion 真值页，再回填本地 JSON，避免把未定稿文案写入长期真值。

## 验证标准

- `shared-views.json` 中 `data/traits.json:traits` 的 `职业` 视图仍然使用 `category contains class`。
- `traits.json` 中职业视图消费到的记录仍然是 `fighter`、`mage`、`ranger`、`cultist` 这 4 条。
- 4 条记录的关键字段与对应 Notion 真值页保持一致，尤其是 `description_zh`。

## 关键检索词

`traits.json`、`职业`、`shared-views.json`、`category contains class`、`fighter`、`mage`、`ranger`、`cultist`、`trait_fighter_base`、`trait_mage_base`、`trait_ranger_base`、`trait_cultist_base`
