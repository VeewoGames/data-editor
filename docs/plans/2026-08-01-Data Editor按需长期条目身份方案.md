---
status: superseded
authority: docs/plans/2026-08-01-Data Editor通用化与夜曲解耦方案.md#阶段-3通用-document-contract-v1-保存门与按需长期条目身份专项
---

# Data Editor 按需长期条目身份方案（历史设计依据，已并入总任务）

> 状态：本文件自 2026-08-01 起仅保留身份专项的事实、推演与术语依据，不再是可独立执行的实施计划。
> 唯一实施计划真值为[《Data Editor 通用化与夜曲解耦方案》](<2026-08-01-Data Editor通用化与夜曲解耦方案.md>)的“阶段 3.2
> 独立工作包：Data Editor 按需长期条目身份”。任何实施必须遵守该总方案的 capability/save-guard 前置、serial owner
> handoff、阶段顺序与授权边界；本文件中的 Phase 顺序不能单独触发实现。正文中保留的 Phase、验收和决策均为
> 历史推演，不再承载规范性实施要求；已提升的安全门以总方案为准。

## 概述

### 1. 总体目标和范围

本方案将 Data Editor 的条目身份从“打开数组文档时为所有条目自动写入 `__entry_id`”调整为“普通编辑只使用会话内 RowId，只有首次实际执行 Entry Action 或其他明确声明 `requiresDurableIdentity` 的能力时，才按需为目标条目建立长期身份”。

总体目标是同时满足以下要求：

1. Data Editor 作为通用工具打开任意 JSON 或 CSV 时默认零侵入，不因浏览文件而改变项目正式数据。
2. 搜索、筛选、排序、详情编辑、拖动重排、复制和删除继续获得会话内稳定定位，不因取消全量 `__entry_id` 而降级。
3. Entry Action 的异步执行、proposal、延迟提交、结果恢复和崩溃 recovery 仍只使用不可漂移的长期身份，禁止以 `sourceRowIndex` 作为提交回退。
4. “什么时候需要长期身份”与“长期身份保存在哪里”分离：能力只声明需求，具体由通用 `IdentityProvider` 选择内嵌字段、项目正式主键或 sidecar。
5. 与《Data Editor 通用化与夜曲解耦方案》的声明式 capability 方向一致，不恢复 `adapter`，不把任何具体游戏的文件路径或业务结构写入 Data Editor 通用核心。

本方案覆盖目标架构、身份生命周期、首次升级事务、Entry Action 准入、provider 能力、迁移阶段、验证矩阵、风险、停止条件和依赖关系。方案本身不授权修改 runtime、数据、测试、Truth、ADR、用户 registry 或消费项目，也不授权提交或推送。

### 2. 各阶段任务概要

1. **冻结现状与迁移证据**：审计当前 `__entry_id` 的 producer、consumer、Entry Action journal/recovery 引用和严格数据合同，形成可追溯 disposition。
2. **建立会话身份核心**：让无长期身份的数组条目获得只存在于当前文档会话的 RowId，并取消“打开即补种、补种即 dirty”的全局行为。
3. **先建立身份 capability**：将 `identity-policy-v1` 纳入首版 capability 基座，按项目和 data source 隔离 provider、保护字段与 generation。
4. **建立长期身份升级事务**：以 action authority、fencing、ETag、目标摘要、幂等键、文件锁和 durable journal 保护单条 promotion；升级完成前不得启动异步动作。
5. **接入 Entry Action 准入**：Entry Action 引擎固有要求 durable identity；完成 canonical reload 后，handoff、proposal、commit 和 recovery 只接受 durable RowId。
6. **扩展声明式 IdentityProvider**：首版以 `embedded-v1` 验证主链，再接 `declared-key-v1`；`sidecar-v1` 等待真实消费者，通用核心不加载项目可执行代码。
7. **迁移既有数据与权威说明**：按审计结果决定保留或治理历史 `__entry_id`，同步文档、Truth、ADR 和消费项目合同；未经批准不物理删除任何既有 ID。
8. **完成联合验证与发布交接**：验证通用工具独立运行、Entry Action 安全闭环、消费项目数据结构和 clean-clone 重建，按 owner 串行交付。

执行顺序必须遵守“先建立会话身份与 identity policy，再建立升级事务并接入 Entry Action；先稳定通用 provider 合同，再迁移消费项目；先审计历史引用，再决定旧 ID 去留”。

### 3. 整体结构框架

