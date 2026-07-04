const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 8765);
const appAccessCode = process.env.APP_ACCESS_CODE || "";
const provider = String(
  process.env.AI_PROVIDER ||
    (process.env.DEEPSEEK_API_KEY ? "deepseek" : process.env.OPENAI_API_KEY ? "openai" : "none"),
).toLowerCase();

const config = {
  deepseek: {
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    model: process.env.DEEPSEEK_MODEL || process.env.AI_MODEL || "deepseek-v4-flash",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  },
  ollama: {
    baseUrl: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
    model: process.env.OLLAMA_MODEL || process.env.AI_MODEL || "qwen2.5:7b",
  },
  compatible: {
    baseUrl: process.env.COMPATIBLE_BASE_URL || "http://127.0.0.1:1234/v1",
    apiKey: process.env.COMPATIBLE_API_KEY || "not-needed",
    model: process.env.COMPATIBLE_MODEL || process.env.AI_MODEL || "local-model",
  },
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function activeModel() {
  if (provider === "deepseek") return config.deepseek.model;
  if (provider === "openai") return config.openai.model;
  if (provider === "ollama") return config.ollama.model;
  if (provider === "compatible") return config.compatible.model;
  return "none";
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  if (Buffer.isBuffer(body) || typeof body === "string") {
    res.end(body);
  } else {
    res.end(JSON.stringify(body));
  }
}

function requestAccessCode(headers) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get("x-roco-access-code") || "";
  return headers["x-roco-access-code"] || "";
}

function hasApiAccess(headers) {
  return !appAccessCode || requestAccessCode(headers) === appAccessCode;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        req.destroy();
        reject(new Error("请求体过大"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function timeoutSignal(ms) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

function extractJsonStrict(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("模型没有返回可解析 JSON");
  }
}

function extractJson(text) {
  const source = String(text || "").trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidateSource = fenced ? fenced[1].trim() : source;
  const start = candidateSource.indexOf("{");
  const end = candidateSource.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? candidateSource.slice(start, end + 1) : candidateSource;
  const relaxedCandidate = candidate.replace(/^\uFEFF/, "").replace(/,\s*([}\]])/g, "$1");

  try {
    return JSON.parse(candidate);
  } catch (firstError) {
    try {
      return JSON.parse(relaxedCandidate);
    } catch (secondError) {
      const error = new Error(`模型返回的 JSON 无法解析：${secondError.message || firstError.message}`);
      error.code = "MODEL_JSON_PARSE_ERROR";
      error.rawText = candidate.slice(0, 12000);
      throw error;
    }
  }
}

function normalizePayload(input) {
  return {
    mode: String(input.mode || "new").trim(),
    theme: String(input.theme || "").trim(),
    roles: String(input.roles || "").trim(),
    direction: String(input.direction || "").trim(),
    audience: String(input.audience || "").trim(),
    duration: Number(input.duration || 60),
    episodeCount: Number(input.episodeCount || 1),
    style: String(input.style || "").trim(),
    aiModel: String(input.aiModel || "").trim(),
    competitorInsights: input.competitorInsights || "",
    continueInstruction: String(input.continueInstruction || "").trim(),
    previousScript: input.previousScript || null,
    previousStoryboard: input.previousStoryboard || null,
  };
}

function roleNames(input) {
  return String(input.roles || "")
    .split(/[；;\n]/)
    .map((item) => item.trim().split(/[：:]/)[0].trim())
    .filter(Boolean)
    .slice(0, 3);
}

function modelForRequest(input) {
  const payload = normalizePayload(input || {});
  if (provider === "deepseek") {
    const allowed = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);
    return allowed.has(payload.aiModel) ? payload.aiModel : config.deepseek.model;
  }
  return activeModel();
}

