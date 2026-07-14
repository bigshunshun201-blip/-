# 洛克王国短剧创作工作台

这是一个可本地运行并部署到 Cloudflare Workers 的连续短剧生产工具。它包含内容项目、短剧圣经、单集策划、剧本版本、对应分镜、一致性检查、发布复盘和内容资产库。

## 推荐：使用 DeepSeek

DeepSeek 官方 API 兼容 OpenAI Chat Completions 格式。当前推荐使用 `deepseek-v4-flash` 或 `deepseek-v4-pro`。

```powershell
cd C:\Users\Administrator.DESKTOP-NB96DIF\Documents\Codex\2026-07-03\wo\outputs\rock-kingdom-shortdrama-studio

$env:DEEPSEEK_API_KEY="你的 DeepSeek API Key"
$env:DEEPSEEK_MODEL="deepseek-v4-flash"

node server.js
```

然后打开：

```text
http://127.0.0.1:8765/
```

页面右上角应显示：

```text
AI 已连接 · deepseek · deepseek-v4-flash
```

每个 AI 模块都有独立的模型开关：

- `Flash`：`deepseek-v4-flash`，更快，适合批量出稿和选题测试。
- `Pro`：`deepseek-v4-pro`，质量更高，适合定稿和复杂剧情。

`DEEPSEEK_MODEL` 只是默认值；策划、节拍、剧本、分镜、台账和剧本医生等模块可以分别选择模型，互不影响。

## 部署到 Cloudflare Workers

线上版本使用 Cloudflare Worker 同时托管网页与 `/api/*` 生成接口。DeepSeek Key 只保存在 Cloudflare 的 Secret 中，不会下发到浏览器，也不会进入 Git 仓库。

首次部署在项目目录执行：

```powershell
npm.cmd run build
npx.cmd wrangler login
npx.cmd wrangler secret put DEEPSEEK_API_KEY
npx.cmd wrangler secret put APP_ACCESS_CODE
npx.cmd wrangler deploy
```

`APP_ACCESS_CODE` 是你自己设置的私有访问码。部署完成后打开 Wrangler 输出的 `workers.dev` 地址，首次使用时页面会要求输入该访问码。

首次创建用量数据库后执行迁移：

```powershell
npx.cmd wrangler d1 migrations apply roco-shortdrama-usage --remote
```

后续本地改动推送到 `main` 后，GitHub Actions 会自动构建并部署。也可以手动运行：

```powershell
npm.cmd run deploy:cloudflare
```

仓库已包含 GitHub Actions 自动部署工作流。配置一次 `CLOUDFLARE_API_TOKEN` GitHub Secret 后，每次推送 `main` 都会自动部署；本地命令仍可用于立刻手动发布。

## 使用流程

1. 左侧填写主题、角色、剧情方向、目标受众、视频时长和风格。
2. 先生成或填写本集策划，再生成并确认8节拍表。
3. 点击 `AI 生成剧本`，筛选和确认剧本；满意后再生成分镜，分镜会写回对应剧本版本。
4. 查看 `剧本`、`分镜`、`生成记录`、`标题封面`、`完整示例` 等页签。
4. 如果觉得当前题材不错，在 `续写要求` 里写下一集方向，然后点击 `AI 续写下一集`。
5. 如果有爆款参考数据，把 CSV 粘到 `爆款参考 CSV` 后点击 `更新选题库`；没有数据也会使用默认样例生成选题参考。
6. 在 `选题库` 里不满意当前候选，可以点 `AI 换一批选题`；只是不满意某一条，可以点该卡片的 `替换这条`。
7. 在 `选题库` 里看中某个创意，可以点 `用这个选题生成本集`；已经有一集成稿后，可以点 `沿这个选题续写下一集`。
8. 在 `生成记录` 里筛选候选：`查看/恢复`、`基于它续写`、`标记入围`、`删除`，也可以 `导出全部记录`。
9. 用 `导出当前结果 Markdown` 保存当前结果。

