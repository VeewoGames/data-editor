# ADR: 项目文档合同所有权与保存门禁

<!-- document-state: accepted -->
<!-- state: accepted -->

## Context

具体领域节点及约束属于项目，通用编辑器不能定义第二套结构，也不能在已声明合同不可用时用旧静态schema继续写入。历史业务接入验证出的通用价值，是项目所有权、失败关闭、并发一致性和跨部署形态一致性。

当前能力通过 `.data-editor/project.json` 与enrollment进入通用registry：文档保存约束使用 `document-contract-v1`，节点展示与编辑结构使用 `nested-schema-v1`。两类能力分别声明、按真实文档身份匹配；它们不固定业务文件名或某组领域字段。

## Decision

### 1. 合同由项目声明并维护

`src/project-capability-manifest.mjs` 和 `src/project-capability-registry.mjs` 负责声明、资源与generation状态。`src/document-contract-service.mjs` 只读取active binding指定的合同及meta-schema，执行JSON解析、schema、版本及受支持语法校验，再交通用compiler解释。

字段、variant、默认值、约束和派生含义属于项目；编辑器只加载、解释、呈现、校验与保存，不维护具体领域的平行静态定义。没有声明合同的通用JSON/CSV文档保持通用保存；已经声明但失效的能力不能被当作“未声明”绕过。

### 2. 失败关闭与能力分层

合同缺失、资源损坏、版本/语法不合法或capability不可用时，拒绝依赖该合同的保存；不能恢复旧静态schema或通过完整JSON编辑绕过。nested未匹配结构按通用只读fallback承接，不能据fallback重新授予业务写权限。

文档合同校验与nested展示不互相替代：UI能显示不证明候选合法；UI只读也不代替服务端保存门禁。项目先演进受支持合同/声明，再由编辑器解释，编辑器不先行发明领域字段。

### 3. 使用当前documentContracts admission集合

保存客户端读取匹配文档的 `documentContracts` token集合；服务端要求与当前解析结果精确相等。当前每项由 `contractId`、`generation`、`manifestDigest`、`contractDigest`、`compiledContractDigest` 和 `version` 绑定，按contractId排序。

项目身份由请求project context和registry共同确定；token不是可跨项目复用的业务授权。命中合同而缺token、token陈旧或多/少成员均拒绝；未命中合同却附带非空token同样拒绝。普通文档ETag/idempotency门禁与合同admission是不同约束，应共同保留。

`src/document-contract-compiler.mjs` 校验候选并生成admission snapshot；保存的提交前与替换后重新解析capability/合同并验证同一snapshot及候选。合同或generation漂移不能只在前端提示，须由服务端拒绝并沿既有保存恢复语义处理。

### 4. 派生输出、视图与迁移保持同一交付闭环

项目合同声明的派生输出由通用compiler计算，展示和旧引用迁移必须和合同演进一起核对。不能只改schema而遗漏view/profile/local草稿中的引用，也不能把某组历史领域派生字段名固定为所有项目的产品规定。

### 5. 接入形态不决定合同含义

通用能力不以仓库物理位置、submodule或某个游戏是否在本机存在决定。测试使用独立项目fixture，覆盖项目合同读取、nested解释、候选校验、保存拒旧与视图引用；真实项目只作为明确选择的附加集成验证，不是产品默认依赖。

## Consequences

- 项目保有唯一领域authority；编辑器保有通用admission、校验和保存owner。
- 客户端与服务端共同维护新鲜token和候选一致性，不能仅凭UI加载成功或某次HTTP成功声明保存链可靠。
- 旧业务文档根版本字段、旧saveToken形状和固定业务路径不再是通用协议；历史材料不得用于恢复已退出通道。
- 验证至少覆盖service/compiler、capability、nested宿主、保存、派生与引用迁移，不能只检查表单可见性。

## Alternatives

- 合同故障时回退旧静态业务schema：形成双真值并允许过期结构写回，拒绝。
- 只依赖前端版本判断：无法阻止跨项目请求、合同并发变化及请求篡改，拒绝。
- 把特定检出路径和真实游戏数据作为正式测试前提：混淆部署形态与领域所有权，拒绝。

## References

- [当前通用合同总览](C:/Code/data-editor/docs/11_文档合同与嵌套Schema.md)
- [capability manifest](C:/Code/data-editor/src/project-capability-manifest.mjs)
- [capability registry](C:/Code/data-editor/src/project-capability-registry.mjs)
- [合同资源加载](C:/Code/data-editor/src/document-contract-service.mjs)
- [token集合、候选与替换后校验](C:/Code/data-editor/src/document-contract-compiler.mjs)
- [客户端保存](C:/Code/data-editor/src/api/save-documents.mjs)
- [服务端保存门禁](C:/Code/data-editor/server.mjs)

<!-- state: history -->
## Evolution history

<!-- dated: 2026-10-25 -->
### 旧业务接入来源

本文件原题为“skills Targeting 项目级合同与保存门禁”。原业务字段集合、旧合同路径、文档根版本字段、旧token及submodule验收要求仅由[项目历史索引](C:/Code/Nocturnel/.claw/truth/tech/data-editor/编辑器侧项目知识承接与历史索引.md)承接，[原字节对象](C:/Code/Nocturnel/docs/records/data-editor知识迁回来源/2026-10-25/objects/fb54e64de898b4af073e13608df8e743cb846990f232e7d52a0eec524fd87845.source)完整保存。该历史不定义当前游戏结构，也不恢复旧业务保存通道。
