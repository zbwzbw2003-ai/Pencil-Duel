# 铅迹追猎 · Pencil Duel

一款保留真实“弹铅笔”手感的网页追逐游戏，支持单机人机对战和互联网双人房间对战，可部署到 Cloudflare Workers 免费套餐。

生产入口：<https://www.photonplanet.com.au/game1>。Worker 本身不拥有域名路由，
仅由 Photon Planet 平台 Router 通过 Service Binding 调用，因此独立发布不会影响主站或其他应用。

## 游戏规则

从自己的铅笔附近按住并朝出手方向滑动。铅笔尖严格沿“鼠标/手指按下点 → 最后有效位置”的中心线滑动；方向由手势决定，滑动距离与按住时长共同决定力度。触屏设备使用单指 Touch, drag and flick，桌面端使用 Hold and flick。

首局是不限时的互动练习。之后可选择 Easy（0.8 秒）、Normal（0.5 秒）或 Expert（0.3 秒）；提前松开立即出手，达到上限时会按当时参数自动出手。每场比赛会公开纸张条件（Smooth / Grain / Rough）及摩擦等级，纸张参数在整局内固定，不再用隐藏的 ±16% 距离随机值干扰操作反馈。

任何一方本回合的**完整划痕中心线**穿过对手当前位置的中心点才能获胜（仅保留 2px 数值容差）。画面上的十字线只用于标记中心，不属于碰撞范围。轨迹碰到纸张边缘会立即停止，不会反弹。每次未命中都会显示最近距离，例如 `MISS BY 4.7 px`，并在结算页显示 Closest、Accuracy、Power 与 Win Streak。

## 联机架构

```text
浏览器 A ─ WebSocket ┐
                     ├─ Cloudflare Worker ─ 每个房间一个 Durable Object
浏览器 B ─ WebSocket ┘                         │
                                              └─ 权威计算轨迹、固定纸张条件与胜负
```

- 6 位房间码，无需注册游戏账号。
- Durable Object 保存房间状态，并通过 WebSocket Hibernation 降低空闲消耗。
- 客户端只提交方向和力度；服务器选择并公开本局纸张条件，计算完整轨迹、最近距离和碰撞，再向双方广播同一结果。
- 玩家凭证保存在各自浏览器的 `localStorage`，邀请链接只包含房间码。
- 连接中断会自动重连；24 小时无活动的房间自动清理。
- Online Arena 在打开时请求 `/api/health`；服务不可用时会显示 `SERVER OFFLINE — Solo mode still available`，而不是将初始状态误报为故障。

## 本地开发

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

访问 Wrangler 输出的地址。人机模式在 `/index.html`，联机模式在 `/online.html`。

构建检查：

```bash
npm run check
```

单元测试（Node.js 内置 test runner，无需额外服务）：

```bash
npm test
# 或 npm run test:unit
```

测试覆盖尺寸归一化、公开状态脱敏、线段距离、纸张摩擦、力度与边界停止、精确中心命中/擦边未命中，以及联机断线恢复状态。

联机冒烟测试需要先运行 `npm run dev`，再在另一个终端执行：

```bash
npm run test:smoke
```

## 免费部署到 Cloudflare

1. 注册 Cloudflare 账户，并在本机登录 Wrangler：

   ```bash
   npx wrangler login
   ```

2. 部署 Worker、静态资源和 SQLite-backed Durable Object：

   ```bash
   npm run deploy
   ```

3. 打开 Wrangler 返回的 `*.workers.dev` 地址，把 `/online.html` 的邀请链接发给另一位玩家。

配置采用 `wrangler.jsonc` 的 declarative Durable Object `exports`，无需单独创建数据库或 WebSocket 服务。

## GitHub Actions CI/CD

`.github/workflows/ci-cd.yml` 会在 Pull Request 中运行 `npm test` 和 `npm run check`；只有变更合并到 `main` 后，才会自动部署到 Cloudflare。也可以从 `main` 手动触发部署。

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中设置以下两个 Repository secrets：

- `CLOUDFLARE_API_TOKEN`：只授予目标账户 Workers 部署权限的 Cloudflare API Token。
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID。

API Token 不要写入仓库文件或提交记录。

## 项目结构

```text
assets/               纸张纹理源文件
src/worker.js          Worker 路由与权威 Durable Object 游戏服务器
scripts/               静态资源同步脚本
tests/                 物理/状态单元测试及双 WebSocket 冒烟测试
index.html             人机模式
online.html            互联网房间模式
game.js                人机游戏逻辑
online.js              联机客户端、同步动画和重连
styles.css             共用视觉样式
wrangler.jsonc         Cloudflare 配置
```

`public/` 是部署前自动生成的目录，不提交到 Git。