```text
DocumentModel
  └─ Collection rows
      └─ RowHandle
          ├─ sessionRowId          当前会话内稳定，所有条目都有
          ├─ durability            session_only | promoting | durable | recovery_pending | conflicted
          └─ durableIdentity?      仅需要长期定位的条目拥有

普通表格能力
  └─ 只消费 sessionRowId
      ├─ 搜索 / 筛选 / 排序 / 虚拟列表
      ├─ 选择 / 详情 / 校验
      └─ 编辑 / 重排 / 复制 / 删除

requiresDurableIdentity 能力
  └─ DurableIdentityCoordinator
      ├─ identity policy + capability generation
      ├─ action authority + fencing admission
      ├─ document commit mutex
      ├─ baseDocumentEtag
      ├─ sourceRowIndex + expectedRowDigest（仅升级前使用）
      ├─ identity_promotion journal + idempotencyKey
      └─ IdentityProvider
          ├─ declared-key-v1
          ├─ embedded-v1
          └─ sidecar-v1（后续阶段）
              ↓
          promotion receipt + canonical reload
              ↓
          durable rowId + canonical ETag
              ↓
          Entry Action handoff / proposal / commit / recovery
```

## 一、问题定义与当前事实

### 1. 当前机制把长期身份变成了所有文档的默认副作用

当前 `src/App.tsx::openDocumentAt(...)` 在加载文档后调用 `ensurePersistentEntryIds(...)`。缺失 `__entry_id` 的数组条目会被直接补种，文档被标记为 dirty，并进入后续自动保存。新增和复制数组条目也会生成持久 ID。

该机制解决了 Entry Action 跨时间写回的目标漂移，但同时造成以下通用性问题：

- 只读浏览也可能修改文件；
- 严格业务 schema 可能拒绝额外字段；
- CSV 会出现额外内部列；
- 项目正式数据与工具内部身份被迫共享同一数据形状；
- 大量从未使用异步自动化的条目承担了不必要的长期身份成本。

### 2. 当前真正需要跨重载身份的业务范围有限

按当前代码，Entry Action 的启动、proposal、提交日志、重新读取、结果恢复和 recovery 都要求稳定 `rowId`。这些步骤可能跨越页面生命周期、进程生命周期和文件重新保存，不能以行号定位。

其他现有能力主要只需要会话内稳定身份：

| 能力 | 会话 RowId | 长期身份 | 说明 |
| --- | --- | --- | --- |
| 搜索、筛选、排序、虚拟列表 | 必需 | 不必需 | 只需当前 DocumentStore 内不漂移 |
| 选择、详情、嵌套导航、校验 | 必需 | 不必需 | 当前页面不会恢复具体选中 rowId |
| 单元格与详情编辑 | 必需 | 不必需 | 保存由文档 ETag 保护 |
| 拖动重排 | 必需 | 不必需 | 重排结果是正式数组顺序，重载后可生成新会话身份 |
| 新增、复制、删除 | 必需 | 不必需 | 操作结束后结果已进入文档内容 |
| relation/backlink 基本导航 | 有益 | 当前不强制 | 正式定位主要使用项目业务主键 |
| 主键改名同步 | 计划中携带 | 当前未使用 | 当前应用 rewrite 仍按快照 `rowIndex`，属于待治理安全债务 |
| Entry Action 异步执行与 recovery | 必需 | 必需 | 必须跨重新读取定位同一条记录 |

### 3. 需要避免的两个错误极端

1. **删除所有长期身份**：Entry Action 将失去可证明的目标定位，回到并发错写风险。
2. **继续全量补种**：Data Editor 无法成为默认零侵入的通用工具，严格消费项目仍会受内部字段影响。

推荐方向是按业务风险分层，而不是在两个极端之间二选一。

## 二、设计目标、非目标与长期规则

### 1. 设计目标

- 无配置项目打开文件后保持磁盘内容不变。
- 所有表格能力统一消费 `RowHandle`，不直接判断 `__entry_id` 是否存在。
- 只有声明 `requiresDurableIdentity` 的能力可以请求长期身份。
- 首次升级是一个可恢复、幂等、文件级串行的正式写事务。
- 升级完成后，Entry Action 的全部后继链只接受 durable RowId。
- durable identity 一旦建立就永久保留，不因功能关闭、规则删除或任务结束而回收。
- 业务主键、编辑器身份、文档 ETag 和文件锁各自承担独立职责，不互相替代。

### 2. 非目标

