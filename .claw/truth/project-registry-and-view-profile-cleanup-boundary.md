# 项目注册表与 view profile 清理边界：三重有效性校验、API 语义与精确文件清理

status: accepted

## 结论

1. 项目选择器的正式注册源是 `%APPDATA%\data-editor\projects.json`；代码入口为 `src/project-registry.mjs` 的 `dataEditorHome()`、`projectRegistryPath()`、`loadProjectRegistry()` 与 `saveProjectRegistry()`。
2. 判断项目注册项是否可清理时，不能只看显示名称。必须交叉验证项目 `root` 是否存在、每个 `dataSources` 解析后的数据目录是否存在且包含符合 `filePolicy.includeExtensions` 的数据文件，以及该项目是否为 `activeProjectId`。
3. 项目注册项通过 `POST /api/project-delete` 删除。`server.mjs` 的 `handleDeleteProject()` 只过滤并保存 registry；它不会删除项目根目录、数据目录或任何业务数据，并且拒绝删除最后一个项目。
4. view profile 默认位于项目 `<root>/.data-editor/view-configs`。若设置 `DATA_EDITOR_PROFILE_HOME`，`src/project-context.mjs` 会将 profile 目录切到该外部 profile home 下的项目分区，因此排查前必须先确认当前 profile home。
5. 当前 view profile API 只有 `GET /api/view-profiles`、`GET /api/view-profile` 与 `POST /api/view-profile`，没有 delete API。清理测试 profile 时，应在确认文件被 gitignore、没有实际 collection 配置且不是正式 profile 后，对明确文件列表做精确文件删除，不能泛删整个 `view-configs` 目录。

## 长期规则

### 项目注册项清理前的三重校验

对 `projects.json` 中每个候选项按以下顺序核对：

1. 解析并检查 `root` 的真实存在性。
2. 按 `dataSources[].kind` 解析数据目录：`relative` 相对项目 `root`，`absolute` 直接解析；检查目录是否存在，并统计符合 `filePolicy.includeExtensions` 的数据文件。
3. 核对 registry 的 `activeProjectId`，避免在未切换活动项目时移除当前运行时入口。

显示名称、相似名称或重复的 `name` 只能作为线索，不能单独构成删除依据。项目 ID、root、数据源与活动状态才是清理判定的正式证据链。

### 项目删除 API 的职责边界

`POST /api/project-delete` 的请求体使用 `{ "projectId": "..." }`。`handleDeleteProject()` 的持久化动作仅限：

- 从 `registry.projects` 移除指定项；
- 如果移除的是活动项目，将 `activeProjectId` 切到剩余项目的第一项；
- 通过 `saveProjectRegistry()` 回写 `projects.json`。

该调用不执行项目目录、数据目录、`.data-editor` 或业务文件的文件系统删除。若用户要求删除实际数据，那是另一项具有独立风险和授权边界的操作，不能从“删除项目注册项”推导出来。

### view profile 的清理边界

- `Lans.json` 是 Git 跟踪的正式 profile，应作为有效用户配置保留。
- probe、perf、proto、failure_dbg 类文件只有在同时确认被 gitignore、没有实际 collection 配置、且不被当前正式流程使用时，才可判定为测试垃圾。
- 当前没有 profile delete API；已确认的测试垃圾只能按明确文件清单精确删除。
- 不得使用名称前缀、通配符或“非 Lans 即垃圾”作为单独依据，也不得删除整个 profile 目录。

## 2026-07-14 盘点与清理基线

清理前的已验证盘点：

- 有效项目 `nocturnel-e621a436` 指向 `C:\Code\Nocturnel`，其数据源中共有 38 个 JSON/CSV 数据文件。
- 无效重复项目 `nocturnel-38dfeffe` 指向不存在的 `C:\Code\Nocturnel\tools\Nocturnel`。
- 误注册项目 `data-editor-11954731` 指向 `C:\Code\data-editor`；该 root 没有 `data` 目录，数据文件数为 0。
- `C:\Code\Nocturnel\.data-editor\view-configs\Lans.json` 是 Git 跟踪正式 profile；其余 6 个 probe/perf/proto/failure_dbg 测试 profile 被 gitignore 且无实际 collection。

清理后的 API 证据：

- `activeProjectId = nocturnel-e621a436`；
- registry 仅保留 `Nocturnel -> C:\Code\Nocturnel`；
- profile 列表仅保留 `Lans`；
- 文件列表仍为 38 个，证明项目注册表与测试 profile 清理没有删除 Nocturnel 业务数据。

清理后的 Browser 证据：

- 项目菜单仅显示 `Nocturnel`；
- profile listbox 仅显示内建的 `浏览器本地` 与正式 profile `Lans`；
- 表格数据正常加载。

因此，registry/profile 清理的 authoritative verification 应同时覆盖 API 返回值与真实 UI：API 用于证明持久化真值已经收口，Browser 用于证明项目选择器、profile 选择器和数据加载链实际消费了同一结果。

这组数量和项目列表是本次清理后的验证快照，不应被当作永远不变的产品常量；后续盘点必须重新从 registry、profile API 与 files API 读取当前值。

## 关联代码与文档

主要锚点：

