# 文档合同与嵌套 Schema

## 概述

Data Editor 将 JSON 与 CSV 作为通用数据文档处理。项目可通过 capability manifest 声明 `document-contract-v1` 与 `nested-schema-v1`，为匹配的文档提供保存校验和嵌套对象编辑结构；编辑器不内置任何项目领域、文件名或节点类型规则。

## 文档合同保存

客户端在保存前读取匹配文档的 admission token，服务端在提交前和写入后重新校验该 token 与候选内容。未声明合同的文件仍按通用 JSON/CSV 路径保存。

## 嵌套 Schema

`nested-schema-v1` 以 data source、文档相对路径、集合、根字段和嵌套路径匹配对象。匹配后由项目声明的 schema 决定字段、判别字段及默认值；未匹配对象显示通用回退界面。

## 项目职责

项目拥有其领域 schema、展示文本、校验和派生规则。Data Editor 只负责加载已声明的 capability，并提供通用读写、文档合同校验与嵌套数据编辑能力。

## 候选创建行 Schema

候选创建动作使用 `.data-editor/entry-action-contracts.json` 中 `createAuthority.rowSchema` 校验最终新行；它是候选创建通道的受限 JSON Schema，与上述 capability 分别配置。

对象可声明非空 `allOf` 数组，其中每条规则只允许以下结构：

```json
{
  "if": {
    "properties": { "kind": { "const": "advanced" } },
    "required": ["kind"]
  },
  "then": { "required": ["tier"] }
}
```

`if.properties` 中每个选择字段只允许 `const` 或非空、无重复值的 `enum`；值必须符合该字段自身的 schema。`if.required` 必须恰好列出全部选择字段；多个选择字段同时匹配才触发，缺少选择字段不触发。`then.required` 是非空、无重复项的字段列表。所有字段名必须来自当前对象的 `properties`，多条命中规则的必填要求累积。未知关键字、拼错引用和非法值均拒绝；此入口不接受任意 JSON Schema 扩展。

模型输入片段先校验已有字段值；顶层条件必填要求延后至服务器默认值、身份及人工备注补齐后，统一校验最终完整行。因此服务器字段既可参与条件，也可被条件要求。字段可选不代表可以提供非法类型或枚举值；条件也不改变模型字段、服务器字段与人工备注的写入权限。