- 不把 Data Editor 改造成数据库或在线多人服务。
- 不在本方案引入 CRDT、自动合并或跨分支身份协调服务。
- 不要求所有项目采用 `__entry_id`。
- 不以内容 hash 作为长期身份；内容可编辑，hash 只用于首次升级前的短期核对。
- 不把 `sourceRowIndex`、当前排序位置或界面可见行号重新包装成长期身份。
- 不在通用核心加载项目 JavaScript、TypeScript、Godot 脚本或其他可执行插件。

### 3. 长期规则

1. session RowId 只证明“当前文档会话中的同一行”，不能进入异步 handoff。
2. durable RowId 证明“跨保存、跨重载和 recovery 的同一条记录”，必须唯一、不可变且可重新解析。
3. 首次升级前允许临时使用 `sourceRowIndex`，但必须同时绑定完全一致的 `baseDocumentEtag` 和 `expectedRowDigest`；任一漂移都拒绝升级。
4. 首次升级成功后，任何提交或 recovery 都不得回退 `sourceRowIndex`。
5. 复制条目不得继承源条目的 durable identity；副本保持 `session_only`，直到自身首次需要升级。
6. durable identity 不执行自动垃圾回收；删除整个业务条目时，它才随条目或对应 sidecar 记录一起删除。

## 三、身份模型与状态机

### 1. RowHandle

建议将当前散落的 `rowId` 语义收敛为统一 RowHandle：

```ts
type RowIdentityDurability =
  | "session_only"
  | "promoting"
  | "durable"
  | "recovery_pending"
  | "conflicted";

type RowHandle = {
  sessionRowId: string;
  durability: RowIdentityDurability;
  durableRowId: string | null;
  sourceIndex: number;
  sourceKey: string | null;
};
```

`sessionRowId` 是 UI、DocumentStore 和普通 writeback 的统一键。`durableRowId` 只在 provider 成功解析或升级后存在。普通组件不得把二者混写为一个不透明字符串后自行猜测持久性。

### 2. 状态转换

```text
打开无长期身份条目
  -> session_only

能力请求 requiresDurableIdentity
  -> promoting
      -> durable       升级事务成功并重读验证
      -> session_only       在 replace 前因 ETag/摘要/合同门失败，正式数据零变化
      -> recovery_pending   已建立 commit intent，无法证明 replace/receipt 是否完成
      -> conflicted         恢复后仍无法安全归因磁盘或 sidecar 状态

打开已有合法长期身份条目
  -> durable

复制 durable 条目
  -> 新副本 session_only

删除 durable 条目
  -> 条目和其身份共同删除
```

`recovery_pending` 与 `conflicted` 都禁止 Entry Action、自动写回和身份修复猜测。前者只允许使用原
`idempotencyKey` 进入正式 journal recovery；后者只允许刷新、查看诊断或进入明确的人工恢复流程。

## 四、首次长期身份升级事务

### 1. 请求合同

首次执行 Entry Action 前，前端提交身份升级请求：

```json
{
  "projectId": "<registry-project-id>",
  "actionId": "<entry-action-id>",
  "sourcePath": "<virtual-source-path>",
  "collectionPath": "<collection-path>",
  "sourceRowIndex": 12,
  "baseDocumentEtag": "<etag>",
  "expectedRowDigest": "<canonical-row-digest>",
  "idempotencyKey": "<uuid>"
}
```

`sourceRowIndex` 只在尚无 durable identity 的首次升级窗口内有效。它不能被保存进 Entry Action proposal 作为后续目标定位回退。
`actionId` 只用于服务端取得并固定 action authority、binding、target 和 durable requirement；客户端不能用它扩大
identity policy 的匹配范围。非 Entry Action 的未来能力应通过 Data Editor 内置 capability id 进入同一 preflight，
不得伪造 action。

### 2. 服务端执行顺序

1. 解析 project context、canonical physical file identity、collection 和当前 capability generation。
2. 服务端验证 action 已启用、binding ready、target 命中，并确认该能力固有要求 durable identity；同时解析唯一匹配且合法的 identity policy。
3. 创建 action authority snapshot，取得该 canonical file 的 fencing admission；未准入前不得写入身份。
4. 在文档正式 writer/commit mutex 内重新读取当前文件，并再次确认同文件没有冲突的在途 writer/action owner。
5. 比较当前 ETag 与 `baseDocumentEtag`；不一致则返回 stale，不生成 ID。
6. 按 `sourceRowIndex` 读取目标，并比较 canonical row digest；不一致则拒绝。digest 由服务端随文档加载结果提供，固定使用 canonical JSON 值编码；排除 session Symbol、`__rowId` 和 `__rowIndex`，但包含所有正式业务字段和已有 provider 字段。CSV 先按正式 parser 得到行对象，再使用同一编码。
7. 调用当前 collection 的 IdentityProvider：
   - 已存在合法 durable identity：返回现有身份；
   - 缺失：生成或建立新身份；
   - 非法、重复或歧义：进入 conflict，零写入。
