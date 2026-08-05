# Godot 技能编辑器承接与 Data Editor 夜曲解耦统一执行方案

## 方案概述

### 1. 总体目标和范围

本方案是当前“通用文档合同通道前置迁移”任务扩展后的唯一跨仓执行计划真值。Godot 承接、Data Editor 通用预备
能力、双工具串行保存验真、专属通道退场和 Nocturnel 最终切换全部由本任务串行执行，不再拆出独立实施任务。

本方案承接以下已经确认的跨仓决定：

- Data Editor 只提供项目无关的 JSON/CSV 编辑、通用嵌套结构、行身份、引用、文档合同、并发与安全保存能力；
- Data Editor 不提供 Nocturnel 技能节点的编辑规则、字段声明、派生提示、合规检查或业务错误协议；
- Godot 技能编辑器是 Nocturnel 技能节点编辑与手动规则检查的唯一入口；
- Nocturnel repo-local Skill 是实现完成验证的唯一业务能力；Data Editor 只提供用户显式调用项目 Skill、展示
  result-only 结果和承载通用作业生命周期的入口；
- Nocturnel 最终删除 `.data-editor/project.json` 中的 `skill-node-contract` 声明，不为技能节点补充
  `nested-schema-v1` 或 `document-contract-v1` 声明；
- `data/content/skills.json` 在 Data Editor 中退化为普通 JSON 数据源，可以自由保存草稿，普通加载、保存、刷新和后台流程
  不得自动运行 Nocturnel 检查。
- Data Editor 与 Godot 技能编辑器都可独立保存 `skills.json`；首版不承诺两个工具在同一瞬间保存的并发安全，
  不为此引入 `skills.json` 特判、跨语言共享锁、Windows 原生组件或新的 Data Editor 保存机制。

本任务可按阶段分别修改 Data Editor 与 Nocturnel，但同一时刻只有一个仓库/路径 owner；跨仓切换必须先冻结前一阶段
commit/hash 和回执，再进行 serial repository handoff。Godot 技能编辑器、Nocturnel checker、
`verify-player-skill-completion` 与唯一验收 writer 的技术要求仍以 Nocturnel 方案为设计依据，但不再由另一个任务实施。
FieldSpec 三份脏文档继续由其原 owner 持有，未取得明确 handoff 和 rebaseline 前，本任务不得修改。

### 2. 当前状态与本轮目标

当前基线：

- Data Editor：`c047a43957791174479907b1025d2c2572946f40`；
- Nocturnel：`4cf37a2a60743adb59d3a53c5e9f16cb83728bfa`；
- Nocturnel `tools/data-editor` gitlink：`c047a43957791174479907b1025d2c2572946f40`；
- Data Editor 计划任务 0～1 已完成；阶段 2 的 grammar/compiler、path-driven admission、exact token、journal recovery 与
  identity promotion 核心实现已通过定向门，但中性 fixture/API 集成尚未完成，整体阶段仍待 D2 收口；
- Data Editor 当前旧 `skill-node-contract` API、UI、表单模型和技能派生规则仍存在，尚未进入删除阶段；
- Nocturnel 当前 `skills.json`、FieldSpec 文档与迁移备份由其他 owner 持有，本任务不得触碰。

本轮后续目标不是立即删除旧入口，而是在同一个任务中按仓库边界串行完成：

1. 在 Nocturnel G0a 与 G1～G3.5 参与端就绪后，完成 Data Editor 通用预备能力并发布一个可被跨仓验真的
   `dataEditorPreparatoryCommit`；
2. 等 Nocturnel G0b/G4 完整证明 Godot 已独立承接后，再完成 Data Editor 专属通道原子退场并发布 cutover commit。

### 3. 统一任务阶段概要

