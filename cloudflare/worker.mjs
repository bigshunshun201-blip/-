const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const ALLOWED_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function error(message, code = "SERVER_ERROR", status = 500) {
  return json({ ok: false, error: message, code }, status);
}

function normalizeInput(input = {}) {
  return {
    mode: String(input.mode || "new").trim(),
    theme: String(input.theme || "").trim(),
    roles: String(input.roles || "").trim(),
    scene: String(input.scene || input.world || "").trim(),
    direction: String(input.direction || "").trim(),
    audience: String(input.audience || "").trim(),
    duration: Math.max(15, Math.min(Number(input.duration || 60), 180)),
    episodeCount: Math.max(1, Math.min(Number(input.episodeCount || 1), 12)),
    episodeNumber: Math.max(1, Math.min(Number(input.episodeNumber || 1), 999)),
    style: String(input.style || "").trim(),
    memeSeed: String(input.memeSeed || "").trim(),
    aiModel: String(input.aiModel || "").trim(),
    competitorInsights: String(input.competitorInsights || "").trim(),
    continueInstruction: String(input.continueInstruction || "").trim(),
    previousScript: input.previousScript || null,
    previousStoryboard: input.previousStoryboard || null,
    script: input.script || null,
    projectName: String(input.projectName || "").trim(),
    projectLogline: String(input.projectLogline || "").trim(),
    projectBible: input.projectBible && typeof input.projectBible === "object" ? input.projectBible : {},
    projectContinuity: Array.isArray(input.projectContinuity) ? input.projectContinuity.slice(-3) : [],
  };
}

function roleNames(input) {
  return String(input.roles || "")
    .split(/[;；\n]/)
    .map((item) => item.trim().split(/[:：]/)[0].trim())
    .filter(Boolean)
    .slice(0, 4);
}

function compact(value, fallback = "未指定") {
  const result = String(value || "").trim();
  return result || fallback;
}

