# 云上菜园

一个 2D 手机种菜游戏原型，支持公共大地图、本地游玩、PWA 离线缓存、GitHub 仓库文件同步房间状态。

## 当前已完成

- 横屏移动端界面：启动页、HUD、四方向虚拟摇杆、图标工具栏、作物选择栏。
- 公共大地图：默认进入 `PUBLIC-FARM`，所有配置了同一 GitHub 存档的玩家会同步到同一张地图。
- 核心玩法：上下左右移动、播种、浇水、成熟、收获、金币、经验、等级、开垦土地。
- 种植系统：作物有成本、成长时间、需水量，地块有湿度和肥力，浇水会影响成长效率。
- 社交系统：内置世界公屏，可在同步房间中保存聊天记录。
- 视觉内容：包含玩家小屋、集市、温室、风车仓库、池塘、道路、迷你地图和人物 2D 建模。
- 联机雏形：可配置 GitHub Personal Access Token，把地图状态同步到仓库 `rooms/<地图频道>.json`。
- PWA：包含 `manifest.webmanifest` 和 `sw.js`，可作为 GitHub Pages 静态站点部署。

## 重要安全说明

不要在游戏里、代码里或聊天里保存 GitHub 账号密码。GitHub 后端设置只支持 Token，并且 Token 只保存在玩家自己的浏览器 `localStorage` 中。

如果密码已经暴露，请立刻修改密码，并开启两步验证。

## GitHub 后端使用方式

1. 在 GitHub 创建一个仓库，例如 `cloud-farm-save`。
2. 创建 Fine-grained Personal Access Token。
3. 给该 Token 授权目标仓库的 `Contents: Read and write` 权限。
4. 打开游戏，点击“GitHub 后端设置”。
5. 填写用户名、仓库名、分支和 Token。
6. 进入同一个房间码后，点击“同步”。

这个方案适合轻量房间存档，不适合毫秒级实时对战。真正商业级联机建议改成 WebSocket 服务、Firebase、Supabase Realtime 或 Cloudflare Durable Objects。

## 部署到 GitHub Pages

1. 把本文件夹里的所有文件推送到 GitHub 仓库。
2. 在仓库 `Settings > Pages` 中选择部署分支。
3. 访问 GitHub Pages 地址即可游玩。

## 操作说明

- 手机：左下角四方向移动，右下角播种、浇水、收获、开垦。
- 电脑：`W`/`A`/`S`/`D` 或方向键移动，`J` 播种，`K` 浇水，`L` 收获，`Enter` 打开公屏。

## 后续建议

- 把 GitHub 同步层替换为真正实时后端。
- 增加好友系统、交易所、每日任务、天气、宠物、装饰、赛季活动。
- 加入服务端校验，防止玩家篡改金币和作物状态。