| 阶段 | 当前任务主要工作 | 前置依赖 | 预期成果 |
| --- | --- | --- | --- |
| D0 | 冻结 supersession、阶段 2 核心 diff 与跨仓 owner | 已完成阶段 2 核心门 | 唯一职责边界与可重放基线 |
| D1 | 在本任务中执行 Nocturnel G0a 与 G1～G3.5 | D0 | Godot fail-safe 保存、编辑器承接、项目 Skill 与验收 writer 参与端 |
| D2 | 收口通用 document-contract 基础与中性 fixture | D1，当前未提交阶段 2 实现 | 通用合同能力独立可验收 |
| D3 | 实现 project-skill/result-only 并复核通用保存边界 | D1、D2 | Data Editor 通用预备能力完整 |
| D4 | 验证、提交并单独授权推送预备 commit | D3 | 远端可达的 `dataEditorPreparatoryCommit` |
| D5 | 在本任务中执行 Nocturnel G0b/G4 独立承接验收 | D4 | 获得 Godot 独立承接与双工具串行保存回执 |
| D6 | 显式清理旧 Targeting 视图状态 | D5、用户 apply 确认 | 无隐式迁移 caller、持久清理回执 |
| D7 | 原子删除专属 UI/API/规则/fixture 并同步文档 | D6 | Data Editor 生产核心零 Nocturnel 语义 |
| D8 | 全量回归、提交并单独授权推送 cutover | D7 | 远端可达 cutover commit |
| D9 | 在本任务中执行 Nocturnel gitlink/声明切换与职责收口 | D8 | 跨仓唯一入口与 FieldSpec 复核依据 |

### 4. 整体结构框架

```text
当前统一任务：Nocturnel G0a
  └─ 证明 Godot 临时写入、复读、替换失败保持 canonical 的 fail-safe 保存
       ↓ 同任务内 serial repository handoff
当前统一任务：Nocturnel G1～G3.5 participant
  ├─ Godot 技能编辑与手动 checker
  ├─ verify-player-skill-completion
  └─ Nocturnel 唯一验收 writer
       ↓ 同任务内 serial repository handoff
当前统一任务：Data Editor D2～D4 preparatory commit
  ├─ 通用 document-contract 与中性 fixture
  ├─ execution.kind route-before-promotion
  ├─ project-skill/result-only
  └─ 复核普通 JSON 保存继续零领域特判
       ↓ push 后远端可达
当前统一任务：Nocturnel G0b/G4
  └─ 同一 scratch-root 的双工具串行保存与真实编辑器验收
       ↓ Godot 独立承接回执
当前统一任务：Data Editor D6～D8 cutover
  ├─ 显式清理旧 Targeting 视图状态
  ├─ 删除 skill-node-contract 专属 UI/API/规则/测试
  ├─ 中性化 fixture 与当前文档
  └─ 独立回归、commit、push
       ↓
当前统一任务：Nocturnel G5.3/G6
  ├─ 更新 gitlink
  ├─ 删除 skill-node-contract 项目声明
  └─ 完成跨仓文档与 FieldSpec owner handoff
```

## 一、唯一职责边界与 supersession

### 1. Data Editor 保留的职责

- 普通 JSON/CSV 加载、编辑和自由保存；
- session RowId、按需 durable identity、引用与行级目标身份；
- 通用 `nested-schema-v1` 和 `document-contract-v1` 引擎，但不要求 Nocturnel skills 使用；
- 文档 ETag、exact token、canonical re-read、commit mutex、journal、recovery 和原子写入；
- 通用 proposal/writeback 自动化；
- 用户显式触发的 `project-skill/result-only` 动作与通用结果展示；
- 通用原子写入、事务日志与恢复能力；不为 Nocturnel 新增跨语言协调参与端。

### 2. Data Editor 明确不承担的职责

- 不判断 `skills.nodes`、Targeting、Area、Affects、Charge、movement、consumes 或 capability；
- 不加载或解释 Nocturnel `skill_nodes.json` 作为 Data Editor 编辑声明；
- 不为 Nocturnel 新增技能 `nested-schema-v1/document-contract-v1` binding；
- 不因技能草稿暂时不合规而阻止普通保存；
- 不自动调用 Godot checker、设计 Skill、评审 Skill 或完成验证 Skill；
- 不实现 `impl_status` 四态、`已验收` 回执规则或 action-specific 字段白名单；
- 不成为 Nocturnel 验收结果、技能规则或项目命令的第二 owner。

