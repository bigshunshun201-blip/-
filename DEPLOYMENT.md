# 部署说明

## 推荐线上结构

- 前端静态文件部署到 Netlify CDN。
- `/api/status`、`/api/generate`、`/api/topics` 走 Netlify Functions。
- DeepSeek API Key 只配置在 Netlify 环境变量中，不写入前端或 Git 仓库。

## 当前线上站点

- 线上地址：https://roco-shortdrama-studio.netlify.app/
- Netlify 项目：https://app.netlify.com/projects/roco-shortdrama-studio
- Site ID：`896fafd0-4678-4fe3-b221-f08b529d20c8`
- GitHub 仓库：https://github.com/bigshunshun201-blip/-

## 访问控制

线上 API 已增加访问码保护。访问码通过 Netlify 环境变量 `APP_ACCESS_CODE` 配置，不写入前端代码。

当前访问码由 Netlify 环境变量控制。修改方式：

```powershell
npx.cmd netlify env:set APP_ACCESS_CODE "你的新访问码"
```

改完访问码后重新部署，或在 Netlify 后台触发一次 deploy。

## 首次部署

1. 登录 Netlify：

```powershell
npx.cmd netlify login
```

2. 创建或关联站点：

```powershell
npx.cmd netlify init
```

3. 设置线上环境变量：

```powershell
npx.cmd netlify env:set AI_PROVIDER deepseek --secret
npx.cmd netlify env:set DEEPSEEK_API_KEY "你的 DeepSeek API Key" --secret
npx.cmd netlify env:set DEEPSEEK_MODEL deepseek-v4-flash
npx.cmd netlify env:set APP_ACCESS_CODE "你的访问码"
```

4. 发布生产站点：

```powershell
npx.cmd netlify deploy --prod
```

## 后续更新

如果 Netlify 已经连接 GitHub 仓库：

```powershell
git add .
git commit -m "更新短剧工作台"
git push
```

推送后 Netlify 会自动重新构建并更新线上站点。

当前本地仓库已经连接到 GitHub：

```powershell
git remote -v
git push
```

如果没有连接 GitHub，也可以手动部署：

```powershell
npm.cmd run build
npx.cmd netlify deploy --prod
```

## 本地开发

本地仍然可以继续用：

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
