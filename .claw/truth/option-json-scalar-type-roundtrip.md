# 单选与多选的 JSON 原始类型往返

<!-- state: current -->
## 当前行为

Data Editor 的通用选项使用字符串作为 UI 与配置索引键；写回作者 JSON 的值独立保留其字符串或有限数值类型，不根据数字外观推断类型。此合同适用于现有表格、详情及嵌套 schema 选项入口，不包含项目专属字段规则，也不迁移已经损坏的数据。

- `dataValue` 是选项元数据中的实际写入值。仅接受字符串或有限数值，且 `String(dataValue)` 必须等于选项键；前后端配置 normalizer 共同保存这一约束。
- 普通选项从当前数据发现原值；没有数据来源时使用已记录的 `dataValue`。只有配置键而无原值的选项以及新建文本选项保留字符串语义，例如 `"001"` 不转换成数字。
- 数值来源在发生相关编辑时通过 `dataValueNeedsPersistence` 触发类型元数据保存。取消最后一个数值引用、保存并重新打开后，候选仍可依据已保存元数据写回数值。嵌套 schema 的显式选项直接以 schema 真实值为来源，不另行推测。
- 同一个键同时出现数值与字符串（例如 `180` 和 `"180"`）时标记 `dataValueAmbiguous`，禁止选择、键盘确认、编辑菜单及重命名，也不将任一类型升级成配置元数据。当前键模型不能把这两种值当作两个同名候选分别编辑，必须先由作者统一来源数据。
- 鼠标与 Enter 共用实际值解析；草稿变化及选项比较包含原始类型。列缓存签名同时包含 `dataValue`、歧义状态和待持久化资格，避免选项键相同但类型变化时继续使用旧闭包。

### 实现与维护入口

- `src/multiselect-config.mjs`：`buildMultiSelectFieldConfig`、`resolveOptionDataValue`、`normalizeOptionDataValue`、`buildSchemaOptionViews` 负责来源解析、歧义屏障及序列化。
- `src/model/viewConfig.ts`、`src/view-config.mjs`、`src/view-config-client.mjs`：类型声明与双端配置归一化。
- `src/table/OptionFieldEditor.tsx`：选择、创建、菜单、重命名、草稿确认及元数据保存资格。
- `src/table/discrete-value-picker.mjs`、`src/table/table-column-signatures.mjs`：键盘候选与列缓存合同。
- `src/detail/DetailPanel.tsx`、`src/detail/NodeEditorHost.tsx`：详情数据来源及嵌套 schema 适配。
- `docs/05_数据与配置模型.md`：面向使用者的配置说明；本文件维护实现与验证约束。

### 已有验证及限制

2026-11-01 完成记录报告 61 项相关测试、typecheck 与 Vite build 通过；隔离服务实际验证鼠标、Enter、刷新、新页重开、全空后重新选择 `0` / `180` / 负小数、字符串 `"001"` / `"007"`、详情小数及歧义键盘屏障，并核对磁盘值、未编辑字段和内部身份。该结论限定于本次定向验证，不代表所有业务 UI 或全部脏工作树测试均通过。本次知识整理仅核对实现与已有结果，未重跑测试。

维护时优先使用 `tests/option-value-types.test.mjs`、`tests/multiselect-config.test.mjs`、`tests/discrete-value-picker.test.mjs`、`tests/table-column-signatures.test.mjs` 及配置 normalizer 测试。可复用样例与边界说明位于 `tests/fixtures/numeric-options/验证说明.md`；实际 UI 往返验证应使用独立服务及独立 registry，避免将样例状态写入正式项目。