### 3. 被废止的旧结论

两份旧 Data Editor 方案均不得再作为活跃实施真值：

- `2026-08-01-Data Editor通用化与夜曲解耦方案.md`：整体标为 historical/superseded；仅保留既有通用化设计、
  identity disposition 和历史证据；
- `2026-08-05-Data Editor通用文档合同通道迁移方案.md`：阶段 0～1和阶段 2 核心设计作为通用基础与证据保留，
  阶段 2 的中性 fixture/API 集成转入本方案 D2，阶段 3～6全部 superseded。

以下旧结论明确废止：

- 为 Nocturnel skills 补技能 `nested-schema-v1` 声明；
- 为 Nocturnel skills 迁写通用 `document-contract-v1` 业务规则；
- 保留 opaque `skill-node-contract` binding；
- 以 Data Editor 通用 schema resolver 继续承接技能节点编辑；
- 以“Data Editor 可继续编辑 Nocturnel 技能节点”作为 cutover 完成条件。

## 二、执行前置、owner 与暂停门

### 1. 当前未提交范围

当前 Data Editor 阶段 2 运行时/测试范围包括：

- `server.mjs`；
- `src/commit-journal.mjs`；
- `src/document-commit-executor.mjs`；
- `src/document-contract-service.mjs`；
- `src/document-contract-compiler.mjs`；
- `src/document-contract-grammar.mjs`；
- `src/durable-identity-coordinator.mjs`；
- `src/project-capability-registry.mjs`；
- 对应 document contract、commit executor 与 identity coordinator 定向测试。

`.claw/project.json` 继续作为 host-owned 变化排除。方案、阶段记录与上述运行时补丁不得与无关工作树变化混入同一 scoped
commit；首次继续写入前重新记录 HEAD、dirty paths、scoped diff/hash 和 owner。

### 2. Nocturnel 依赖回执

D2/D3 首次修改前，当前统一任务必须先完成 Nocturnel 阶段并生成窄范围内部 handoff，至少包含：

- G0a 已通过的 Windows 同目录 fail-safe replace probe：成功时内容完整，失败时 canonical 保持不变、temp 可清理且错误清晰；
- Godot 保存仍保留打开时摘要、保存前复读和替换前再次复读；明确记录最后一次检查与替换之间仍存在极小竞争窗口；
- G1～G3.5 参与端 commit/hash、`project-skill` 请求/结果合同、check/promote 分流、唯一验收 writer 接口；
- scratch-root、snapshot manifest 和清理 token 协议；
- Data Editor 允许修改路径与 Nocturnel 明确排除路径。

若上述任一项未冻结，Data Editor 不自行增加 `skills.json` 特判、另一套锁或项目 Skill 输出猜测，计划保持暂停。

### 3. 共享路径与 owner

| 路径族 | owner | 本任务允许动作 | 串行要求 |
| --- | --- | --- | --- |
| Data Editor document-contract/journal | Data Editor 当前任务 | 收口、测试、中性化 | 以当前阶段 2 diff 为 baseline |
| Data Editor entry-action route/service/profile | Data Editor D3 | 通用协议修改 | Nocturnel G3.5 handoff 后独占修改 |
| Data Editor App/detail/skill-node-* | Data Editor D7 | 删除专属分支 | Nocturnel G4 回执后独占修改 |
| Data Editor view migration/storage | Data Editor D6 | 先停隐式 caller，再 preview/apply 清理 | 用户确认 apply 后才改持久状态 |
| Nocturnel Godot/Skill/contracts | 当前统一任务 Nocturnel 阶段 | 按 G0a～G4 修改与验收 | 与 Data Editor 工作包串行，首版不实现跨工具同时保存 |
| Nocturnel `.data-editor/project.json` 与 gitlink | 当前统一任务 D9 | 同一原子批次更新 | Data Editor cutover push 可达后修改 |
| Nocturnel `skills.json`、FieldSpec 三文件、迁移备份 | 原 owner | 完全排除 | 未 handoff 不读写、不提交 |

## 三、详细执行工作包

### D0：冻结新口径与当前基线

主要工作：

