# 方案概述：Project Skill 两阶段执行修复

## 方案概述

本方案把需要读取项目资料的自动化收敛为一个可选扩展：用户从当前项目选择资料，按需选择已注册的本机预检；不启用时仍是普通条目自动化。配置界面只呈现业务选择，解释器、脚本和摘要等本机信任信息隔离在维护区。执行顺序为“配置合同与保存一致性 -> 最小快照与可选预检 -> 状态与验证”。

## 目标与范围

修复 Data Editor 的 `project-skill` 自动化在大型项目中长时间显示运行、预检命令被策略拒绝并最终超时的问题。方案只调整 Data Editor 的通用执行协议，不内置 Nocturnel 的技能、合同或评审规则。

范围包括：最小输入快照、受控预检、阶段化运行状态、超时与诊断、自动化配置校验和端到端测试。

非范围包括：修改 Codex Skill 的业务内容、直接修改项目源文件、改变 proposal/transaction 的提交 authority，或为任一项目加入专用分支。

## 当前证据

- `project-skill` 在 `src/project-skill-action-service.mjs` 中递归复制整个项目，仅排除 runtime/logs；Nocturnel 的准备阶段约耗时 9 分钟。
- 宿主固定使用 `workspace-write` 与 `approval_policy="never"`。正式评审运行中，合同读取和 `precheck` 均被 Codex 策略拒绝，最终占满 5 分钟执行上限。
- 现有状态只有 `queued`、`running`、`terminal`，UI 将快照准备和模型执行统一显示为“已运行”。
- Canonical 项目文件仍由服务端 proposal/transaction admission 独占写回；该边界必须保留。

## 推荐设计

所有自动化规则先使用同一套基础配置：按钮名称、图标、目标范围、本机 Codex skill 与结果策略。只有用户勾选“需要读取项目资料”时，规则才在 `execution.advancedExecution` 下声明 `projectInput` 合同并启用隔离快照；预检是该扩展内可选的本机检查，不是每条规则的必填项。它不是按项目或业务类型强制分层的入口。`advancedExecution` 是 UI、profile schema 与运行服务唯一的判定源；关闭开关时必须从持久化规则中删除整个对象，不能留下空对象或残留 `projectInput`。

启用后的规则示例：

```json
{
  "kind": "project-skill",
  "resultPolicy": "proposal",
  "advancedExecution": {
    "projectInput": {
      "paths": ["data/content/skills.json", "tools/review", "tools/design"]
    }
  }
}
```

`advancedExecution` 首版仅允许 `execution.kind = project-skill` 且 `resultPolicy = proposal | result-only`。`project-transaction` 保持既有 `ownerId/capabilityId` 合同，不显示高级开关，也不隐式混合两种提交协议。

`paths` 是相对项目根目录的显式输入清单。界面从当前项目已知文件及其非根父目录生成带筛选的多选器；当前规则目标文件自动加入并锁定，用户只能补充额外参考资料，不能手填路径。锁定项可以由精确文件或已选目录覆盖，但不能被删除后只保留无关资料。Data Editor 对最终路径进行 root/realpath/link 校验，并只复制这些文件或目录到一次性快照；不会递归复制整个项目。`preflightId` 可省略；选择时只显示“无运行前检查”与当前设备已注册检查的名称、说明和推荐标记，不能携带程序、路径或参数。未启用项目资料读取的规则不显示也不校验这些字段，继续按既有轻量条目动作执行。

本机 bindings v2 固定落在 `%APPDATA%\\data-editor\\automation-bindings\\<projectId>.json`；`%APPDATA%` 缺失时使用 `DATA_EDITOR_HOME`，两者都缺失才回退用户 home 下的 `.data-editor`。它有两个互不混用的映射：`codexBindings[actionId]` 保存现有 `provider/skill` 绑定，`preflights[preflightId]` 保存预检器。预检器的公开元数据为 `label`、可选 `description` 与可选 `recommendedSkills[]`；仅“本机预检维护”折叠区编辑解释器 absolute realpath、脚本 absolute realpath、脚本 SHA-256 摘要与短超时。没有已注册检查时，规则编辑器明确提示可先选“无运行前检查”。