8. 在候选文档或 sidecar 上验证 ID 格式、唯一性和不可变规则，并执行该文档命中的完整 document contract/save guard；技术身份写入不得使用绕过业务合同的后门 writer。
9. 建立 `identity_promotion` journal intent，通过 journaled commit 原子替换正式写入目标；生成新的 document ETag。
10. 重新读取并按 durable identity 验证只命中一次，持久发布 promotion receipt。
11. 服务端重新读取 canonical document，用 durable RowId 重建目标 context；不能只信任 promotion 前的 row 或 ETag。
12. **历史顺序，已废止：** 本段曾要求服务端直接创建 handoff。正式 authority 已改为总方案中的两阶段协议：先返回
    receipt、pending action token 与 canonical snapshot/new ETag，前端重建成功并 ACK/start 后，服务端才创建 handoff/run。

### 3. 并发与崩溃语义

- 同一物理文件的两个升级请求必须串行；即使目标条目不同，也不能并发整文件替换。
- 同一 `idempotencyKey` 重试必须返回同一 promotion receipt，不能生成第二个 ID。
- 两个不同请求竞争同一无 ID 条目时，只允许一个在原 ETag 上成功；另一个返回 stale 并刷新。
- ID 已保存但 Entry Action 尚未启动时进程崩溃，保留该 durable identity。它是安全的已完成升级，不执行回滚或删除。
- Entry Action 已创建 handoff 后，身份升级 receipt、handoff、proposal 和 commit journal 必须能沿同一 durable RowId 追溯。

`identity_promotion` journal 至少固定：provider kind/config digest、capability generation、canonical file key、
collection、升级前 locator/row digest、durable RowId、base/new ETag、before/after digest、request digest、authority/lease
identity 与 receipt digest。阶段复用 `commit_intent -> source_replaced -> verified -> result_published`，但必须使用独立
`saveType` 和严格字段校验。服务启动时先恢复未终结 promotion journal，再开放目标文件的 Entry Action admission。
replace 后、receipt 前的未知结果进入 `recovery_pending`，不能谎报 `session_only` 或重新生成 ID。

## 五、Entry Action 准入与运行边界

### 1. 能力声明

Entry Action 不直接依赖 `__entry_id` 字段。`requiresDurableIdentity` 由 Data Editor 的 Entry Action 引擎定义：

```json
{
  "requiresDurableIdentity": true
}
```

项目 automation profile 不能关闭或覆盖该声明。后续若出现其他跨重载异步写回能力，由 Data Editor 内置
capability metadata 使用同一声明，不复制 Entry Action 专用身份逻辑。

### 2. 正式启动链

```text
flush 当前草稿
  -> 保存普通数据变更
  -> 服务端 action/binding/target/provider preflight
  -> canonical-file fencing admission
  -> commit mutex 内 ensureDurableIdentity(target)
  -> promotion journal + save guard + receipt
  -> 服务端 canonical re-read 并重建目标 context
  -> 复核 authority/lease/generation
  -> 创建绑定 durable RowId + canonical ETag 的 handoff
  -> 启动 proposal-only 执行
  -> 响应携带 canonical snapshot；前端重建 DocumentStore / RowHandle
  -> proposal 由服务端覆盖身份与并发字段
  -> commit/recovery 重新按 durable RowId 定位
```

任一步失败都不得降级到旧 `sourceRowIndex`、业务主键猜测或直接写源文件。

### 3. 前端反馈

首次升级可能产生一次额外保存，前端应区分：

- `正在建立长期身份`；
- `长期身份建立失败，Entry Action 未启动`；
- `长期身份已建立，正在启动动作`；
- `Entry Action 已开始`。

不能把“ID 已写入”显示为“Entry Action 已完成”，也不能在升级失败时留下假运行状态。

## 六、IdentityProvider 通用能力

### 1. Provider 职责

```ts
type IdentityProvider = {
  kind: string;
  resolve(rowContext): DurableIdentityResult;
  promote(promotionContext): PromotionCandidate;
  validate(collectionContext): IdentityIssue[];
  applyDuplicatePolicy(source, duplicate): void;
};
```