1. 以本方案明确 supersede 旧 Data Editor 方案阶段 3～6 的 Nocturnel 接线结论；
2. 保存当前 Data Editor/Nocturnel HEAD、gitlink、dirty paths、阶段 2 scoped diff/hash；
3. 将当前阶段 2 已实现内容按 `retain/generalize/test/delete-later` 重新 disposition；
4. 确认 Data Editor 当前任务保持 `process.wait`，不把方案批准当成后续实现授权或外部 handoff 已到达。

完成条件：两份方案不存在相反的活跃 cutover 指令，当前未提交实现有可复核 baseline。

### D1：执行 Nocturnel G0a/G1～G3.5 并形成内部 handoff

本阶段在当前统一任务中切换到 Nocturnel 仓执行 G0a、G1、G2、G3 与 G3.5 的 Nocturnel 参与端。Data Editor
运行时保持冻结；Nocturnel 阶段完成后生成内部 serial handoff，必须验证：

- Godot 保存使用同目录 temp、关闭复读、替换前复查和失败安全清理；不引入 Windows 原生组件或跨语言 coordinator；
- Data Editor 保持现有通用文件保存能力，能够把 `skills.json` 当普通 JSON 保存，且不增加任何夜曲领域分支；
- `execution.kind=proposal|project-skill` 的分流发生在 proposal identity promotion/admission 之前；
- project-skill 未知/缺失类型和 host fallback 失败关闭；
- `check` 是 result-only；`promote` 只调用 Nocturnel 唯一 writer；
- Data Editor 不需要解释 `owner=player`、`impl_status`、report verdict 或 Godot 错误码。

完成条件：Nocturnel 定向验证与回执通过，G3.5 仅标记为 `participant-ready`，回执与当前 checkout/hash 匹配；
不匹配则重新冻结，不进入 D2/D3。此时不得宣称 G3.5 最终完成。

### D2：收口通用 document-contract 与中性 fixture

1. 复核当前阶段 2 未提交实现，保留通用 grammar/compiler、path-driven admission、exact token、journal recovery 与
   identity promotion 复用；
2. 保留当前旧合同的临时 opaque/legacy 处理和专属入口，使仍指向旧 binding 的 Nocturnel 在预备提交阶段继续自由保存；
   该处理不得扩展到新的 v1 grammar，也不得成为长期兼容承诺，必须与旧声明在 D7/D9 cutover 中删除；
3. 按已冻结规格将 `tests/fixtures/projects/contract-project` 中性化为 workflow fixture；
4. 覆盖双 binding、missing/partial/extra/stale token、collection 删除/改型、pre/post-replace drift、合法 journaled save、
   identity promotion 与 recovery；
5. 证明默认测试不读取 Nocturnel、不要求相邻仓库存在。

完成条件：通用 document contract 以非技能 fixture 独立通过；Nocturnel 是否使用该能力不影响 Data Editor 功能。

### D3：实现通用预备能力

#### D3.1 动作路由

- 在 `entry-action-route` 中先解析 `execution.kind`，再进入任何 proposal identity promotion/admission；
- `proposal` 保持现有两阶段 fencing、proposal/writeback、ETag 和 recovery 行为；
- `project-skill` 使用独立 host，只允许用户显式触发，支持 result-only，不要求字段修改；
- 两类 host 不互相 fallback；未知或缺失类型失败关闭；
- Data Editor 向 proposal handoff 提供目标行全部现有字段，不添加 Nocturnel/action-specific 白名单。

#### D3.2 通用保存与项目 Skill 边界

- Data Editor 继续复用现有项目无关的 atomic write、ETag、journal 与 recovery；不新增 `skills.json`、Nocturnel 或技能字段分支；
- 普通 JSON 保存与 proposal/writeback 保持各自既有通用安全门，不接入新的跨语言 coordinator；
- `project-skill check` 是只读/result-only；`project-skill promote` 只路由到 Nocturnel 验收 writer，Data Editor host 不代写业务状态；
- Nocturnel promote 保留自身 expected digest、回执与事务一致性，不把业务 writer 的保护扩展为 Data Editor 普通保存机制；
- 首版明确不承诺 Data Editor 与 Godot 同时保存；检测到外部变化或 replace 失败时停止并提示刷新重试。