首版不开放任意参数模板或预检专属资源字段。Data Editor 以固定 argv 传递隔离 `inputRoot`、重解析后的 `sourcePath`、`collectionPath`、`rowId` 与 `sourceRowIndex`；任何项目资源都必须直接列入 `projectInput.paths`。这样项目配置和本机 binding 都不能借参数模板扩大输入、注入 shell 参数或绕过最小快照。

保存及每次执行前均验证被选择的预检器 realpath、脚本 realpath 和脚本摘要。脚本内容变化、路径变化或摘要缺失都会使该候选失效，必须由当前用户在维护区重新确认。项目配置不能直接启动任意程序，也不能通过替换项目内脚本静默改变本机预检器。预检器是当前用户显式信任的本机工具，不承诺操作系统级的写入隔离；Data Editor 只向它传递快照目录和受限上下文，canonical 写回仍只接受 proposal/transaction admission。

保存采用组合校验与补偿写入：服务端接收 profile ETag、bindings revision 与两份草稿，先校验所有 `preflightId` 引用及两个前置版本，再写入 bindings，随后写入 profile；若第二步失败则仅在 bindings revision 未变化时恢复此前 bindings 原文。恢复也失败时返回明确恢复错误并保留前端草稿，绝不显示“保存成功”。这样不会留下 profile 指向不存在本机预检器的悬空引用，也不会覆盖另一窗口或维护区的新绑定。

预检通过后，Codex 在同一快照中运行。正式阶段仍只能通过结构化 proposal 或 project transaction 交由 Data Editor 写回 canonical 项目。临时快照可写是为了让 Codex 生成其局部回执，但输出目录必须独立且所有写回均走既有 admission。

## 状态协议

启用“需要读取项目资料”后的运行状态扩展为：

1. `preparing_input`：校验并复制声明的最小输入。
2. `preflight_running`：仅在选择预检器时运行本机绑定的固定检查，使用独立短超时。
3. `review_running`：资料准备完成，且预检通过或未选择预检时启动 Codex。
4. `committing`：复用既有提交阶段。
5. `terminal`：保留既有成功、失败、超时结果。

选择预检的完整迁移图为 `queued -> preparing_input -> preflight_running -> review_running -> proposal_ready -> committing -> terminal`；未选择预检的资料读取规则为 `queued -> preparing_input -> review_running -> proposal_ready -> committing -> terminal`；基础规则保持 `queued -> running -> proposal_ready -> committing -> terminal`。`preflight_failed` 与 `preflight_timed_out` 是 `terminal.outcome`，不是可继续运行的 phase。state v3 持久化 `queuedAt`、`phaseStartedAt`、`phaseHistory[]`、`terminalAt` 与 `outcome`；旧 `running` 保持 `running` 语义，只有资料读取规则进入 `review_running`。终态只允许单调前进且幂等写入，proposal admission 只能从 `proposal_ready` 进入 `committing`。失败消息必须明确阶段，例如“输入准备失败”“预检未通过”“预检超时”“Codex 执行超时”。前端时长按当前阶段开始时间计算，同时显示总耗时，避免把队列或准备时间误称为模型执行时间。

## 执行顺序

### 第 1 章：通用合同与安全边界

#### 1.1 可选高级执行配置合同