Provider 只负责身份解析、建立、验证和复制规则；不承担业务 schema、relation、权限、Entry Action prompt 或玩法运行时转换。
权限由 action/capability authority 负责，候选文档合法性由 document contract/save guard 负责，锁、journal、receipt
和 recovery 由 promotion coordinator 负责；任何一层失败都不得由 Provider 自行降级绕过。

### 2. `declared-key-v1`

使用项目已有的正式字段，例如不可变 `item_id`。

准入条件：

- 项目显式声明字段；
- 非空且 collection 内唯一；
- 项目承诺不可变；
- 复制流程会生成新的业务 ID，或拒绝复制；
- Data Editor 不从字段名自动推断。

该模式不会增加技术字段，但不适合允许改名、允许为空或承担玩家可见语义的业务 ID。
capability registry 必须将已生效字段发布为 `protectedIdentityFields`。普通编辑、批量保存、复制、Entry Action
proposal authority 和其他正式 writer 都必须禁止修改；若业务需要改名，则该 collection 不得使用 `declared-key-v1`。

### 3. `embedded-v1`

在记录内部保存技术字段，默认字段名可为 `__entry_id`。

规则：

- 只在 promotion 时写入目标条目，不全量补种；
- 默认 UI 隐藏且不可编辑；
- 生成后不可修改；
- 复制时移除，不立即生成新 ID；
- collection 建立 store 前验证格式与唯一性；
- 项目业务 schema 不允许该字段时，必须选择其他 provider 或使用明确的 authoring/runtime projection。

### 4. `sidecar-v1`

在 `.data-editor/identities/` 保存与正式业务文件分离的身份表，适合严格 JSON、CSV 或第三方格式。

sidecar 至少绑定：

- registry projectId；
- data source identity；
- canonical source file identity；
- collectionPath；
- durable RowId；
- base document digest；
- 用于外部变更 reconciliation 的稳定证据。

sidecar 与业务文件必须走同一 group journal。外部工具重排、复制或产生完全相同条目后，若无法唯一匹配，进入 conflict，不按索引猜测。

`sidecar-v1` 风险和实现成本显著高于前两种 provider，建议在 session RowId 核心、`embedded-v1` 与 `declared-key-v1` 稳定后单独实施。

## 七、声明式项目配置

本能力应接入《Data Editor 通用化与夜曲解耦方案》的 `.data-editor/project.json` capability manifest，不恢复旧 `adapter`：

```json
{
  "version": 1,
  "requires": {
    "capabilityApi": 1
  },
  "capabilities": {
    "identityPolicies": [
      {
        "id": "items-entry-identity",
        "match": {
          "dataSourceId": "data",
          "innerPath": "items.json",
          "collection": "$"
        },
        "engine": "identity-policy-v1",
        "provider": {
          "kind": "embedded-v1",
          "field": "__entry_id"
        }
      }
    ]
  }
}
```

规则：

- 没有匹配 policy 的 collection 使用 `session_only`，打开时零写入。
- identity policy 只允许 Data Editor 内置且经过版本校验的声明式 provider。
- manifest 缺失、版本不支持、匹配歧义或 provider 配置非法时，普通编辑仍可按项目 enrollment 规则决定是否开放；任何 `requiresDurableIdentity` 能力必须失败关闭。
- identity policy 与 document contract 分开：前者回答“这条记录是谁”，后者回答“这条记录是否合法”。

## 八、与现有通用化方案的关系

本方案不是新的项目 `adapter`，也不应平行建立第二套 capability loader。

建议关系为：

```text
Data Editor 通用化与夜曲解耦方案
  └─ ProjectCapabilityLoader / CapabilityRegistry
      ├─ nested-schema-v1
      ├─ document-contract-v1
      └─ identity-policy-v1          本方案新增的通用 engine
```

两份方案共享以下高冲突路径：

- `src/App.tsx`；
- `src/document-model.mjs`；
- `src/model/document-store.mjs`；
- `src/model/writeback-adapter.mjs`；
- `src/entry-action-service.mjs`；
- project capability manifest、loader、registry 和相关测试。

因此不得并行实施。推荐先由通用化方案建立 capability manifest、project isolation、`identity-policy-v1` 注册入口和 hermetic fixture 基础，再由本方案接入 promotion。若本方案先行，只能完成与 capability 无关的 RowHandle；promotion primitive 也必须等待 identity policy authority 与 owner handoff，禁止硬编码临时 provider。

## 九、迁移方案