#### D3.3 文档与测试

- 更新 `docs/09_Codex自动化机制.md` 的当前 route、result-only/project-skill 和 profile-only authority；
- 定向覆盖 route-before-promotion、两类 host 隔离、普通保存零自动化调用、无 action-specific 字段白名单，以及
  `skills.json` 作为普通 JSON 的独立保存；
- 使用中性测试项目证明 `project-skill/result-only` 并非 Nocturnel 专属能力。

完成条件：D2/D3 的 Data Editor 通用能力可在旧 `skill-node-contract` 尚存在时独立通过，不产生领域硬编码。

### D4：预备 commit 与独立 push 门

1. 执行定向测试、`npm test` 适当范围、`npm run typecheck`、`npm run build`、`git diff --check`；
2. 进行规格符合性审查与代码质量审查；
3. 只提交 D2/D3 及必要文档，排除 `.claw` 与其他 owner 变化；
4. commit 后停止，单独请求用户授权 push；
5. push 成功后 fetch 并证明远端包含该 commit，记录为 `dataEditorPreparatoryCommit`；
6. 不在本阶段更新 Nocturnel gitlink，不删除旧专属通道。

完成条件：预备 commit 远端可重建，且回执可供 Nocturnel G0b 使用。

### D5：执行 Nocturnel G0b/G4 并取得删除许可

当前统一任务切回 Nocturnel 仓执行 G0b/G4；Data Editor 保持旧专属通道不动。回执必须证明：

- Data Editor 与 Godot 均可在非同时保存条件下独立保存同一 scratch `skills.json`；
- Godot replace 失败时 canonical 保持原内容、temp 可清理、界面草稿保留并返回清晰错误；
- Godot 可独立完成递归技能编辑、Targeting/Charge/consumes/capability 投影和中文说明；
- 手动检查、结果过期、Quick Test 和自由保存语义通过；
- Data Editor/Codex 显式 project-skill 双入口使用相同 producer 与唯一验收 writer；
- 全部真实验收只使用同一仓库外 `<scratch-root>`，正式脏 `skills.json` 零写入；
- `dataEditorPreparatoryCommit`、Nocturnel HEAD、snapshot manifest 与回执摘要精确匹配。

G0b 全部通过后只把 G3.5 从 `participant-ready` 推进到 `integration-ready`；G4 依赖该状态。只有 D9 在最终配置中
删除旧 binding并验证三项 action 仍正常后，才可标记 `final-complete`。

G4 启动或停止过隔离 Data Editor 服务、8897/8898、Browser 或 Playwright 后，必须在已核验的 Data Editor checkout
执行 `npm run service:finalize`。G4 回执同时记录 8897/8898 已释放、`8787/api/health`、`8791/health`、正式 URL
`http://127.0.0.1:8787/`、Browser 最终停留位置，以及临时进程和目录清理结果。

只有 G4 完整通过，D6/D7 才能开始。单个单测、界面看起来可用或“近期不用 Data Editor 技能编辑”均不构成删除许可。

### D6：显式清理旧 Targeting 视图状态

1. 先移除所有 `apply:true` 隐式 migration caller，验证启动、读取共享视图和 profile 不再静默改写；
2. 提供临时 `legacy-targeting-view-state-discard` 维护动作；
3. preview 覆盖 localStorage、项目 view config、shared views、全部项目 profile 和配置的用户 profile home；
4. preview 冻结目标身份、before/after digest、字段路径、冲突、未处理项及非目标状态摘要；
5. 等待用户明确确认 apply；文件存储复用通用原子写入并校验 preview digest；
6. 只删除技能视图中的旧 Targeting 派生引用，不清空其他项目、普通布局或通用偏好；
7. unit/E2E 与真实窗口验收通过后，Data Editor 阶段只冻结完整报告、SHA-256、实际路径和 cleanup evidence；
8. 当前统一任务串行切换到 Nocturnel owner 阶段，rebaseline 后将该报告晋升为 Nocturnel 持久回执并复读；收到精确
   receipt hash 后再切回 Data Editor；