function buildPrompt(input) {
  const payload = normalizePayload(input);
  const isContinue = payload.mode === "continue";
  return `
你是一个短剧总编剧和抖音内容导演。请基于用户输入，为「洛克王国」粉丝向/二创短剧生成全新的剧本和分镜。

硬性要求：
1. 必须根据本次输入重新创作，不能套用固定模板。
2. 必须围绕用户输入的 theme 写，标题、梗概、结构、分镜首镜都要明显体现该 theme。
3. 如果用户输入了 roles，必须使用这些角色名作为主角/搭档/反派，不得擅自替换成“小洛克、火花、恩佐”等未输入角色；除非它们明确出现在用户输入中。
4. 可以使用洛克王国相关受众熟悉的语境：魔法学院、精灵羁绊、童年回忆、冒险、宠物契约、学院危机。
5. 不要声称官方授权，不要写成官方宣传。
6. 适合抖音竖屏短剧：前3秒强钩子，中段持续信息变化，结尾必须有下一集钩子。
7. 台词要口语化、短句、可拍摄；分镜要能给剪辑/拍摄直接用。
8. 输出必须是严格 JSON，不要 Markdown，不要解释。

角色使用规则：
- roles 字段一般格式是“角色A：说明；角色B：说明；角色C：说明”。
- 第一个角色默认是主角，第二个角色默认是精灵/搭档，第三个角色默认是反派或冲突源。
- 剧本、台词、分镜必须优先使用这些角色名。
- 不要把输入角色改名，不要用未输入的精灵替换输入精灵。

用户输入：
${JSON.stringify(payload, null, 2)}

本次必须使用的角色名：
${roleNames(payload).join("、") || "用户未指定"}

最终自检规则：
- characters 里必须出现上述角色名。
- synopsis 必须出现上述主角和搭档名。
- storyboard 的前 3 个镜头里必须出现主题或上述角色名。
- 如果做不到，不要改名，不要用“小明/火花/小洛克/恩佐/闪电”等替代名。

${isContinue ? `
续写任务：
- 这次不是重写第一集，而是基于 previousScript / previousStoryboard 继续生成下一集。
- 必须承接上一集结尾钩子，保留核心角色关系和未解问题。
- 不要重复上一集的剧情，不要只是换标题。
- 如果 continueInstruction 有要求，优先执行。
- 标题应体现“第2集/下一集/续集感”，但不要机械套格式。
- 新分镜必须是下一集的新镜头。
` : ""}

返回 JSON 结构：
{
  "script": {
    "title": "短剧标题",
    "synopsis": "故事梗概，120-220字，必须贴合输入主题",
    "characters": [{"name":"角色名","description":"人物设定和本集作用"}],
    "structure": [
      {"beat":"0-3秒 强钩子","content":"剧情内容"},
      {"beat":"4-15秒 冲突","content":"剧情内容"},
      {"beat":"16-35秒 升级","content":"剧情内容"},
      {"beat":"36-50秒 反转/爆点","content":"剧情内容"},
      {"beat":"结尾钩子","content":"剧情内容"}
    ],
    "dialogue": [{"role":"角色名","line":"台词"}],
    "rhythm": ["情绪节奏说明"],
    "reversals": ["反转点"],
    "hooks": ["爆点/结尾钩子/评论互动"],
    "tags": ["标签"]
  },
  "storyboard": [
    {
      "shot": 1,
      "seconds": 3,
      "visual": "画面内容",
      "action": "角色动作",
      "line": "台词/旁白",
      "scale": "景别",
      "movement": "镜头运动",
      "sound": "音效/配乐建议",
      "subtitle": "字幕文案"
    }
  ],
  "creativePack": {
    "titleVariants": [{"type":"测试方向","text":"标题","reason":"为什么值得测试"}],
    "coverVariants": [{"text":"封面大字","visual":"封面画面","risk":"风险或注意点"}],
    "openingHooks": ["前3秒钩子"],
    "ctaLines": ["评论区引导"],
    "productionChecklist": ["发布前检查项"]
  }
}

分镜数量：8-12个；分镜 seconds 总和尽量接近 ${payload.duration} 秒。
`;
}

function resultText(result) {
  return JSON.stringify(result || {}, null, 0);
}

function validateGeneratedResult(result, input) {
  const required = roleNames(input);
  if (!required.length) return [];
  const text = resultText(result);
  const missing = required.filter((name) => !text.includes(name));
  const problems = [];
  if (missing.length) problems.push(`缺少输入角色：${missing.join("、")}`);
  const forbidden = ["小明", "火花", "闪电", "小洛克", "恩佐"].filter(
    (name) => !required.includes(name) && text.includes(name),
  );
  if (forbidden.length) problems.push(`擅自引入未输入核心角色：${forbidden.join("、")}`);
  return problems;
}