### Phase 0：现状与引用审计

形成机器可读清单：

- 哪些文件和 collection 当前含 `__entry_id`；
- 缺失、非法、重复 ID；
- 哪些 ID 被 Entry Action handoff、proposal、journal、result、recovery 或其他工具引用；
- 哪些项目合同把 `__entry_id` 当 required field；
- 哪些严格消费者拒绝该字段；
- 每个 collection 推荐的 provider 和理由。

未完成审计前，不删除、重写或批量补种任何 ID。

### Phase 1：会话身份与零侵入打开

- 建立统一 RowHandle；
- DocumentStore 支持 persistent 与 ephemeral 混合行；
- 无 policy 时不调用全量 `ensurePersistentEntryIds(...)`；
- 打开无 ID 文档不得产生 data dirty 或 autosave；
- 普通编辑、重排、复制和删除保持等价。

### Phase 2：`identity-policy-v1`、`embedded-v1` 与 promotion primitive

- 在通用 capability 基座中正式注册 `identity-policy-v1`，完成 project/data source 隔离、generation 和 fail-closed 匹配；
- 建立 provider registry 和 `embedded-v1`；
- 建立 action authority + fencing admission + ETag + row digest + idempotency + document mutex 保护的首次升级事务；
- 扩展 commit journal 为 `identity_promotion`，完成 receipt、启动恢复和 `recovery_pending` 语义；
- promotion 候选必须经过 document contract/save guard，成功后强制 canonical reload；
- 建立格式、唯一性和重读验证；
- 复制 durable 条目后副本保持 session-only。

### Phase 3：Entry Action 切换

- Entry Action 引擎固有声明 `requiresDurableIdentity`，项目配置不能关闭；
- 启动前执行 promotion；
- handoff、proposal、journal、commit 和 recovery 只接 durable RowId；
- 删除所有升级后 `sourceRowIndex` 回退；
- 建立明确的升级反馈和失败状态。

### Phase 4：`declared-key-v1`

- 支持项目显式声明不可变正式 ID；
- capability registry 发布 `protectedIdentityFields`，所有正式写路径统一阻止修改；
- 无匹配、匹配冲突和配置漂移均失败关闭长期能力；
- 通用 fixture 不依赖任何消费项目仓库。

### Phase 5：历史 ID disposition

历史 `__entry_id` 不自动删除。先按 Phase 0 审计分为：

- 已被 durable workflow 引用：永久保留；
- 被项目合同正式要求：由项目 owner 决定继续 embedded 或迁移 provider；
- 未发现 durable consumer：仅作为候选治理项，不得仅凭“未发现”自动物理删除；
- 非法或重复：进入人工修复/迁移清单，禁止自动选一条保留。

推荐默认保留已有合法 ID，以避免破坏历史 evidence。若用户要求将旧全量补种数据清理为“只保留实际使用过的长期身份”，必须另建高风险迁移任务，提供 producer/consumer/save/data/reference/disposition 审计并逐项目批准。

### Phase 6：`sidecar-v1`（可选）

只有至少一个真实消费项目明确要求“源文件物理纯净且不能使用不可变业务 ID”时才进入该阶段。先用 Data Editor 自有 fixture 完成原子双文件保存、Git 外部编辑 reconciliation 和歧义失败关闭，再接真实项目。

### Phase 7：文档、Truth 与发布收口

- 更新通用配置、数据模型、Codex 自动化和限制文档；
- 以新规则替换“所有数组条目都必须持久 `__entry_id`”的既有 Truth/ADR，不长期保留冲突双真值；
- Data Editor owner 先完成并发布工具 commit；
- 消费项目再迁移 manifest、合同和工具版本；
- 从远端 clean clone 验证零侵入打开与 Entry Action 闭环。

## 十、验证矩阵

### 1. 会话身份

| 场景 | 预期 |
| --- | --- |
| 打开无 ID JSON/CSV | 文件内容、ETag 和 dirty 状态不变 |
| 搜索、筛选、排序 | RowHandle 与源条目对应不漂移 |
| 拖动重排 | 正确重排真实数组，重载后顺序保留 |
| 复制 session-only 条目 | 新副本获得新 session RowId，不写 durable ID |
| 复制 durable 条目 | 副本不继承 durable ID |
| 删除与单元格编辑 | 只修改目标条目，保存继续受 ETag 保护 |

### 2. 首次升级

