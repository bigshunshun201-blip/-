# 部署说明

## 当前线上站点

- 线上地址：https://roco-shortdrama-studio.netlify.app/
- Netlify 项目：https://app.netlify.com/projects/roco-shortdrama-studio
- Site ID：`896fafd0-4678-4fe3-b221-f08b529d20c8`
- GitHub 仓库：https://github.com/bigshunshun201-blip/-

## 线上结构

- 前端静态文件由 Netlify CDN 托管。
- `/api/status`、`/api/generate`、`/api/topics` 由 Netlify Functions 提供。
- DeepSeek API Key 只配置在 Netlify 环境变量里，不写入前端代码或 GitHub 仓库。
- GitHub `main` 分支 push 后会通过 webhook 触发 Netlify 自动构建。

## 访问控制

线上 API 已增加访问码保护。访问码由 Netlify 环境变量 `APP_ACCESS_CODE` 控制。

修改访问码：

```powershell
npx.cmd netlify env:set APP_ACCESS_CODE "你的新访问码"
```

修改后重新部署，或在 Netlify 后台触发一次 deploy。

## 后续更新

本地改完代码后执行：

```powershell
git add .
git commit -m "更新短剧工作台"
git push
```

推送到 GitHub 后，Netlify 会自动重新构建并更新线上站点。

## 手动部署

如果临时不走 GitHub 自动部署，也可以手动发布：

```powershell
npm.cmd run build
npx.cmd netlify deploy --prod
```

## 本地开发

```powershell
$env:AI_PROVIDER="deepseek"
$env:DEEPSEEK_API_KEY="你的 DeepSeek API Key"
$env:DEEPSEEK_MODEL="deepseek-v4-flash"
node server.js
```

然后打开：

```text
http://127.0.0.1:8765/
```