- 输入：现有自动化规则。
- 动作：基础规则不要求 `advancedExecution`。UI 以“需要读取项目资料”显式开关控制字段展开；开启时只允许 `project-skill + proposal/result-only`，并严格校验完整的 `advancedExecution.projectInput.paths`。目标文件只读自动加入；额外资料只能从文件/目录选择器加入。预检下拉可选择“无运行前检查”或有效的本机候选，空值不写入 `preflightId`。关闭时保存操作删除整个 `advancedExecution`。未保存的编辑草稿可以不完整，以便用户继续修正；正式 profile 不接受空路径或无效候选引用。

  profile reader 改为逐条解析，返回 profile ETag、合法规则 projection，以及 `{ ruleId, rawRule, issues[] }` 的可修复错误 projection；任何单条畸形规则不得使其他合法规则不可见。保存接口新增按 `ruleId` 的局部 patch：请求携带 profile ETag、目标规则原始摘要与完整替换规则；服务端在同一写临界区验证二者并原子替换目标规则，保留所有未编辑 raw rule。若 profile ETag 或目标规则摘要已变化，返回冲突，不做全量覆盖。全量保存仅用于没有可修复错误的 profile。涉及 profile 与 bindings 的保存改为一个组合保存接口，先验证引用，再按“bindings 写入 -> profile 写入 -> profile 失败则回滚 bindings”的顺序执行。

  历史残留或不完整高级对象以可修复错误呈现；patch writer 只替换目标规则并要求 ETag 与原始摘要未变。扩展机器本地 bindings v2，分离 `codexBindings[actionId]` 和 `preflights[preflightId]`，定义预检器的解释器 realpath、脚本 realpath、脚本摘要与短超时。
- 成果：简单条目动作保持轻量；需要跨文件输入或项目检查的动作可显式声明最小输入与检查类型，且只有当前用户的本机绑定能决定实际预检工具。
- 验收：关闭资料读取的规则可保存并运行；开启后至少含锁定目标与完整声明；候选不包含项目根，锁定目标不可删除或替换为无关资料；“无运行前检查”可保存并在准备后直接运行 Codex，已选检查必须有有效 binding；空对象、裸 `projectInput`、残留字段、逃逸、链接、任意可执行文件、任意参数模板、超时越界、脚本摘要不匹配均被拒绝；单条坏规则不阻断其他规则读取；局部 patch 不覆盖未编辑 raw rule，ETag 或原始摘要变化时拒绝；组合保存不产生悬空引用或覆盖并发 bindings；编辑一条高级规则不会改写无关基础规则、既有 Codex binding 或 `project-transaction` 合同。

#### 1.2 最小快照构造器

- 输入：已校验的 `paths` 与当前动作目标。
- 动作：新建通用 snapshot copier，按路径逐项 copy，保持 link fail-closed；输出目录不来自用户配置。保存规则时自动确保每个 target 的 `file` 位于 `paths`；预检若需要其他项目资源，必须由用户通过选择器直接加入 `paths`，不存在隐式资源声明。每次运行在创建快照前重做 action target、canonical source identity 与 row identity 校验，只把重解析出的固定参数传给预检与 Codex。
- 成果：不再复制 `node_modules`、assets 或无关项目内容。
- 验收：只出现声明路径及必要父目录；canonical 文件未变；任何链接或路径逃逸失败。

### 第 2 章：两阶段宿主与运行状态

#### 2.1 受控预检宿主

- 输入：用户选择的机器本地预检器 binding、最小快照、条目稳定身份。
- 动作：未选择预检器时跳过本阶段，准备完成后直接启动 Codex。选择预检器时无 shell spawn；短超时；stdout/stderr 固定写入 `<outputRoot>/preflight.stdout.log` 与 `<outputRoot>/preflight.stderr.log`；仅使用冻结的固定 argv，退出非零不启动 Codex。预检器在临时快照中执行，canonical 写入 authority 仍只在 Data Editor admission。

  argv 的唯一顺序为：`[scriptRealpath, "--input-root", inputRoot, "--source-path", sourcePath, "--collection-path", collectionPath, "--row-id", rowIdOrEmpty, "--source-row-index", sourceRowIndexOrEmpty]`。所有 flag 均必传；缺失 `rowId` 或 `sourceRowIndex` 时对应值传空字符串，不省略 flag、不接受额外 argv。