| 场景 | 预期 |
| --- | --- |
| 原 ETag + 正确 row digest | 只为目标建立一个 durable identity |
| ETag 已变化 | 零写入，提示刷新 |
| 同索引内容已变化 | digest 不匹配，零写入 |
| 同 idempotencyKey 重试 | 返回同一 receipt，不生成新 ID |
| 不同请求竞争同一文件 | 文件级串行，最多一个基于旧 ETag 成功 |
| 升级保存后进程崩溃 | ID 保留；重启后可解析为 durable，不回滚 |
| replace 后、receipt 前崩溃 | 启动恢复同一 journal，返回同一 receipt，不生成第二个 ID |
| provider 返回重复/非法身份 | conflict，Entry Action 不启动 |
| 候选文档违反业务合同 | 零写入，Entry Action 不启动 |
| promotion 成功后前端继续编辑 | 先 canonical reload；后续保存不会删回 durable ID |

### 3. Entry Action

| 场景 | 预期 |
| --- | --- |
| session-only 目标首次执行 | 先升级，后启动 |
| durable 目标再次执行 | 不改身份，直接进入正式启动链 |
| promotion 失败 | 无 handoff、无子进程、无 proposal |
| action disabled/binding invalid/target 未授权 | promotion 前失败，正式数据零变化 |
| 同文件已有活动 action | promotion 不改变 ETag，等待或失败关闭 |
| 动作运行中重排数组 | commit/recovery 仍按 durable RowId 定位 |
| 行被删除 | 提交失败关闭，不转写相邻条目 |
| 相同 durable ID 重复 | 启动和提交均拒绝 |
| 关闭 action 配置 | 已有 durable ID 保留 |

### 4. Provider 与项目隔离

- 同一路径在不同 registry projectId 下不得共享 identity policy、缓存或 sidecar。
- `declared-key-v1` 的空值、重复和修改均失败关闭长期能力。
- `declared-key-v1` 的身份字段不进入普通编辑或 Entry Action writable fields。
- `embedded-v1` 不得把字段暴露为普通可编辑列或 primary-key candidate。
- `sidecar-v1` 的源文件/sidecar 任一写失败必须进入 recovery，不得报告成功。
- 无 capability 项目不能因文件名或目录相同而启用其他项目的 identity policy。

### 5. 工程验证

- 定向 Node 单测覆盖 RowHandle、DocumentStore、promotion、provider、Entry Action proposal/commit/recovery。
- API 合同测试覆盖首次升级、幂等、stale、conflict 和权限边界。
- Browser/Playwright 验证打开零写入、首次动作反馈、失败刷新和再次执行。
- `npm run typecheck`、`npm run build`、项目默认 hermetic test、`git diff --check`。
- 若启动本地服务、Browser 或 Playwright，按项目规则执行 `npm run service:finalize` 并报告 8787/8791 health、正式 URL 和临时清理结果。

## 十一、风险、停止条件与回退

### 1. 主要风险

| 风险 | 影响 | 控制 |
| --- | --- | --- |
| promotion 前按行号定位错条目 | 给错误条目建立长期身份 | ETag + row digest + 文件锁共同约束 |
| 混合 persistent/ephemeral 行产生重复 Map key | UI 或写回指向错误 | store 建立前验证 durable 唯一；session namespace 独立 |
| 身份升级成功、动作未启动 | 产生未使用 durable ID | 允许并永久保留；不把它视为错误或回滚目标 |
| 未授权动作先触发 promotion | 正式数据被无权修改 | action/binding/target preflight 与 fencing admission 必须先于写入 |
| promotion 后前端仍持有旧 root | 下一次保存删除新 ID | 成功后强制 canonical reload，不只替换 RowHandle/ETag |
| replace 后 receipt 未发布 | 客户端误判失败并生成第二个 ID | `recovery_pending` + `identity_promotion` journal 幂等恢复 |
| 历史 ID 被误删 | journal/recovery/合同失效 | 先做引用审计，未经批准不删除 |
| sidecar 与源文件不同步 | 无法证明目标身份 | group journal、digest、reconciliation、歧义失败关闭 |
| 通用化方案并行修改共享路径 | 双真值和合并冲突 | serial owner handoff，不并行实施 |
| identity capability 重新变成项目 adapter | 通用核心耦合业务 | 只允许声明式内置 provider，不执行项目代码 |

### 2. 停止条件

任一条件出现时停止当前阶段，不以兼容 fallback 继续：

