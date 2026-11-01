# Data Editor

Data Editor 是一个独立的本地网页数据编辑器，用于编辑一个或多个本地项目中的 JSON / CSV 数据文件。它不再要求自己放在业务项目的 `tools/data-editor` 目录下，而是通过本机项目 registry 管理项目列表，并在 UI 中切换当前项目。

当前版本支持多项目和自定义数据源：运行时状态与日志写入全局 Data Editor home，业务项目自己的视图配置仍写入对应项目的 `.data-editor/` 目录。

## 安装

```powershell
cd C:\Code\data-editor
npm install
npm run build
```

## 本机历史保护存储

Windows x64 交付包含固定的原生 Known Folder 定位器。历史保护的可信存储固定为当前账户 OS `FOLDERID_Profile` 下的 `.data-editor/deployment-authority`，避免 AppData 新建目录在 Windows 包宿主中重定向为包私有副本；不读取 `USERPROFILE` 环境变量。该位置独立于项目 registry、`DATA_EDITOR_HOME`、项目配置及调用包身份。store 保留读取前、创建后和激活时的反别名检查，不会自动接受重定向目标。运行时缺失或损坏时拒绝写入和自动化，不会回退读取源码旧配置或另一个库；旧位置存在内容时须先审阅专门迁移，禁止自动合并或初始化掩盖旧保护。

仅对没有既有保护材料的全新安装，显式初始化空目录：

```powershell
npm run authority -- init-empty --confirm-new-install
```

有既有历史保护的部署必须先停用所有写者，保留完整旧工具、原账本和证明，使用候选工具生成并审阅迁移包：

```powershell
npm run authority -- prepare --source-tool C:\Backups\SourceEditor --project C:\Projects\Demo --output C:\Migration\approved-bundle.json
npm run authority -- apply --bundle C:\Migration\approved-bundle.json --bundle-digest <已确认的SHA256>
npm run authority -- verify
```

`prepare` 只读当前信任存储和旧证明，输出父目录须已存在；`apply` 在锁内重算来源、代际和完整写集，精确重复执行仍会验证原件和当前工具。迁移不改业务文件、旧 ledger 或未知运行结果。原件、代码或业务前像变化时重新准备和审阅，不能手改摘要或清空 catalog。激活后验证失败应停止写者并向前修复，不能恢复旧 authority 降级保护。

离线迁移没有 HTTP 管理入口。原生 helper 的重建命令为 `npm run build:authority-locator`；重建改变交付摘要，须在生成最终迁移包前完成。

项目技能的 `workspace-write` 明确排除系统临时目录的隐式写权限，不能因文件位于 TEMP 就越过工作根。默认 snapshot 是可计算的一次性输入副本，副本修改不会自动回拷正式数据；输出仍通过 result/proposal 提交。规则明确选择 `project-write` 时，保留所选项目根内的写能力。这两种模式都不会自动增加其他临时目录为可写项目。

## 打开和切换项目

首次编辑一个项目：

```powershell
cd C:\Code\data-editor
npm run open -- --project C:\Code\MyProject
```

这条命令会把目标目录注册到本机 registry，并设为当前 active project。后续可以在左侧 Sidebar 顶部的项目下拉框中切换项目，也可以点击旁边的设置按钮新增项目、修改项目根目录和自定义数据源。

默认地址：

```text
http://127.0.0.1:8787/
```

如需自定义 registry、运行时状态和日志目录，设置 `DATA_EDITOR_HOME` 或传入 `--registry-home`：

```powershell
$env:DATA_EDITOR_HOME = "C:\Users\lans\.data-editor"
npm run open -- --project C:\Code\MyProject
```

## 关闭服务

```powershell
cd C:\Code\data-editor
npm run stop
```

## 开发模式

当你正在修改 Data Editor 前端源码，需要实时检查最新界面时：

```powershell
cd C:\Code\data-editor
npm run dev -- --project C:\Code\MyProject
```

## 配置与运行时位置

本机项目 registry 默认放在：

```text
%APPDATA%\data-editor\projects.json
```

运行时状态和日志默认放在：

```text
%APPDATA%\data-editor\runtime\
%APPDATA%\data-editor\logs\
```

目标项目中的业务配置默认放在：

```text
<project>/.data-editor/view-config.json
<project>/.data-editor/shared-views.json
<project>/.data-editor/view-configs/<profile>.json
```

其中 `view-config.json` 适合团队共享字段语义配置，`shared-views.json` 保存团队共享视图，`view-configs/<profile>.json` 适合用户个人视图配置。

数据文件当前默认采用 `direct-write` 保存策略，不再生成本地 `.bak` 备份目录；版本回退主要依赖 Git。

## 自定义数据源

每个项目至少有一个默认数据源：

```text
data|Data|relative|data
```

在项目设置对话框中，每行声明一个数据源，格式为：

```text
<id>|<label>|<kind>|<path>
```

示例：

```text
data|Data|relative|data
balance|Balance|relative|configs/balance
shared|Shared|absolute|D:\GameData\shared
```

文件列表中的路径会以数据源 id 作为前缀，例如 `balance/items.json`。保存时后端会重新解析该虚拟路径，并限制写入在已注册的数据源范围内。

## 项目声明

项目专用能力在 `<project>/.data-editor/project.json` 中声明。Data Editor 只读取通用 capability manifest、数据源与文件策略，不内置任何业务项目的 adapter。
