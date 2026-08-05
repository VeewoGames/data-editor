# 文档合同与嵌套 Schema

## 概述

Data Editor 将 JSON 与 CSV 作为通用数据文档处理。项目可通过 capability manifest 声明 `document-contract-v1` 与 `nested-schema-v1`，为匹配的文档提供保存校验和嵌套对象编辑结构；编辑器不内置任何项目领域、文件名或节点类型规则。

## 文档合同保存

客户端在保存前读取匹配文档的 admission token，服务端在提交前和写入后重新校验该 token 与候选内容。未声明合同的文件仍按通用 JSON/CSV 路径保存。

## 嵌套 Schema

`nested-schema-v1` 以 data source、文档相对路径、集合、根字段和嵌套路径匹配对象。匹配后由项目声明的 schema 决定字段、判别字段及默认值；未匹配对象显示通用回退界面。

## 项目职责

项目拥有其领域 schema、展示文本、校验和派生规则。Data Editor 只负责加载已声明的 capability，并提供通用读写、文档合同校验与嵌套数据编辑能力。