function buildRepairPrompt(input, badResult, problems) {
  return `
上一次输出不合格，原因：${problems.join("；")}。

请重新生成，必须严格使用输入角色名，不得改名，不得引入未输入的核心主角/精灵/反派。

用户输入：
${JSON.stringify(normalizePayload(input), null, 2)}

必须使用的角色名：
${roleNames(input).join("、")}

错误输出摘要：
${JSON.stringify(badResult?.script || badResult || {}).slice(0, 1200)}

请只返回严格 JSON，结构仍为：
{
  "script": {
    "title": "短剧标题",
    "synopsis": "故事梗概",
    "characters": [{"name":"角色名","description":"人物设定"}],
    "structure": [{"beat":"0-3秒 强钩子","content":"剧情内容"}],
    "dialogue": [{"role":"角色名","line":"台词"}],
    "rhythm": [],
    "reversals": [],
    "hooks": [],
    "tags": []
  },
  "storyboard": [{"shot":1,"seconds":3,"visual":"画面内容","action":"动作","line":"台词/旁白","scale":"景别","movement":"运镜","sound":"音效","subtitle":"字幕"}],
  "creativePack": {"titleVariants":[],"coverVariants":[],"openingHooks":[],"ctaLines":[],"productionChecklist":[]}
}
`;
}

function buildTopicsPrompt(input) {
  const payload = normalizePayload(input);
  const count = Math.max(1, Math.min(Number(input.count || 8), 12));
  const existingTopics = Array.isArray(input.existingTopics) ? input.existingTopics : [];
  const replaceTopic = input.replaceTopic || null;
  return `
你是短视频短剧选题策划。请为「洛克王国」粉丝向/二创短剧生成一批全新的选题候选。

要求：
1. 必须贴合用户输入的主题、角色、剧情方向、目标受众和视频时长。
2. 不要重复 existingTopics 中已经有的标题、卖点和反转。
3. 如果 replaceTopic 存在，本次重点生成可替换它的新选题，方向要明显不同。
4. 选题要适合抖音竖屏连续短剧，开头有强钩子，结尾有系列钩子。
5. 可以借鉴 topicReference / competitorInsights，但不要写成竞品分析。
6. 输出必须是严格 JSON，不要 Markdown，不要解释。

用户输入：
${JSON.stringify(payload, null, 2)}

选题参考：
${JSON.stringify(input.topicReference || input.competitorInsights || "", null, 2)}

已有选题，必须避开：
${JSON.stringify(existingTopics.slice(0, 20), null, 2)}

要替换的选题：
${JSON.stringify(replaceTopic, null, 2)}

返回 JSON 结构：
{
  "topics": [
    {
      "title": "短剧选题标题",
      "sellingPoint": "剧情卖点，说明为什么值得拍",
      "audience": "目标人群",
      "emotion": "核心情绪点",
      "reversal": "反转点",
      "duration": 60,
      "series": true,
      "priority": "S"
    }
  ],
  "referenceNote": "本批选题的生成依据，40字以内"
}

数量：${count} 条。duration 只能在 45、60、75、90 中选择。priority 只能是 S、A、B。
`;
}

function normalizeTopicsResult(result, count) {
  const topics = Array.isArray(result?.topics) ? result.topics : [];
  const normalized = topics
    .map((topic, index) => ({
      title: String(topic.title || "").trim(),
      sellingPoint: String(topic.sellingPoint || topic.selling_point || "").trim(),
      audience: String(topic.audience || topic.targetAudience || "").trim(),
      emotion: String(topic.emotion || topic.emotionPoint || "").trim(),
      reversal: String(topic.reversal || topic.reversalPoint || "").trim(),
      duration: [45, 60, 75, 90].includes(Number(topic.duration)) ? Number(topic.duration) : 60,
      series: topic.series !== false,
      priority: ["S", "A", "B"].includes(String(topic.priority || "").toUpperCase())
        ? String(topic.priority).toUpperCase()
        : index < 3
          ? "S"
          : "A",
    }))
    .filter((topic) => topic.title && topic.sellingPoint && topic.reversal)
    .slice(0, count);
  if (!normalized.length) throw new Error("模型没有返回可用选题");
  return {
    topics: normalized,
    referenceNote: String(result?.referenceNote || result?.note || "").trim(),
  };
}

