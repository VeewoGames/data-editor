# 项目注册表写入防线与 view profile 的证据化清理策略

status: accepted

## context

Data Editor 的项目注册表与 view profile 都是用户可见配置，但二者的存储和删除语义不同：项目注册项由 `projects.json` 持久化并通过服务端 API 管理，view profile 则是项目目录或 `DATA_EDITOR_PROFILE_HOME` 下的 JSON 文件。显示名称相似、文件未被 Git 跟踪或配置暂时未被 UI 使用，都不足以单独证明配置可以删除。

清理错误的项目注册项时，还必须避免把“移除 registry 引用”误解为“删除项目磁盘数据”；清理测试 profile 时，也必须保护 Git 跟踪的正式用户配置，不能按名称前缀或目录范围泛删。

仅清理历史坏项不能阻止复发。项目创建或激活入口若只把相对路径解析为绝对路径、却不验证目标真实存在且为目录，错误 cwd 派生出的路径仍会被持久化为新项目。因此 registry 的长期合同必须同时覆盖写入前校验与写入后的证据化清理。

## decision

### 1. 项目注册项删除前必须完成三重有效性校验

删除候选注册项前，必须交叉核对：

- `root` 指向的项目根目录是否存在且属于预期项目；
- `dataSources` 解析后的数据目录是否存在，并能按 `filePolicy.includeExtensions` 找到预期数据；
- 候选项与 registry 的 `activeProjectId` 是什么关系。

项目显示名称和项目 ID 只作为定位线索，不能代替上述证据。仅在三重证据共同证明注册项无效或误注册后，才允许删除。

### 2. 项目创建或激活必须在写 registry 前验证 root

`addOrActivateProject(...)` 是启动初始化和项目创建共用的持久化入口。它必须在查重、生成项目 ID 和保存 registry 之前，对解析后的 `root` 执行文件系统校验：目标不存在时拒绝写入，目标存在但不是目录时同样拒绝写入。

路径规范化与“不是文件系统根目录”检查不能替代存在性和目录类型校验。该入口防线只阻止新的坏项写入，不自动删除已经存在于 `projects.json` 的历史无效项；历史项仍按三重有效性校验和正式删除 API 单独处理。

### 3. 项目注册清理统一使用 `POST /api/project-delete`

正式清理入口是 `POST /api/project-delete`，请求体使用 `{ "projectId": "..." }`。该操作的职责仅限于更新并保存 registry：移除指定注册项，并在必要时重选 `activeProjectId`。

该接口不删除项目根目录、`dataSources` 指向的数据目录或任何业务数据。调用方不得把 registry 清理扩展成磁盘数据清理；若未来需要删除业务数据，必须设计独立、显式的生命周期协议。

### 4. view profile 只允许基于明确证据精确删除

正式 profile 与测试 profile 的判定必须同时考虑 Git 跟踪状态、名称用途和文件内容。Git 跟踪的正式 profile（本轮已确认的 `Lans.json`）必须保留；只有被忽略且名称、内容均能证明为测试探针的文件，才可按明确文件列表删除。

当前 view profile 没有 delete API，因此清理只能针对已经确认的具体文件执行。不得使用通配符、名称前缀、“非某正式 profile 即垃圾”等规则，也不得删除整个 `view-configs` 目录。

## alternatives considered

- 只按显示名称或重复名称删除项目：无法证明实际 `root`、数据源和活动项目归属，拒绝采用。
- 仅在 UI 隐藏重复项或反复删除历史坏项：没有封住错误 root 的持久化入口，无法防止复发，拒绝作为最终方案。
- 只做 `path.resolve(...)` 或文件系统根目录检查：不能证明目标存在且为目录，拒绝作为完整写入校验。
- 直接编辑 `projects.json`：绕过服务端规范化、校验和活动项目切换语义，拒绝作为正式清理路径。
- 删除注册项时同步删除项目目录或数据源：超出 `POST /api/project-delete` 的职责边界，存在业务数据损失风险，拒绝采用。
- 按 profile 名称模式或整个目录批量删除：无法可靠区分正式配置与测试探针，拒绝采用。

## related code

- `src/project-registry.mjs`
- `src/project-context.mjs`
- `src/view-profile.mjs`
- `server.mjs`
- `src/api/client.ts`
- `tests/project-registry.test.mjs`

## consequences

- 所有项目创建/激活调用方共享 `addOrActivateProject(...)` 的 root 目录校验，错误路径不能再成为持久项目。
- 写入防线与历史清理保持分工：校验不隐式修改旧 registry，旧坏项仍需经过证据链和正式 API 清理。
- 项目清理流程必须先形成 `root`、`dataSources`、`activeProjectId` 的证据链，再调用正式 API。
- registry 清理与磁盘业务数据删除保持职责分离；验证 registry 收口时，还应确认业务文件集合未发生非预期变化。
- profile 清理需要逐文件确认，批量清理的便利性让位于正式用户配置的安全性。
- `DATA_EDITOR_PROFILE_HOME` 会改变 profile 的实际位置，清理前必须先确认当前 profile home，不能只检查项目内默认目录。
- 若未来新增 profile delete API，它仍必须保留“明确目标、正式 profile 保护、禁止目录级泛删”的合同。

## search terms

`projects.json`、`projectRegistryPath`、`addOrActivateProject`、`assertProjectRootDirectory`、`Project root does not exist`、`Project root is not a directory`、`activeProjectId`、`dataSources`、`filePolicy.includeExtensions`、`POST /api/project-delete`、`handleDeleteProject`、`view-configs`、`DATA_EDITOR_PROFILE_HOME`、`Lans.json`、`测试 profile`、`精确文件删除`
