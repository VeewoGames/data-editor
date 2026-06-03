# Data Editor

Data Editor 是一个独立的本地网页数据编辑器，用于编辑项目内的 JSON / CSV 数据文件。它不再要求自己放在业务项目的 `tools/data-editor` 目录下，而是通过 `--project` 指向需要编辑的数据项目。

当前版本是“独立可运行”的第一阶段：运行时、日志、备份和视图配置已经写入目标项目的 `.data-editor/` 目录；后续再继续拆分通用核心、项目适配器和发布包。

## 安装

```powershell
cd C:\Code\data-editor
npm install
npm run build
```

## 打开项目

编辑 Nocturnel：

```powershell
cd C:\Code\data-editor
npm run open -- --project C:\Code\Nocturnel --adapter nocturnel
```

默认地址：

```text
http://127.0.0.1:8787/
```

## 关闭服务

```powershell
cd C:\Code\data-editor
npm run stop -- --project C:\Code\Nocturnel
```

## 开发模式

当你正在修改 Data Editor 前端源码，需要实时检查最新界面时：

```powershell
cd C:\Code\data-editor
npm run dev -- --project C:\Code\Nocturnel --adapter nocturnel
```

## 项目侧配置

目标项目中的配置和运行产物默认放在：

```text
<project>/.data-editor/view-config.json
<project>/.data-editor/view-configs/<profile>.json
<project>/.data-editor/backups/
<project>/.data-editor/runtime/
<project>/.data-editor/logs/
```

其中 `view-config.json` 适合团队共享，`view-configs/<profile>.json` 适合用户个人视图配置。

## 示例

Nocturnel 项目配置示例见：

```text
examples/nocturnel/data-editor.project.json
```

该示例用于说明一个业务项目如何声明数据目录、配置路径、可写范围、主键策略和关联策略。