- 无法证明 promotion 的目标行与用户点击时相同；
- provider 返回非法、重复或歧义身份；
- 文件、sidecar、journal 或 ETag 无法形成原子提交证据；
- Entry Action 任一后继仍依赖 `sourceRowIndex` 回退；
- capability manifest 缺失、版本不支持或匹配多义；
- 需要删除既有 ID，但缺少完整引用审计或用户批准；
- 与通用化任务在共享路径上没有完成 owner handoff。

### 3. 回退边界

- Phase 1 尚未接 Entry Action 时，可恢复旧版本工具 commit；不在新代码中保留双读开关。
- Phase 2 在 replace 前失败时保持 session-only、正式数据零变化；commit intent 建立后结果未知时进入 recovery_pending，不得回退或重新生成。
- Phase 3 已建立的 durable ID 不因回退 Entry Action 接入而删除。
- sidecar 阶段出现 recovery 时保留全部 journal、源文件和 sidecar 证据，禁止自动清理。

## 十二、依赖、交付与授权边界

### 1. 依赖关系

- 依赖现有 document ETag、canonical physical file identity、document commit mutex、journal 和 fencing 基础设施。
- 依赖《Data Editor 通用化与夜曲解耦方案》的 capability manifest 与 project isolation；共享路径必须串行 handoff。
- Entry Action 当前工作树包含其他任务的 proposal、authority、group commit 和测试修改，本方案不得覆盖、回退、整理或归因这些改动。

### 2. 已确认决策

1. 普通条目默认只使用会话内临时 RowId。
2. 第一次实际执行 Entry Action 或其他 `requiresDurableIdentity` 能力时，才按需升级目标条目。
3. durable identity 生成后永久保留，不因功能关闭而删除。
4. 复制条目不继承 durable identity。
5. 身份需求时点与存储方式分离，由 IdentityProvider 决定具体持久化形态。
6. `identity-policy-v1` 纳入首版 capability 集合，并先于 promotion 与 Entry Action 接入。
7. Entry Action 的 `requiresDurableIdentity` 是引擎固有安全属性，项目配置不能关闭。
8. **历史决定，已废止：** 原“promotion journal/save guard → canonical reload → handoff”顺序已被总方案替代；不得据此实施。
9. 首版先以 `embedded-v1` 验证 promotion 主链；`declared-key-v1` 只有在 protected field 写门完整后接入。

### 3. 后续仍需逐项确认的实施决策

1. 历史全量 `__entry_id` 是否保持原样，还是在完整审计后治理未使用 ID；推荐默认保留，删除另立高风险迁移任务。
2. `sidecar-v1` 是否存在真实首版消费者；推荐没有真实消费方时不实施。

### 4. 授权边界

批准本方案仅表示认可目标结构、生命周期和迁移原则，不等于实施授权。进入代码、数据、测试、Truth、ADR、消费项目配置、历史 ID 治理、提交或推送前，仍需独立执行计划和明确授权。

## 十三、外部成熟模式参考

本方案参考的外部模式只用于解释设计取舍，不构成当前项目事实：

- MongoDB/Sanity：存储系统拥有文档格式时，以记录内不可变系统 ID 区分业务字段。
- JSON:API/Contentful：将系统身份、版本与业务属性分层。
- Unity `.meta` / Godot `ResourceUID`：资源本体不能承载全部工具身份时，以 sidecar 或 UID registry 维持移动后的引用。
- PostgreSQL/SQLite：长期身份必须是显式持久主键，不能依赖可能变化的隐藏行号。
- Unity/Unreal authoring 与导入/cook：编辑源数据与最终消费者数据不必采用同一形状。

限定结论：文件级 sidecar 的成熟经验不能直接证明数组行级 sidecar 天然安全；数组行 sidecar 必须额外解决外部重排、复制、相同内容和原子双文件提交问题。

## 十四、关联材料

- `docs/plans/2026-08-01-Data Editor通用化与夜曲解耦方案.md`
- `docs/plans/2026-07-26-条目自动化并发错写与超时诊断修复方案.md`
- `docs/plans/2026-07-26-条目自动化并发错写修复执行计划.md`
- `.claw/truth/entry-actions-v2-persistent-entry-id-and-stable-location.md`
- `.claw/truth/adr/persistent-internal-entry-id-and-entry-action-stable-locating.md`
- `.claw/truth/adr/document-save-load-hash-optimistic-concurrency.md`
- `src/model/persistent-entry-id.mjs`
- `src/model/document-store.mjs`
- `src/model/writeback-adapter.mjs`
- `src/entry-action-service.mjs`
- `src/entry-action-proposal-commit.mjs`
- `src/commit-journal.mjs`
