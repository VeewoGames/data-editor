# 共享视图图标收藏刷新修复：profile 落盘时机与正式服务版本合同

status: accepted

## context

本轮修复聚焦共享视图图标收藏刷新后丢失，以及图标包加载看起来失效的排查边界。实际结论不是继续在前端按钮逻辑上猜测，而是先确认正式服务是否跑在当前代码版本、是否真正提供图标包接口，再判断前端状态机是否有问题。

同时，收藏丢失问题证明了 profile 的克隆与刷新前落盘是同一条合同的一部分：只修“点击后状态变化”而不修“selected profile 的克隆与立即保存”，刷新后仍然可能把收藏回退为空。

## decision

### 1. 图标包加载问题优先按正式服务版本漂移排查

共享视图图标包加载异常时，默认优先确认正式服务是否是当前代码版本，而不是先把问题归因给前端按钮逻辑。

排查顺序固定为：

1. 先确认 `8787` 上跑的是当前代码版本。
2. 再确认 `8787/api/health` 与 `8791/health` 健康。
3. 再确认正式服务提供 `GET /api/shared-view-icon-pack`，并且能返回对应 `packId` 的 raw SVG map。
4. 最后才检查前端 `loadSharedViewIconPack(...)` / `unloadSharedViewIconPack(...)` 的交互行为。

这条顺序是正式合同，不是临时排障技巧。

### 2. 收藏修复必须同时覆盖 profile 克隆与刷新前落盘时机

共享视图图标收藏的稳定修复必须同时满足两点：

- `selectedViewProfile` 的克隆对象必须携带 `favoriteSharedViewIconIds`
- 收藏切换后必须在刷新之前落盘到 profile，而不是只停留在内存态 draft

对应实现边界固定在：

- `src/App.tsx` 的收藏切换与 selected profile mutate/save 链路
- `src/view-profile.mjs` 的 normalize / serialize / empty profile 逻辑
- `src/api/client.ts` 的 `UserViewProfile.favoriteSharedViewIconIds` 类型与保存接口

只修其中一侧都不算完成。

### 3. 正式服务必须提供 `GET /api/shared-view-icon-pack`

共享视图图标包的正式运行时合同固定为后端按 pack 交付 raw SVG：

- 路由：`GET /api/shared-view-icon-pack?packId=...`
- 语义：返回该 pack 对应的 SVG map
- 消费端：`src/components/icons.ts` 通过 `loadSharedViewIconPack(...)` 拉取并注册运行时组件

这意味着图标包加载的真相源是正式服务，而不是前端 bundle 内的预置资产或临时静态猜测。

## consequences

- 以后再出现“收藏刷新后丢失”，先查 profile 克隆和立即保存是否完整，再查是否有前端渲染问题。
- 以后再出现“图标包加载了但仍是占位态”，先查 `8787` 是否为当前代码版本，以及 `GET /api/shared-view-icon-pack` 是否可用，再查前端加载逻辑。
- `favoriteSharedViewIconIds`、pack 加载接口和正式服务版本这三者被收束到同一条长期排查合同里，避免把服务漂移误判成 UI 回归。

## related code

- `src/App.tsx`
- `src/api/client.ts`
- `src/view-profile.mjs`
- `src/components/icons.ts`
- `server.mjs`
- `tests/view-profile.test.mjs`
- `tests/view-state.test.mjs`
- `tests/data-editor.spec.ts`
- `.claw/tasks/修复图标收藏刷新后丢失/plan.json`