## 续写用法

先生成第一集。觉得创意不错后，在 `续写要求` 中输入类似：

```text
接着上一集，揭晓暗影博士为什么让喵喵失忆；情绪更催泪，结尾留下第三集钩子。
```

然后点 `AI 续写下一集`。工具会把当前剧本和分镜作为上下文发给模型，让它生成下一集，而不是重新从零开始。

如果你是在 `选题库` 里看到一个题材不错，直接点该卡片里的 `用这个选题生成本集`。工具会自动把选题标题、卖点、人群、情绪和反转写入左侧输入区，再调用 AI 生成。

已经生成第一集后，再点同一张卡片里的 `沿这个选题续写下一集`。工具会把当前剧本、当前分镜和该选题的卖点/反转一起传给模型，生成承接上一集的新一集。

## 选题参考用法

`选题库` 顶部会显示轻量参考摘要：优先参考标题、可借钩子、评论需求和下一批测试方向。它只帮助判断选题，不再展开复杂竞品表。

如果当前选题不满意：

- `AI 换一批选题`：调用当前 AI 模型重新生成 8 条，避开已有标题和反转。
- `替换这条`：只替换单张卡片，适合边看边筛。
- AI 不可用时会自动使用本地备选题材兜底，不会让选题库空掉。
- 换出来的新选题会随草稿保存在当前浏览器里，刷新后仍会保留。

## 生成记录用法

每次点击 `AI 生成剧本` 或 `AI 续写下一集`，工具都会自动把结果保存到 `作品库`，最多显示 60 条。项目版本是剧本和分镜的唯一完整档案；作品库只保存索引，避免同一内容重复占用空间。项目档案先写入浏览器 IndexedDB，再通过现有 Cloudflare D1 自动创建最多20个云端恢复点。恢复密钥只保存在浏览器中，可复制到新设备连接同一备份空间。

- `查看/恢复`：把某条历史结果恢复到当前剧本和分镜区。
- `基于它续写`：先恢复这条记录，再把它作为上一集生成下一集。
- `标记入围`：把值得继续打磨的候选留下来。
- `清空记录`：只清空未入围记录，已入围候选会保留。
- `导出全部记录`：把候选池导出成 Markdown，方便集中筛选。

## 文件说明

- `server.js`：轻量本地静态服务，所有 DeepSeek API 路由直接复用 Cloudflare Worker 实现。
- `cloudflare/worker.mjs`：线上 AI API、访问控制、生成提示、超时和每日预算保护。
- `app-state.js`：前端工作台状态与各模块独立模型偏好。
- `ai-operation.js`：AI 生成互斥、上下文指纹和过期结果保护。
- `generation-client.js`：AI 请求、异步任务轮询和生成进度回调。
- `archive-sync.js`：本地版本写入、跨标签冲突保护、云端备份和恢复点。
- `workflow-core.js`：项目连续性选集和作品库去重规则。
- `project-domain.js`：内容项目、集数版本、本集策划校验和发布复盘规则。
- `episode-planner.js`：不消耗 AI 积分的本集策划起步器与补全规则。
- 本集策划支持免费快速填充和 DeepSeek 实时生成三套方案；从选题库进入时只建立待策划草稿，不会跳过确认直接生成剧本。
- `ui-templates.js`：剧本、分镜、作品库和通用表格模板。
- `api-client.js`：访问码重试、请求超时和 API 错误解析。
- `data-store.js`：IndexedDB 项目档案和旧数据兼容迁移。
- `app.js`：页面状态、AI 请求、渲染、复制和导出。
- `generator.js`：选题库、轻量数据参考和离线辅助逻辑。
- `index.html`：页面结构。
- `styles.css`：界面样式。

## 合规提醒

当前定位为粉丝向/二创灵感工作台，不代表官方内容或授权关系。用于商业化发布前，请核对平台规范与 IP 授权边界。