9. 持久回执复读且残留为零后，才删除维护动作、纯 transform 与临时报告。

完成条件：所有隐式 caller 为零、所有登记存储无目标残留、其他视图状态摘要不变。

### D7：Data Editor 专属通道原子退场

同一 cutover 工作包内完成：

- 删除 `/api/skill-node-contract`、专属 service/client/state/form-model/derived-rules/semantics/version；
- 删除 `App.tsx`、`DetailPanel.tsx`、`NodeEditorHost.tsx` 和 schema registry 的固定技能分支；
- 删除 `derived-field-projection` 中技能 Targeting 派生列与已完成的 migration 模块；
- 删除专属测试、旧 API 测试与相邻 Nocturnel fixture 依赖；
- 删除 `document-contract` compiler 中仅为旧技能合同保留的 legacy/opaque fallback 及其临时测试；
- 默认 fixture、scratch producer、E2E skills fixture 和性能 helper 中性化；
- 将 `docs/11_文档字段与技能节点合同.md` 改为只描述通用字段的文档；
- 同步 `docs/09` 及两份 Data Editor 解耦方案的 supersession；
- 保留通用 document contract、identity、reference、proposal/writeback、project-skill 和 coordinator 能力。

不得保留旧 API alias、转发模块、隐藏 fallback 或“同名普通文件触发技能模式”的兼容逻辑。Data Editor 不新增任何
Nocturnel 技能 schema/合同声明作为替代。

完成条件：生产核心不存在由 Nocturnel 技能词、固定 binding id、固定 `skills.nodes` 或专属错误码驱动的分支。

### D8：cutover 回归、commit 与独立 push 门

必须保存以下证据：

- `npm test`；
- `npm run build`；
- `npm run test:e2e`；
- 独立、仓库外、中性 scratch project 的启动、普通 JSON 保存、nested schema、document contract freshness、identity、
  reference、并发与 recovery 验证；
- 无 Nocturnel 目录时的 standalone 启动；
- `skill-node-contract`、固定 `skills.nodes`、Targeting migration 与专属文件名的生产零残留扫描；
- `git diff --check`、scoped diff/hash、实际路径集与排除项。

如果本阶段启动过服务、临时端口、Browser 或 Playwright，结束前必须执行 `npm run service:finalize`，并记录
`8787/api/health`、`8791/health`、正式 URL 与临时进程/目录清理结果。

验证与独立审查通过后创建 Data Editor cutover commit，然后停止并单独请求 push 授权。push 后必须 fetch 并证明远端
包含该 commit；在此之前 Nocturnel 不得更新 gitlink。

### D9：Nocturnel 原子切换与最终 handoff

当前统一任务先冻结并交付下列 Data Editor 回执，再串行切换到 Nocturnel 仓：

- `dataEditorPreparatoryCommit` 与 cutover commit；
- remote URL 与远端可达证明；
- 实际修改/删除路径；
- 测试、E2E、standalone、零残留与服务收尾结果；
- Targeting 视图清理持久回执；
- 当前未解决风险与 excluded dirty paths。

本任务的 Nocturnel 阶段在同一切换批次更新 `tools/data-editor` gitlink并删除 `skill-node-contract` 项目声明，保留
`skills-identity`、普通表格/视图和三项用户显式自动化；`data/contracts/skill_nodes.json` 继续由 Godot/运行时/checker
使用，不因 Data Editor 解耦删除。

删除声明后必须重跑三项显式 action 的目标解析、职责隔离与普通保存零调用测试；通过后才把 G3.5 标记为
`final-complete`，再进入最终职责收口。

FieldSpec owner 必须在重新取证和 rebaseline 后自行解除阻塞。本任务只发送“可复核 handoff”，不得直接宣称
FieldSpec 已完成或已自动解阻。

## 四、验收矩阵