async function callOpenAI(input, promptOverride) {
  if (!config.openai.apiKey) {
    const error = new Error("未设置 OPENAI_API_KEY");
    error.code = "NO_API_KEY";
    throw error;
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.openai.model,
      input: [{ role: "user", content: [{ type: "input_text", text: promptOverride || buildPrompt(input) }] }],
      temperature: 0.85,
      max_output_tokens: 5000,
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${raw.slice(0, 800)}`);
  const data = JSON.parse(raw);
  const text =
    data.output_text ||
    (data.output || [])
      .flatMap((item) => item.content || [])
      .map((part) => part.text || "")
      .join("");
  return extractJson(text);
}

async function repairDeepSeekJson(input, rawText) {
  const response = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.deepseek.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelForRequest(input),
      messages: [
        {
          role: "system",
          content:
            "You repair malformed JSON. Return only one strict JSON object. Do not use Markdown. Do not explain.",
        },
        {
          role: "user",
          content: `Repair this malformed JSON so JSON.parse can parse it. Preserve the same schema and meaning.\n\n${String(rawText || "").slice(0, 12000)}`,
        },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
      stream: false,
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`DeepSeek JSON repair ${response.status}: ${raw.slice(0, 800)}`);
  const data = JSON.parse(raw);
  return extractJson(data.choices?.[0]?.message?.content || raw);
}

async function callDeepSeek(input, promptOverride) {
  if (!config.deepseek.apiKey) {
    const error = new Error("未设置 DEEPSEEK_API_KEY");
    error.code = "NO_DEEPSEEK_KEY";
    throw error;
  }
  const response = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.deepseek.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelForRequest(input),
      messages: [
        {
          role: "system",
          content:
            "你是严格执行用户输入的中文短剧编剧。必须使用用户给定角色名，不得改名。只输出 JSON。",
        },
        { role: "user", content: promptOverride || buildPrompt(input) },
      ],
      temperature: 0.85,
      response_format: { type: "json_object" },
      stream: false,
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`DeepSeek API ${response.status}: ${raw.slice(0, 800)}`);
  const data = JSON.parse(raw);
  const content = data.choices?.[0]?.message?.content || raw;
  try {
    return extractJson(content);
  } catch (error) {
    if (error.code !== "MODEL_JSON_PARSE_ERROR") throw error;
    return repairDeepSeekJson(input, error.rawText || content);
  }
}

async function callOllama(input, promptOverride) {
  const response = await fetch(`${config.ollama.baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollama.model,
      prompt: promptOverride || buildPrompt(input),
      stream: false,
      format: "json",
      options: { temperature: 0.85 },
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${raw.slice(0, 800)}`);
  const data = JSON.parse(raw);
  return extractJson(data.response || raw);
}

async function callCompatible(input, promptOverride) {
  const response = await fetch(`${config.compatible.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.compatible.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.compatible.model,
      messages: [{ role: "user", content: promptOverride || buildPrompt(input) }],
      temperature: 0.85,
      response_format: { type: "json_object" },
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Compatible API ${response.status}: ${raw.slice(0, 800)}`);
  const data = JSON.parse(raw);
  return extractJson(data.choices?.[0]?.message?.content || raw);
}

async function generateWithProvider(input) {
  if (provider === "deepseek") {
    const first = await callDeepSeek(input);
    const problems = validateGeneratedResult(first, input);
    if (!problems.length) return first;
    const second = await callDeepSeek(input, buildRepairPrompt(input, first, problems));
    const secondProblems = validateGeneratedResult(second, input);
    if (!secondProblems.length) return second;
    throw new Error(`模型输出未遵守输入约束：${secondProblems.join("；")}`);
  }
  if (provider === "openai") return callOpenAI(input);
  if (provider === "ollama") return callOllama(input);
  if (provider === "compatible") return callCompatible(input);
  const error = new Error("未配置 AI_PROVIDER。可用值：deepseek、ollama、compatible、openai");
  error.code = "NO_PROVIDER";
  throw error;
}

async function generateTopicsWithProvider(input) {
  const count = Math.max(1, Math.min(Number(input.count || 8), 12));
  const prompt = buildTopicsPrompt(input);
  const callTopicProvider = (promptText) => {
    if (provider === "deepseek") return callDeepSeek(input, promptText);
    if (provider === "openai") return callOpenAI(input, promptText);
    if (provider === "ollama") return callOllama(input, promptText);
    if (provider === "compatible") return callCompatible(input, promptText);
    const error = new Error("未配置 AI_PROVIDER，无法使用 AI 重新生成选题");
    error.code = "NO_PROVIDER";
    throw error;
  };
  let result;
  try {
    result = await callTopicProvider(prompt);
  } catch (error) {
    if (!/JSON|array element|object|Unexpected|Expected/i.test(error.message || "")) throw error;
    result = await callTopicProvider(`
只返回一个可以被 JSON.parse 解析的 JSON 对象，不要 Markdown，不要尾随逗号，不要注释。
结构必须是：
{"topics":[{"title":"...","sellingPoint":"...","audience":"...","emotion":"...","reversal":"...","duration":60,"series":true,"priority":"S"}],"referenceNote":"..."}
数量：${count} 条。不要重复这些标题：${(input.existingTopics || []).map((topic) => topic.title).join("、")}
用户输入：${JSON.stringify(normalizePayload(input), null, 2)}
`);
  }
  return normalizeTopicsResult(result, count);
}

async function providerHealth() {
  if (provider === "deepseek") return Boolean(config.deepseek.apiKey);
  if (provider === "openai") return Boolean(config.openai.apiKey);
  if (provider === "ollama") {
    try {
      const response = await fetch(`${config.ollama.baseUrl}/api/tags`, { signal: timeoutSignal(900) });
      return response.ok;
    } catch (_) {
      return false;
    }
  }
  if (provider === "compatible") {
    try {
      const response = await fetch(`${config.compatible.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${config.compatible.apiKey}` },
        signal: timeoutSignal(900),
      });
      return response.ok;
    } catch (_) {
      return false;
    }
  }
  return false;
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = decodeURIComponent(url.pathname);
  if (filePath === "/") filePath = "/index.html";
  const resolved = path.resolve(root, `.${filePath}`);
  if (!resolved.startsWith(root)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    send(res, 200, data, mime[path.extname(resolved)] || "application/octet-stream");
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/status") {
      if (!hasApiAccess(req.headers)) {
        send(res, 401, { ok: false, error: "请输入访问码", code: "ACCESS_CODE_REQUIRED" });
        return;
      }
      const aiConnected = await providerHealth();
      send(res, 200, {
        ok: true,
        aiConnected,
        provider,
        model: activeModel(),
        availableModels: provider === "deepseek" ? ["deepseek-v4-flash", "deepseek-v4-pro"] : [activeModel()],
        message: aiConnected ? "AI connected" : "AI not connected",
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/generate") {
      if (!hasApiAccess(req.headers)) {
        send(res, 401, { ok: false, error: "请输入访问码", code: "ACCESS_CODE_REQUIRED" });
        return;
      }
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const result = await generateWithProvider(payload.input || payload);
      send(res, 200, { ok: true, source: provider, model: modelForRequest(payload.input || payload), result });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/topics") {
      if (!hasApiAccess(req.headers)) {
        send(res, 401, { ok: false, error: "请输入访问码", code: "ACCESS_CODE_REQUIRED" });
        return;
      }
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const input = payload.input || payload;
      const result = await generateTopicsWithProvider(input);
      send(res, 200, { ok: true, source: provider, model: modelForRequest(input), result });
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    const status = error.code === "NO_PROVIDER" || error.code === "NO_API_KEY" || error.code === "NO_DEEPSEEK_KEY" ? 400 : 500;
    send(res, status, { ok: false, error: error.message, code: error.code || "SERVER_ERROR" });
  }
});

if (require.main === module) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`Roco studio running at http://127.0.0.1:${port}/`);
    console.log(`AI_PROVIDER=${provider}; model=${activeModel()}`);
    if (provider === "none") {
      console.log("Set AI_PROVIDER=deepseek, ollama, compatible, or openai to enable real generation.");
    }
  });
}

module.exports = {
  activeModel,
  generateTopicsWithProvider,
  generateWithProvider,
  modelForRequest,
  provider,
  providerHealth,
  hasApiAccess,
};