- 成果：当前用户信任的本机 deterministic check 可运行，Data Editor 不需要理解其业务语义。
- 验收：成功、非零失败、超时三条路径都回收进程并保留诊断；预检测试精确断言完整 argv 数组，包括空身份值编码和 stdout/stderr 固定路径；恶意项目 profile 不能指定任意本机程序。

#### 2.2 Codex 宿主权限与阶段迁移

- 输入：资料准备完成且预检通过（如已选择）的快照。
- 动作：将 Codex 阶段切换为可执行的受控运行配置；保留 output-only admission，并按 state v3 记录阶段历史和开始时间。状态 reader、轮询和历史回执均接受旧 `queued/running/committing/terminal`；基础规则维持 `running`，仅资料读取规则进入 `review_running`。
- 成果：Codex 可以读取最小快照内的合同并执行评审，无法直接改 canonical 项目。
- 验收：真实 CLI 读取标记文件、运行预检、返回结构化结果；绝对 canonical 写入仍被拒绝。

### 第 3 章：UI 与验证

#### 3.1 状态呈现

- 动作：DetailPanel 为资料准备、可选预检、模型与提交非终态显示中文阶段与阶段耗时，总耗时作为补充信息。
- 验收：准备、选择预检时的预检、模型、提交阶段可区分；未选择预检不会显示虚假的预检阶段；关闭并重开详情面板后状态一致。

#### 3.2 回归矩阵

- 动作：补齐 profile schema、机器本地 bindings、snapshot、preflight、host、真实 Codex CLI、状态 reader 与 UI status 的定向测试；用中性 fixture 覆盖完整链路，Nocturnel 只做可选集成回归。
- 验收：基础规则保存和运行、资料读取规则最小输入、无预检直接运行、已选预检成功/失败/超时、历史残留高级规则可修复且不阻断其他规则、单规则 fail-closed、固定 argv、脚本摘要变更拒绝、canonical 不可写、Codex 可读、阶段时长、旧 proposal/transaction 路径均通过。

## 风险与恢复

- 预检器必须由机器本地 binding 决定；项目 profile 只能引用 `preflightId`，不得包含命令、解释器、参数模板或隐式项目资源。binding 必须锁定用户确认的 realpath 与内容摘要，项目配置或项目脚本更新均不能静默改变实际执行内容。
- 已启用资料读取但最小输入声明遗漏时，输入准备会快速失败并显示缺失路径，而不是回退到全量项目复制；未启用资料读取的基础规则不进入快照或预检链。
- 预检脚本的解释器和脚本是用户信任边界，不是 OS sandbox；其项目资源必须由 `paths` 显式声明。缺少依赖时失败并显示缺失项，不回退复制 `node_modules`。
- 任何预检或 Codex 失败只删除临时快照并写终态回执；不触碰 canonical 文件。
- 旧项目内 `.data-editor/local/automation-bindings.json` 只读导入 `codexBindings`，不作为 v2 的继续写入位置；不存在的 `preflights` 不自动推断。旧规则缺少 `advancedExecution` 时默认视为基础规则，不强制迁移；历史的裸 `projectInput` 或不完整 `advancedExecution` 仅标记为“高级配置未完成”，可进入设置页修复但不可运行，且不阻断其他规则。完成高级配置的规则绝不允许回退到全量项目复制。

## 完成标准

1. 启用资料读取的大型项目动作不再复制完整项目目录；基础规则不被强制迁移。
2. 未选择预检可直接运行；选择预检时可在隔离快照中执行，失败与超时可观察并清理。
3. DetailPanel 显示真实阶段与对应时长。
4. 真实 Codex CLI 回归证明可读取声明输入、不可写 canonical、可返回受控结果。
5. build、定向测试、服务健康检查与 `npm run service:finalize` 通过。