| 验收域 | Data Editor 必须证明的结果 | 依赖证据 |
| --- | --- | --- |
| 通用合同 | 非技能 fixture 可加载、校验、派生和 journaled save | D2 |
| 保存安全 | exact token、generation/compiled digest、pre/post-replace、recovery、identity promotion | D2 |
| 动作分流 | route-before-promotion，proposal/project-skill 无 fallback | D3 |
| result-only | 中性项目 Skill 可返回结果而不修改字段 | D3 |
| 字段自由 | proposal handoff 含目标行全部现有字段，核心无 action-specific 白名单 | D3 |
| 双工具保存边界 | Data Editor 与 Godot 均可独立保存；首版不承诺同瞬间保存，外部漂移/替换失败均明确停止 | Nocturnel G0a/G0b + D3 |
| 普通保存 | `skills.json` 作为普通 JSON 保存，零技能合规检查、零隐式 action | D7/D8 |
| 独立运行 | 无 Nocturnel 目录仍可启动和通过默认测试 | D8 |
| 旧视图状态 | 全部登记存储完成显式定向清理，其他偏好不变 | D6 |
| 零残留 | 生产代码/当前文档/默认 fixture 无专属入口或隐藏 fallback | D7/D8 |
| 跨仓切换 | Data Editor commit 远端可达后才更新 gitlink并删项目声明 | D9 |

## 五、失败处理与回退边界

- Nocturnel G0a fail-safe 保存门未闭合：D2/D3 不开始，不在 Data Editor 增加技能特判或原生后端；当前统一任务留在 D1 修订；
- D2/D3 验证失败：旧专属通道保持，不发布预备 commit；
- 预备 commit 未 push 或远端不可达：Nocturnel G0b/G4 不得把本地 checkout 当正式依赖；
- Nocturnel G4 未通过：D6/D7 不开始，继续修复 Godot 承接缺口；
- 旧视图清理 preview 有冲突或用户未确认：不 apply、不删除 transform、不进入 D7；
- D7/D8 通用回归失败：不提交或回退整个本地 cutover，不恢复半套兼容层；
- Nocturnel gitlink/声明切换失败：Nocturnel 保持上一已知组合，Data Editor 不代为修复项目数据；
- 发现正式技能数据需要迁移：拆出独立 Nocturnel 内容迁移工作包，本任务不顺带修改；
- 发现通用能力缺陷：只修通用能力，不重新引入技能业务知识；
- 任一共享路径 hash/owner 漂移：当前 handoff 失效，重新冻结 baseline 后再继续。

## 六、提交、推送与发布边界

至少存在三个独立授权门：

1. Data Editor 预备 commit：提交前核对 scoped diff；commit 后单独询问是否 push；
2. Data Editor cutover commit：G4 与 D6～D8 全部通过后提交；再次单独询问是否 push；
3. Nocturnel gitlink/声明与最终内容：由当前统一任务切换到 Nocturnel 仓后独立提交，并单独询问是否 push。

一次“同意”不得推定后续 commit 或 push。不得提交“旧 API 已删但默认 fixture/文档仍依赖它”、或“Nocturnel 已删声明但
gitlink 尚未指向远端可达 cutover”的断链中间态。

## 七、完成定义

只有同时满足以下条件，本方案才可声明完成：

- 通用阶段 2 实现已用中性 fixture 完整验收并进入可重建提交；
- Data Editor project-skill/result-only 通过通用 fixture 验真，普通 `skills.json` 保存保持零领域特判；
- Nocturnel G4 已证明 Godot 独立承接，并提供与精确 Data Editor 预备 commit 绑定的回执；
- 旧 Targeting 视图状态已显式、定向、可审计地清理；
- Data Editor 专属 UI/API/状态/规则/测试/默认 fixture 已原子删除或中性化；
- 普通 `skills.json` 保存不触发 Nocturnel 合规检查或自动化；
- Data Editor 无 Nocturnel 目录也能启动并通过通用回归；
- Data Editor cutover commit 已 push 且远端可达；
- Nocturnel 已在单一切换批次更新 gitlink并删除 `skill-node-contract` 项目声明；
- 当前文档职责一致，FieldSpec 已收到重新取证 handoff，且现有脏路径未被覆盖；
- 两仓均无未说明的本任务临时文件、服务、端口或 runtime 残留。
