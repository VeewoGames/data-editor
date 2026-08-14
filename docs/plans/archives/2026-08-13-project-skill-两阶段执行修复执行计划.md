# 方案概述：Project Skill 两阶段执行修复执行计划

## 方案概述

本计划以“需要读取项目资料”作为唯一可选扩展：基础自动化无需任何项目输入；启用后由受控选择器声明最小资料，并可选择或跳过本机预检。解释器、脚本和摘要属于本机维护信息，不进入普通规则编辑。实施顺序为合同与组合保存、隔离执行、状态呈现、回归验证。

## 总体目标与范围

本计划落实已确认的通用边界：所有自动化规则使用同一基础配置；只有用户显式启用“需要读取项目资料”时，规则才声明最小输入，且可选引用 `preflightId`。当前用户设备的 bindings 决定可信预检器。Data Editor 负责校验、隔离快照、状态、进程回收和 canonical 写回 admission；不理解项目业务规则。

执行顺序为“合同与迁移 -> 隔离执行 -> 状态呈现 -> 真实验证”。每章完成后都有独立可观察结果，失败时不进入后续阶段。

## 第 1 章：配置合同与迁移

### 1.1 扩展 Automation Profile

- 输入：`src/automation-profile.mjs` 的 `execution` 校验。
- 动作：增加“需要读取项目资料”开关，并冻结唯一持久化形态为 `execution.advancedExecution.projectInput`。关闭开关时删除整个 `advancedExecution`；不得保存空对象、裸 `projectInput` 或残留字段。开启后目标文件自动写入并锁定，额外资料仅能从当前项目文件及其非根父目录的带筛选选择器加入，禁止手填路径；锁定项必须由精确文件或已选目录覆盖。预检可选“无运行前检查”或有效本机候选；无检查时省略 `preflightId`。仅允许 `project-skill + proposal/result-only` 开启，`project-transaction` 保持原 `ownerId/capabilityId` 合同且不展示开关。

  profile reader 改为逐条解析，返回 profile ETag、合法规则 projection 和 `{ ruleId, rawRule, issues[] }` 可修复错误 projection；坏规则不可运行，但不能阻断其他规则读取、选择和编辑。未保存草稿可以不完整以供继续编辑。新增 `PATCH /api/automation-profile/rules/:ruleId`：客户端提交 profile ETag、目标规则原始摘要及完整替换规则；服务端在同一写临界区验证二者并原子替换目标规则，保留其余 raw rule。冲突返回 `409`，不执行全量覆盖；全量保存仅允许所有规则均可验证时使用。新增组合保存端点，统一接收 profile ETag、bindings revision 与两份草稿：先校验引用和两个版本前置条件，先写 bindings，再写 profile；profile 写入失败则仅在 bindings revision 未变化时恢复此前 bindings 原文，并把无法恢复作为明确失败返回。
- 预期结果：旧 profile 不会整体失效，基础规则保持可用，只有不完整的高级规则不能执行。
- 验证：profile 单元与 API 测试覆盖基础规则、锁定目标自动加入、候选排除项目根、锁定目标不能被删除或替换为无关资料、文件/目录选择器候选、无预检保存与运行、已选预检保存、关闭后删除、空或残留字段拒绝、历史裸 `projectInput` 修复、单条坏规则不阻断读取、原始 JSON 保留、按 `ruleId` 局部 patch、profile ETag 与原始摘要双冲突、bindings revision 冲突、`project-transaction` 组合拒绝、路径逃逸、组合保存及无并发时 bindings 回滚、混合规则与保存新合同。
- 失败处置：高级配置缺失时返回明确原因，不启动快照或 Codex。

### 1.2 扩展本机 Preflight Binding

- 输入：`src/automation-bindings.mjs`。
- 动作：新增机器本地 `%APPDATA%\\data-editor\\automation-bindings\\<projectId>.json`，resolver 顺序为 `%APPDATA%`、`DATA_EDITOR_HOME`、用户 home 下 `.data-editor`。v2 schema 分离 `codexBindings[actionId]` 与 `preflights[preflightId]`；旧项目内 binding 只读导入前者。`preflights` 增加 `label`、可选 `description` 与可选 `recommendedSkills[]` 供规则界面选择；解释器 realpath、脚本 realpath、脚本 SHA-256 与受限短超时只在“本机预检维护”折叠区编辑。首版不支持自定义参数模板或预检专属资源。
- 预期结果：项目 profile 无法直接指定可执行文件或替换已确认脚本。
- 验证：拒绝未知程序、任意路径、shell 字符串、自定义参数模板及脚本摘要变化；验证空候选时普通规则编辑仍可保存“无运行前检查”，无效候选不可选择；验证迁移不会覆盖既有 Codex binding，也不会从项目脚本推断 preflight binding。
- 失败处置：binding 无效即将关联规则标为不可执行。

## 第 2 章：最小快照与两阶段执行

### 2.1 最小快照构造