- `src/project-registry.mjs`：registry home、`projects.json` 路径、规范化、校验和保存。
- `server.mjs`：`POST /api/project-delete` 的路由与 `handleDeleteProject()`。
- `src/project-context.mjs`：默认 `<root>/.data-editor/view-configs` 与 `DATA_EDITOR_PROFILE_HOME` 覆盖规则。

相关入口：

- `src/view-profile.mjs`：profile 的 list/load/save 文件操作。
- `server.mjs`：`/api/view-profiles`、`GET /api/view-profile`、`POST /api/view-profile` 路由。
- `docs/05_数据与配置模型.md`：项目 registry 与 view profile 的配置模型。
- `src/api/client.ts`：前端项目删除和 profile list/load/save 请求封装。

## 验证标准

项目注册清理完成后至少重新验证：

- `/api/projects` 返回预期的 `activeProjectId` 与唯一项目集合；
- 保留项目的 root 和每个数据源仍可访问；
- `/api/files?projectId=<activeProjectId>` 的数据文件数量与清理前一致；
- `/api/view-profiles?projectId=<activeProjectId>` 仅返回应保留的正式 profile；
- Browser 项目菜单与 `/api/projects` 一致，不再出现已移除的注册项；
- Browser profile listbox 除内建的 `浏览器本地` 外，仅显示 `/api/view-profiles` 返回的正式 profile；
- 选中保留项目后表格数据可以正常加载；
- Git 状态没有显示被误删的跟踪 profile 或业务数据文件。

## 关键检索词

`projects.json`、`projectRegistryPath`、`activeProjectId`、`dataSources`、`filePolicy.includeExtensions`、`POST /api/project-delete`、`handleDeleteProject`、`view-configs`、`DATA_EDITOR_PROFILE_HOME`、`Lans.json`、`/api/view-profiles`、`精确文件删除`

## 2026-07-14 无效相对路径复发根因与注册入口校验合同

本次复核发现 `%APPDATA%\data-editor\projects.json` 再次出现 `nocturnel-38dfeffe -> C:\Code\Nocturnel\tools\Nocturnel`，且该路径既不存在，也不是目录。此前“清理后仅保留有效项目”只是当次快照，不能证明错误注册入口已经被封死。

复发根因位于 `src/project-registry.mjs::addOrActivateProject(...)` 的旧实现：输入 root 经过 `path.resolve(...)` 后只使用 `isFilesystemRoot(...)` 拒绝磁盘根目录，没有在持久化前验证 root 是否真实存在且为目录。错误相对路径会基于调用进程 cwd 解析为一个看似合法的绝对路径；只要它不是文件系统根目录，就能继续生成项目 ID 并写入 registry。`server.mjs::ensureInitialProject()` 与 `POST /api/project-create` 最终都调用该入口，因此启动参数和 UI/API 新建项目共享同一缺口。

修复后的长期合同是：`addOrActivateProject(...)` 必须在查重和保存之前调用 `assertProjectRootDirectory(...)`，分别拒绝不存在路径和非目录路径。`tests/project-registry.test.mjs` 至少要覆盖“缺失 root 被拒绝且 registry 保持为空”。该入口校验只阻止新的坏项写入，不会自动清除 `projects.json` 中已经存在的无效注册项；历史坏项仍须按项目 root、数据源与活动状态的既有证据化清理流程单独处理。

关联锚点：

- `src/project-registry.mjs::addOrActivateProject(...)`
- `src/project-registry.mjs::assertProjectRootDirectory(...)`
- `server.mjs::ensureInitialProject()`
- `server.mjs::handleCreateProject(...)`
- `tests/project-registry.test.mjs`

关键检索词：`nocturnel-38dfeffe`、`Project root does not exist`、`Project root is not a directory`、`assertProjectRootDirectory`、`addOrActivateProject`

### 实现与回归状态（2026-07-14）

上述注册入口合同已经落地：`addOrActivateProject(...)` 在写 registry 前对解析后的 root 执行 `stat(root)`；`ENOENT` 明确抛出 `Project root does not exist: <root>`，存在但不是目录时明确抛出 `Project root is not a directory: <root>`。`tests/project-registry.test.mjs` 已加入缺失目录拒绝用例，本轮该文件的 8 个定向测试全部通过。

### 端到端收口快照（2026-07-14）

完成实现后，已通过正式 `POST /api/project-delete` 删除无效注册项 `nocturnel-38dfeffe`。受管新服务对同一错误 root 执行 `POST /api/projects` 时返回 HTTP 500，错误为 `Project root does not exist: C:\Code\Nocturnel\tools\Nocturnel`，证明缺失目录校验已经进入真实 API 调用链，而不只在单元测试中成立。

删除与重启后的权威结果为：`GET /api/projects` 仅保留 `nocturnel-e621a436 -> C:\Code\Nocturnel`，`GET /api/files` 返回 38 个数据文件；Playwright 真实页面中的项目菜单也仅显示一个 `Nocturnel`。因此本轮验收同时覆盖了 registry 持久化真值、服务端拒绝链、文件消费链与真实 UI 消费面。

项目 ID、文件数量和菜单内容是本次端到端验证快照；后续仍应实时读取 API 与 UI，不能把 `38` 当成永久产品常量。
