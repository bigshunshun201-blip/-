# 部署说明

## 当前线上站点

- 线上地址：https://roco-shortdrama-studio.roco-story-lab.workers.dev
- GitHub 仓库：https://github.com/bigshunshun201-blip/-.git
- 托管方式：Cloudflare Worker + Static Assets
- 用量数据库：Cloudflare D1 `roco-shortdrama-usage`

## 自动部署

推送到 GitHub `main` 分支后，现有 GitHub Actions 工作流会自动执行构建和 Worker 部署。DeepSeek 密钥、访问码和 Cloudflare Token 都保存在对应平台的 Secret 中，不进入仓库。

```powershell
git add .
git commit -m "更新短剧生产系统"
git push origin main
```

## 数据库迁移

用量数据库配置在 `wrangler.jsonc`，迁移文件位于 `migrations/`。新增迁移后，部署前执行：

```powershell
npx.cmd wrangler d1 migrations apply roco-shortdrama-usage --remote
```

## 手动部署

```powershell
npm.cmd test
npm.cmd run build
npx.cmd wrangler deploy
```

## 本地开发

直接使用本地 Node 服务：

```powershell
$env:AI_PROVIDER="deepseek"
$env:DEEPSEEK_API_KEY="你的 DeepSeek API Key"
node server.js
```

打开 `http://127.0.0.1:8765/`。DeepSeek 模式会复用线上 Worker 的同一套 API 路由；Ollama、OpenAI-compatible 和 OpenAI 仍使用 `server.js` 中的兼容实现。

使用 Wrangler 本地 Worker 前，先初始化本地 D1：

```powershell
npx.cmd wrangler d1 migrations apply roco-shortdrama-usage --local
npm.cmd run dev:cloudflare
```