- 输入：已启用并通过校验的高级执行配置 `projectInput.paths`。
- 动作：替换全项目 `cp`；仅复制声明文件/目录、必要父目录及输出目录，保持 link fail-closed；当前 action target 文件由服务端自动确保被 `paths` 覆盖，预检需要额外项目资源时必须由用户通过选择器直接加入 `paths`。每次运行在快照前重新执行 action target、canonical source identity 与 row identity 校验，只将固定且本次重解析的参数传给宿主。
- 预期结果：不再复制 `node_modules`、assets 与无关目录。
- 验证：快照清单精确匹配声明输入；canonical 内容不变。
- 失败处置：缺失或链接路径写 `terminal failed`，并清理临时目录。

### 2.2 预检宿主

- 输入：可选的机器本地 preflight binding、稳定条目上下文、最小快照。
- 动作：无 `preflightId` 时不启动预检，资料快照完成后直接进入 Codex。选择预检时，以无 shell argv 启动当前用户显式信任的固定预检器，独立短超时，固定保存 stdout 至 `<outputRoot>/preflight.stdout.log`、stderr 至 `<outputRoot>/preflight.stderr.log`。唯一 argv 为 `[scriptRealpath, "--input-root", inputRoot, "--source-path", sourcePath, "--collection-path", collectionPath, "--row-id", rowIdOrEmpty, "--source-row-index", sourceRowIndexOrEmpty]`；所有 flag 必传，缺失身份用空字符串编码，不接受额外参数。该 binding 是信任边界，不承诺 OS 级写入隔离。
- 预期结果：未选预检可直接进入 Codex；选择预检时仅成功才进入 Codex，非零或超时不启动 Codex。
- 验证：无预检、成功、失败、超时均回收 job；用 exact-array 断言验证完整 argv、空身份编码和诊断日志路径；恶意项目配置无法替换预检器。
- 失败处置：发布明确的 `preflight_failed` 或 `preflight_timed_out` 终态原因。

### 2.3 Codex 阶段

- 输入：资料准备完成且预检通过（如已选择）的快照。
- 动作：保留当前结构化 proposal/transaction admission，只让 Codex 使用快照与任务输出目录。
- 预期结果：Codex 可以读取声明输入，canonical 写回仍只能由服务端提交。
- 验证：真实 CLI 可读标记文件、可返回结果、不可修改 canonical sentinel。
- 失败处置：复制诊断并发布 terminal，不保留临时目录。

## 第 3 章：状态与用户反馈

### 3.1 运行状态数据

- 输入：`src/entry-actions.mjs`、API client、运行记录。
- 动作：在 `src/entry-action-state.mjs` 定义 state v3：`queuedAt`、`phaseStartedAt`、`phaseHistory[]`、`terminalAt` 与 `outcome`；资料读取规则加入 `preparing_input`、`review_running`，仅选择预检的规则额外加入 `preflight_running`，基础规则保持既有 `running`。冻结三条状态图：基础规则 `queued -> running -> proposal_ready -> committing -> terminal`；无预检资料规则 `queued -> preparing_input -> review_running -> proposal_ready -> committing -> terminal`；有预检资料规则 `queued -> preparing_input -> preflight_running -> review_running -> proposal_ready -> committing -> terminal`。终态单调且幂等；`preflight_failed` 与 `preflight_timed_out` 作为 terminal outcome。
- 预期结果：状态可跨详情面板关闭/重开恢复。
- 验证：读写运行记录、阶段时间、终态竞争幂等、proposal admission 单调转换、轮询、排序和历史兼容测试通过。

### 3.2 DetailPanel 呈现

- 输入：`src/App.tsx`、`src/detail/DetailPanel.tsx`。
- 动作：显示中文阶段、当前阶段耗时与总耗时；终态明确失败发生在哪一阶段。未选择预检的资料规则不显示预检阶段。
- 预期结果：不再把快照复制时间显示成 Codex 运行时间。
- 验证：组件测试或浏览器验证准备、预检、评审、终态四种状态。

## 第 4 章：回归与运行验证

### 4.1 定向自动测试

- 动作：运行 profile/binding/snapshot/preflight/host/service/UI 定向测试和中性 fixture 的真实 CLI e2e；Nocturnel 仅做可选集成验证。
- 验收：每条安全与状态分支都有覆盖。

### 4.2 正式服务验证

- 动作：build、重启服务、检查 health；使用中性 fixture 完成一次无预检资料读取运行和一次有预检的 proposal 受控执行验证。Nocturnel 仅在环境可用时作为附加集成回归，不是完成前提。
- 验收：页面显示阶段变化，结果可恢复，中性 fixture 的 canonical 数据仅经 admission 更新。
- 失败处置：保留诊断、清理临时目录、回滚到无可执行状态而不是恢复全量快照。

## 完成标准

1. 基础规则保持可见、可保存、可执行；只有不完整的高级规则不可执行。
2. 启用资料读取的规则只复制声明输入；未选择预检时直接进入 Codex，选择预检时通过本机绑定运行检查。
3. UI 准确显示准备、预检、评审与提交阶段。
4. 真实 CLI 与 canonical 安全回归均通过。
5. `npm run build`、定向测试、`npm run service:finalize` 与两个 health 端点通过。