function stringify(value, maxLength = 14000) {
  const text = JSON.stringify(value ?? {}, null, 2);
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n[内容过长，已截断]` : text;
}

function extractJson(raw) {
  const text = String(raw || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidateSource = fenced ? fenced[1].trim() : text;
  const start = candidateSource.indexOf("{");
  const end = candidateSource.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? candidateSource.slice(start, end + 1) : candidateSource;
  try {
    return JSON.parse(candidate);
  } catch (_) {
    return JSON.parse(candidate.replace(/^\uFEFF/, "").replace(/,\s*([}\]])/g, "$1"));
  }
}

function modelFor(input, env) {
  return ALLOWED_MODELS.has(input.aiModel) ? input.aiModel : env.DEEPSEEK_MODEL || "deepseek-v4-flash";
}

function bibleContext(payload) {
  const bible = payload.projectBible || {};
  const canonical = {
    "角色设定": bible.characters || "未填写",
    "精灵能力边界": bible.abilities || "未填写",
    "角色关系": bible.relations || "未填写",
    "反派与动机": bible.antagonist || "未填写",
    "世界规则": bible.worldRules || "未填写",
    "主线矛盾": bible.mainConflict || "未填写",
    "每集钩子规则": bible.hookRules || "未填写",
  };
  const continuity = payload.projectContinuity?.length
    ? stringify(payload.projectContinuity, 6000)
    : "暂无已完成集数。";
  return `
项目：${compact(payload.projectName, "未命名短剧项目")}
系列一句话主线：${compact(payload.projectLogline, "未填写")}

短剧圣经（高优先级事实，发生冲突时必须以此为准，不得无理由改写）：
${stringify(canonical, 8500)}

已完成集数连续性摘要（只能承接和推进，不能推翻已发生的关键事实）：
${continuity}`;
}

function scriptPrompt(input) {
  const payload = normalizeInput(input);
  const names = roleNames(payload);
  const canon = bibleContext(payload);
  const continuation = payload.mode === "continue"
    ? `\n这是续写任务：必须承接上一集结尾钩子，不重写上一集。续写要求：${compact(payload.continueInstruction, "升级冲突并保留核心角色关系")}。\n上一集剧本：${stringify(payload.previousScript, 9000)}`
    : "";
  return `你是擅长抖音竖屏连续剧的中文短剧编剧。为《洛克王国：世界》手游粉丝向二创创作一集可拍摄短剧，只输出严格 JSON，不要 Markdown、解释或代码围栏。

创作边界：
1. 必须围绕本次主题「${compact(payload.theme)}」重新创作，不能套用固定故事。
2. 这是手游开放世界语境：探索、传送点、精灵互动、收集、区域首领、隐藏宝藏、地图任务；不要当成旧页游剧情。
3. 不暗示官方授权，不写成官方宣传。
4. 前 3 秒必须抛出强信息钩子；中段每 8-12 秒至少一次信息变化；结尾留下一集能直接承接的问题。
5. 台词必须口语化、短句、可拍摄。网络梗只能自然点缀，避免堆砌。
6. 必须使用下列角色名，不能擅自替换为默认角色：${names.length ? names.join("、") : "根据主题自创 2-4 名角色"}。
7. 必须遵守短剧圣经的性格、能力边界、角色关系、反派动机、世界规则和钩子规则；不得用失忆、突然升级、复活或新能力偷换已建立事实。
8. 本集为第 ${payload.episodeNumber || 1} 集。它应推进系列主线矛盾，但只解决本集问题，不能终结整个项目主线。

项目连续性资料：${canon}

用户输入：${stringify(payload, 7000)}${continuation}

返回结构：
{
  "script": {
    "title": "标题，18字以内",
    "synopsis": "80-160字故事梗概",
    "characters": [{"name":"角色名","description":"人物设定和本集作用"}],
    "structure": [
      {"beat":"0-3秒 强钩子","content":"剧情"},
      {"beat":"4-15秒 冲突","content":"剧情"},
      {"beat":"16-35秒 升级","content":"剧情"},
      {"beat":"36-50秒 反转/爆点","content":"剧情"},
      {"beat":"结尾钩子","content":"下一集悬念"}
    ],
    "dialogue": [{"role":"角色名","line":"短台词"}],
    "rhythm": ["情绪节奏"],
    "reversals": ["反转点"],
    "hooks": ["爆点或结尾钩子"],
    "tags": ["话题标签"]
  }
}
限制：characters 3-5 个；structure 固定 5 段；dialogue 6-8 句；rhythm、reversals、hooks、tags 各不超过 3 条。`;
}

function storyboardPrompt(input) {
  const payload = normalizeInput(input);
  const script = payload.script || payload.previousScript;
  const names = roleNames(payload);
  const canon = bibleContext(payload);
  return `你是抖音竖屏 9:16 短剧分镜导演。只根据给定剧本生成分镜，不能改写或另起剧情。只输出严格 JSON，不要 Markdown 或解释。

要求：
1. 必须延续剧本的标题、冲突、反转、结尾钩子及核心角色；不新增无关主角。
2. 共 6 个镜头，前 3 秒为强画面钩子，总时长尽量接近 ${payload.duration} 秒。
3. 每个镜头都可直接拍摄/剪辑，字幕短，不超过两行；镜头节奏紧凑，适合手机观看。
4. 场景为《洛克王国：世界》手游开放世界，主要场景：${compact(payload.scene)}。
5. 必须使用这些角色名：${names.length ? names.join("、") : "以剧本为准"}。
6. 必须服从短剧圣经：镜头不能让角色使用超出能力边界的能力，角色关系和反派线索必须延续已完成集数。

项目连续性资料：${canon}

剧本：${stringify(script, 12000)}

返回结构：
{
  "storyboard": [
    {"shot":1,"seconds":3,"visual":"画面内容","action":"角色动作","line":"台词/旁白","scale":"景别","movement":"镜头运动","sound":"音效/配乐建议","subtitle":"字幕文案"}
  ]
}`;
}

function topicsPrompt(input) {
  const payload = normalizeInput(input);
  const count = Math.max(1, Math.min(Number(input.count || 8), 12));
  const existing = Array.isArray(input.existingTopics) ? input.existingTopics.map((topic) => topic.title).filter(Boolean) : [];
  const replacement = input.replaceTopic ? `本次只替换「${input.replaceTopic.title || "指定选题"}」，必须和它明显不同。` : "";
  return `你是《洛克王国：世界》手游短剧的选题策划。请为抖音粉丝向二创生成 ${count} 条彼此差异很大的系列短剧选题。只输出严格 JSON，不要 Markdown 或解释。

世界素材可随机组合：月牙镇、普拉塔草原、海上浪花基地、聆风塔、风眠圣所、风熙山口、旧飞行航道；精灵可从喵喵/魔力猫、火花/火神、水蓝蓝/水灵、皇家狮鹫、雪影娃娃、咕噜、书魔虫等选择，也可加入合理的新精灵。角色、场景、情绪、受众必须分散，不能反复使用迪莫、小洛克、黑衣人。
结合轻量网络热梗、反差喜剧和可拍的短句，但不要使用已过时或可能侵权的整段台词。${replacement}
不要重复这些已有标题：${existing.join("、") || "无"}
用户偏好：${stringify(payload, 5000)}

返回结构：
{
  "topics": [
    {"title":"标题","sellingPoint":"剧情卖点","audience":"目标人群","roles":"角色A：说明；精灵B：说明；冲突C：说明","world":"主要手游场景","emotion":"情绪点","reversal":"反转点","memeLine":"一句自然的网络化台词","duration":60,"series":true,"priority":"S"}
  ],
  "referenceNote":"本批选题的差异化说明"
}`;
}

function normalizeScript(result) {
  const script = result?.script || result;
  if (!script || typeof script !== "object") throw new Error("AI 没有返回可用剧本");
  for (const key of ["characters", "structure", "dialogue", "rhythm", "reversals", "hooks", "tags"]) {
    script[key] = Array.isArray(script[key]) ? script[key] : [];
  }
  if (!script.title || !script.synopsis) throw new Error("AI 返回的剧本不完整");
  return { script };
}

function normalizeStoryboard(result) {
  const source = Array.isArray(result?.storyboard) ? result.storyboard : Array.isArray(result) ? result : [];
  if (!source.length) throw new Error("AI 没有返回可用分镜");
  return {
    storyboard: source.slice(0, 6).map((shot, index) => ({
      shot: shot.shot || index + 1,
      seconds: shot.seconds || "",
      visual: shot.visual || "",
      action: shot.action || "",
      line: shot.line || "",
      scale: shot.scale || "",
      movement: shot.movement || "",
      sound: shot.sound || "",
      subtitle: shot.subtitle || "",
    })),
  };
}

function normalizeTopics(result, count) {
  const source = Array.isArray(result?.topics) ? result.topics : [];
  if (!source.length) throw new Error("AI 没有返回可用选题");
  return {
    topics: source.slice(0, count).map((topic, index) => ({
      title: String(topic.title || `未命名选题 ${index + 1}`),
      sellingPoint: String(topic.sellingPoint || ""),
      audience: String(topic.audience || ""),
      roles: String(topic.roles || ""),
      world: String(topic.world || ""),
      emotion: String(topic.emotion || ""),
      reversal: String(topic.reversal || ""),
      memeLine: String(topic.memeLine || ""),
      duration: Number(topic.duration || 60),
      series: Boolean(topic.series),
      priority: ["S", "A", "B"].includes(topic.priority) ? topic.priority : "A",
    })),
    referenceNote: String(result.referenceNote || "AI 根据本次偏好重新生成。"),
  };
}

async function askDeepSeek(env, input, prompt, maxTokens) {
  if (!env.DEEPSEEK_API_KEY) {
    const missing = new Error("未配置 DeepSeek API Key");
    missing.code = "NO_DEEPSEEK_KEY";
    throw missing;
  }
  const response = await fetch(`${env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: modelFor(input, env),
      messages: [
        { role: "system", content: "你是严格执行用户输入的中文短剧创作助手。必须使用用户给定角色名，只输出 JSON。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.88,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      stream: false,
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    const upstream = new Error(`DeepSeek 请求失败（${response.status}）`);
    upstream.code = response.status === 401 || response.status === 403 ? "DEEPSEEK_AUTH_ERROR" : "DEEPSEEK_API_ERROR";
    throw upstream;
  }
  const data = JSON.parse(raw);
  return extractJson(data.choices?.[0]?.message?.content || raw);
}

function authorized(request, env) {
  const expected = String(env.APP_ACCESS_CODE || "").trim();
  return expected && request.headers.get("x-roco-access-code") === expected;
}

async function readInput(request) {
  const payload = await request.json().catch(() => ({}));
  return payload.input || payload;
}

async function api(request, env, url) {
  if (!authorized(request, env)) return error("请输入访问码", "ACCESS_CODE_REQUIRED", 401);

  if (request.method === "GET" && url.pathname === "/api/status") {
    const configured = Boolean(env.DEEPSEEK_API_KEY);
    return json({
      ok: true,
      aiConnected: configured,
      provider: "deepseek",
      model: env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      availableModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
      message: configured ? "AI connected" : "AI not connected",
    });
  }

  if (request.method !== "POST") return error("Not found", "NOT_FOUND", 404);
  const input = await readInput(request);
  const model = modelFor(input, env);

  if (url.pathname === "/api/script") {
    const result = normalizeScript(await askDeepSeek(env, input, scriptPrompt(input), 1500));
    return json({ ok: true, source: "deepseek", model, result });
  }

  if (url.pathname === "/api/storyboard") {
    if (!input.script && !input.previousScript) return error("请先生成或恢复一个剧本，再生成分镜", "SCRIPT_REQUIRED", 400);
    const result = normalizeStoryboard(await askDeepSeek(env, input, storyboardPrompt(input), 1500));
    return json({ ok: true, source: "deepseek", model, result });
  }

  if (url.pathname === "/api/topics") {
    const count = Math.max(1, Math.min(Number(input.count || 8), 12));
    const result = normalizeTopics(await askDeepSeek(env, input, topicsPrompt(input), 1700), count);
    return json({ ok: true, source: "deepseek", model, result });
  }

  if (url.pathname === "/api/generate") {
    const scriptResult = normalizeScript(await askDeepSeek(env, input, scriptPrompt(input), 1500));
    const storyboardResult = normalizeStoryboard(await askDeepSeek(env, { ...input, script: scriptResult.script }, storyboardPrompt({ ...input, script: scriptResult.script }), 1500));
    return json({ ok: true, source: "deepseek", model, result: { ...scriptResult, ...storyboardResult } });
  }

  return error("Not found", "NOT_FOUND", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await api(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (cause) {
      const code = cause?.code || "SERVER_ERROR";
      const status = code === "NO_DEEPSEEK_KEY" ? 500 : 502;
      return error(cause?.message || "生成服务暂时不可用", code, status);
    }
  },
};
