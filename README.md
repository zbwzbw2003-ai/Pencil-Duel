# 铅迹追猎 · Pencil Duel

一款保留真实“弹铅笔”手感的网页追逐游戏，支持单机人机对战和互联网双人房间对战，可部署到 Cloudflare Workers 免费套餐。

生产入口：<https://www.photonplanet.com.au/game1>

## 游戏规则

从自己的铅笔附近按住鼠标左键并朝出手方向滑动。鼠标滑动方向决定铅笔方向，滑动距离与按住时长共同决定力度。有效输入时间最长为 0.3 秒：玩家提前松开左键时立即出手，否则到达 0.3 秒时按当时参数自动出手，无需等待松开。触屏设备可使用单指完成同样操作。每次滑程还会受到纸张纹理方向和随机摩擦影响。

任何一方本回合的**完整划痕中心线**穿过对手当前位置的中心点才能获胜（仅保留 2px 数值容差）。画面上的十字线只用于标记中心，不属于碰撞范围。轨迹碰到纸张边缘会立即停止，不会反弹。

## 联机架构

```text
浏览器 A ─ WebSocket ┐
                     ├─ Cloudflare Worker ─ 每个房间一个 Durable Object
浏览器 B ─ WebSocket ┘                         │
                                              └─ 权威计算轨迹、随机摩擦与胜负
```

- 6 位房间码，无需注册游戏账号。
- Durable Object 保存房间状态，并通过 WebSocket Hibernation 降低空闲消耗。
- 客户端只提交方向和力度；服务器生成随机摩擦、计算完整轨迹和碰撞，再向双方广播同一结果。
- 玩家凭证保存在各自浏览器的 `localStorage`，邀请链接只包含房间码。
- 连接中断会自动重连；24 小时无活动的房间自动清理。

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

## 项目结构

```text
assets/               纸张纹理源文件
src/worker.js          Worker 路由与权威 Durable Object 游戏服务器
scripts/               静态资源同步脚本
tests/                 状态恢复及双 WebSocket 冒烟测试
index.html             人机模式
online.html            互联网房间模式
game.js                人机游戏逻辑
online.js              联机客户端、同步动画和重连
styles.css             共用视觉样式
wrangler.jsonc         Cloudflare 配置
```

`public/` 是部署前自动生成的目录，不提交到 Git。
