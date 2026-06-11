# Data Editor

Data Editor 是一个独立的本地网页数据编辑器，用于编辑一个或多个本地项目中的 JSON / CSV 数据文件。它不再要求自己放在业务项目的 `tools/data-editor` 目录下，而是通过本机项目 registry 管理项目列表，并在 UI 中切换当前项目。

当前版本支持多项目和自定义数据源：运行时状态与日志写入全局 Data Editor home，业务项目自己的视图配置仍写入对应项目的 `.data-editor/` 目录。

## 安装

```powershell
cd C:\Code\data-editor
npm install
npm run build
```

## 打开和切换项目

首次编辑 Nocturnel：

```powershell
cd C:\Code\data-editor
npm run open -- --project C:\Code\Nocturnel --adapter nocturnel
```

这条命令会把 `C:\Code\Nocturnel` 注册到本机 registry，并设为当前 active project。后续可以在左侧 Sidebar 顶部的项目下拉框中切换项目，也可以点击旁边的设置按钮新增项目、修改项目根目录和自定义数据源。

默认地址：

```text
http://127.0.0.1:8787/
```

如需自定义 registry、运行时状态和日志目录，设置 `DATA_EDITOR_HOME` 或传入 `--registry-home`：

```powershell
$env:DATA_EDITOR_HOME = "C:\Users\lans\.data-editor"
npm run open -- --project C:\Code\Nocturnel --adapter nocturnel
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
npm run dev -- --project C:\Code\Nocturnel --adapter nocturnel
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

## 示例

Nocturnel 项目配置示例见：

```text
examples/nocturnel/data-editor.project.json
```

该示例用于说明一个业务项目如何声明数据目录、配置路径、可写范围、主键策略和关联策略。
