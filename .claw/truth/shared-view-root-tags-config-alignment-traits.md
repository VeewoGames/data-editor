# shared view 根目录 tags 配置对齐 traits

status: accepted

## context

本条 truth 记录 `C:\Code\Nocturnel\.data-editor\view-config.json` 的长期收口规则。该共享配置的根字段实际是 `fields`，不是 `fieldConfigs`。当前稳定基准是 `data/traits.json:traits` 里的 `input_tags`、`output_tags`、`tags` 配置。

## 结论

1. 根目录共享 view 的 `input_tags` / `output_tags` / `tags` 配置，应以 `data/traits.json:traits` 的对应字段为基准对齐。
2. 这次批量对齐只改共享 `view-config.json`，不改 `data` 下业务 JSON 内容。
3. 只处理 `C:\Code\Nocturnel\data` 根目录文件，不包含子目录。
4. 本次验证范围内的 19 个目标字段配置已全部与 `traits` 对应字段一致。

## 作用范围

- `data/affixes.json:affixes:{input_tags,output_tags,tags}`
- `data/affixes_mechanic.json:affixes_mechanic:{input_tags,output_tags,tags}`
- `data/classes.json:$:{input_tags,output_tags,tags}`
- `data/equipment_bases.json:bases:{input_tags,output_tags,tags}`
- `data/runes.json:$:{input_tags,output_tags,tags}`
- `data/skills.json:skills:{input_tags,output_tags,tags}`
- `data/status_effects.json:$:tags`
- `data/traits.json:traits:{input_tags,output_tags,tags}`

## 关键检索词

`C:\Code\Nocturnel\.data-editor\view-config.json`、`fields`、`fieldConfigs`、`data/traits.json:traits`、`input_tags`、`output_tags`、`tags`、`affixes`、`affixes_mechanic`、`classes`、`equipment_bases`、`runes`、`skills`、`status_effects`
