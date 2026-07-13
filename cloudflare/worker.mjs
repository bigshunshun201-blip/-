const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const ALLOWED_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);
const MAX_INPUT_BYTES = 120_000;
const RATE_WINDOW_MS = 60_000;
const MAX_AI_REQUESTS_PER_WINDOW = 12;
const rateBuckets = new Map();
const fallbackDailyUsage = new Map();
const AI_PATH_COST = new Map([
  ["/api/script", 1],
  ["/api/storyboard", 1],
  ["/api/plans", 1],
  ["/api/topics", 1],
  ["/api/continuity-check", 1],
  ["/api/generate", 2],
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function error(message, code = "SERVER_ERROR", status = 500) {
  return json({ ok: false, error: message, code }, status);
}

function codedError(message, code) {
  const cause = new Error(message);
  cause.code = code;
  return cause;
}

function consumeRateLimit(request, path) {
  const now = Date.now();
  const client = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "private-client";
  const key = `${client}:${path}`;
  const current = rateBuckets.get(key);
  const bucket = !current || now - current.startedAt >= RATE_WINDOW_MS ? { startedAt: now, count: 0 } : current;
  if (bucket.count >= MAX_AI_REQUESTS_PER_WINDOW) {
    return Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - bucket.startedAt)) / 1000));
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 500) {
    for (const [storedKey, value] of rateBuckets) {
      if (now - value.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(storedKey);
    }
  }
  return 0;
}

function usageDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function usageLimit(env) {
  return Math.max(10, Math.min(Number(env.DAILY_AI_UNIT_LIMIT || 120), 10_000));
}

function requestUnits(path, model) {
  const requestCost = AI_PATH_COST.get(path) || 1;
  const modelCost = model === "deepseek-v4-pro" ? 3 : 1;
  return requestCost * modelCost;
}

async function dailyUsageStatus(env) {
  const day = usageDay();
  const limit = usageLimit(env);
  if (env.USAGE_DB) {
    const row = await env.USAGE_DB.prepare(
      "SELECT used_units AS usedUnits, request_count AS requestCount FROM ai_daily_usage WHERE usage_day = ?",
    ).bind(day).first();
    return { day, usedUnits: Number(row?.usedUnits || 0), requestCount: Number(row?.requestCount || 0), limit };
  }
  const current = fallbackDailyUsage.get(day) || { usedUnits: 0, requestCount: 0 };
  return { day, ...current, limit, fallback: true };
}

async function reserveDailyBudget(env, path, model) {
  const day = usageDay();
  const limit = usageLimit(env);
  const units = requestUnits(path, model);
  if (env.USAGE_DB) {
    const row = await env.USAGE_DB.prepare(`
      INSERT INTO ai_daily_usage (usage_day, used_units, request_count, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(usage_day) DO UPDATE SET
        used_units = used_units + excluded.used_units,
        request_count = request_count + 1,
        updated_at = excluded.updated_at
      WHERE used_units + excluded.used_units <= ?
      RETURNING used_units AS usedUnits, request_count AS requestCount
    `).bind(day, units, new Date().toISOString(), limit).first();
    if (!row) throw codedError("今日 AI 调用额度已用完，请明天再试或由管理员调整预算。", "DAILY_BUDGET_EXCEEDED");
    return { day, units, usedUnits: Number(row.usedUnits), requestCount: Number(row.requestCount), limit, remaining: limit - Number(row.usedUnits) };
  }

  const current = fallbackDailyUsage.get(day) || { usedUnits: 0, requestCount: 0 };
  if (current.usedUnits + units > limit) {
    throw codedError("今日 AI 调用额度已用完，请明天再试或由管理员调整预算。", "DAILY_BUDGET_EXCEEDED");
  }
  const next = { usedUnits: current.usedUnits + units, requestCount: current.requestCount + 1 };
  fallbackDailyUsage.clear();
  fallbackDailyUsage.set(day, next);
  return { day, units, ...next, limit, remaining: limit - next.usedUnits, fallback: true };
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
    projectAssets: Array.isArray(input.projectAssets) ? input.projectAssets.slice(-24) : [],
    latestReview: input.latestReview && typeof input.latestReview === "object" ? input.latestReview : null,
    episodePlan: input.episodePlan && typeof input.episodePlan === "object" ? input.episodePlan : {},
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

function creativeInputSummary(payload) {
  const {
    projectBible,
    projectContinuity,
    projectAssets,
    latestReview,
    previousScript,
    previousStoryboard,
    script,
    ...creativeInput
  } = payload;
  return stringify(creativeInput, 4800);
}

function extractJson(raw) {
  const text = String(raw || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidateSource = fenced ? fenced[1].trim() : text;
  const start = candidateSource.indexOf("{");
  const end = candidateSource.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? candidateSource.slice(start, end + 1) : candidateSource;
  const normalized = candidate.replace(/^\uFEFF/, "").replace(/,\s*([}\]])/g, "$1");
  const punctuationRepair = normalized
    .replace(/}(\s*)(?={)/g, "},$1")
    .replace(/](\s+)(?=\"[^\"\r\n]+\"\s*:)/g, "],$1")
    .replace(/}(\s+)(?=\"[^\"\r\n]+\"\s*:)/g, "},$1")
    .replace(/\"(\s+)(?=\"[^\"\r\n]+\"\s*:)/g, "\",$1");
  let lastError;
  for (const attempt of [...new Set([candidate, normalized, punctuationRepair])]) {
    try {
      return JSON.parse(attempt);
    } catch (cause) {
      lastError = cause;
    }
  }
  throw lastError;
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
${continuity}

可复用内容资产（优先复用其中适配本集的角色立绘、场景、口头禅、冲突/标题/封面模板和 BGM/SFX 方案；不适配时不要生硬套用）：
${stringify(payload.projectAssets || [], 5000)}

最近发布复盘（用于调整下一集钩子、标题与封面方向；无数据时忽略）：
${stringify(payload.latestReview || {}, 2200)}`;
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
5. 台词必须口语化、短句、可拍摄。热梗素材：${compact(payload.memeSeed, "未提供；使用原创的平台化口语，不得冒充实时热梗")}。热梗必须转化为动作、道具、世界规则或误会机制，不能只把流行句塞进台词。
6. 必须使用下列角色名，不能擅自替换为默认角色：${names.length ? names.join("、") : "根据主题自创 2-4 名角色"}。
7. 必须遵守短剧圣经的性格、能力边界、角色关系、反派动机、世界规则和钩子规则；不得用失忆、突然升级、复活或新能力偷换已建立事实。
8. 本集为第 ${payload.episodeNumber || 1} 集。它应推进系列主线矛盾，但只解决本集问题，不能终结整个项目主线。
9. 必须严格执行本集策划：开头钩子、核心冲突、反转信息、结尾悬念、时长与目标情绪都要在标题、结构、台词和钩子中可见；不要写成完整闭环故事。
10. 至少制造 2 次意外的概念碰撞，例如“精灵能力限制 + 当代生活困境”或“开放世界机关 + 社交误会”；因果必须成立，不能为了怪而怪。
11. 至少设计 2 个笑点，使用“铺垫 -> 误导 -> 回扣”或可静音看懂的视觉笑点；至少 3 个竖屏强画面，主体动作和前后景变化要明确。
12. 除非本集输入明确要求，不得重复使用失忆、万能黑衣人、契约突然失效、无代价升级等通用套路。反转必须来自本集已出现的规则、道具或人物选择。

项目连续性资料：${canon}

本集策划（高优先级）：${stringify(payload.episodePlan || {}, 2600)}

本集创作输入：${creativeInputSummary(payload)}${continuation}

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
    "innovationPoints": ["本集独有的剧情机制，以及它怎样推动冲突"],
    "comedyBeats": [{"setup":"笑点铺垫","payoff":"误导或回扣","visualAction":"静音也能看懂的动作"}],
    "visualHighlights": [{"moment":"强画面发生时刻","verticalComposition":"9:16前中后景构图","effect":"画面变化或特效"}],
    "hooks": ["爆点或结尾钩子"],
    "tags": ["话题标签"]
  }
}
限制：characters 3-5 个；structure 固定 5 段；dialogue 6-8 句；innovationPoints 2-3 条；comedyBeats 2 条；visualHighlights 3 条；rhythm、reversals、hooks、tags 各不超过 3 条。`;
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
7. 每个镜头都必须填写角色、场景、动作、台词/旁白、镜头景别、时长、画面提示词、音效/配乐提示、关联资产和素材状态；素材状态只能是“已有”“待制作”“待采集”。
8. 必须把剧本中的 visualHighlights 和 comedyBeats 落到具体镜头；至少 3 镜有清晰的动作变化、遮挡转场、道具反应或环境异变，避免只写“角色震惊”“光芒闪烁”。
9. visualPrompt 必须包含前景、中景、背景、主体动作、明暗或色彩反差、9:16 字幕安全区；音效必须与画面动作卡点。
10. 相邻镜头的角色位置、道具状态和动作结果要连续，最后一镜必须完整呈现剧本结尾悬念，不能擅自增加新反转。

项目连续性资料：${canon}

剧本：${stringify(script, 12000)}

返回结构：
{
  "storyboard": [
    {"shot":1,"seconds":3,"characters":"出镜角色","scene":"场景","visual":"画面内容","action":"角色动作","line":"台词/旁白","scale":"景别","movement":"镜头运动","sound":"音效/配乐建议","subtitle":"字幕文案","visualPrompt":"可给绘图/素材检索使用的画面提示词","assetLinks":"资产库名称或待采集素材","assetNote":"制作备注","assetStatus":"待制作"}
  ]
}`;
}

function continuityPrompt(input) {
  const payload = normalizeInput(input);
  return `你是连续短剧总编审。请检查当前集是否与《洛克王国：世界》手游短剧项目的短剧圣经和已完成集数一致。只输出严格 JSON，不要 Markdown。

检查要求：
1. 角色性格是否跑偏。
2. 精灵能力是否突破设定或无代价解决危机。
3. 前后集人物关系、反派动机和世界规则是否矛盾。
4. 上一集结尾悬念是否被正确承接；若没有上一集，标记 pass。
5. 只列可执行的问题和修正建议，不能泛泛而谈。

项目资料：${bibleContext(payload)}
当前剧本：${stringify(payload.script || payload.previousScript || {}, 12000)}
本集策划：${stringify(payload.episodePlan || {}, 2600)}

返回结构：
{
  "score": 0,
  "summary":"一句话结论",
  "checks":[{"area":"角色性格","status":"pass|warn|fail","evidence":"依据","fix":"可执行修正"}],
  "mustPreserve":["下一集必须保留的事实"],
  "nextEpisodeCarryover":"下一集承接提示"
}
限制：checks 必须包含“角色性格”“精灵能力”“人物关系”“悬念承接”四项；score 为 0-100 整数。`;
}

function plansPrompt(input) {
  const payload = normalizeInput(input);
  const names = roleNames(payload);
  return `你是《洛克王国：世界》手游抖音连续短剧的单集策划。根据本次选题、短剧圣经、前集连续性和热梗偏好，实时创作 3 套彼此明显不同的本集策划。只输出严格 JSON，不要 Markdown、解释或代码围栏。

要求：
1. 三套方案不能只是替换措辞；开头事件、核心冲突、反转机制和结尾悬念都必须不同。
2. 只做单集策划，不写完整剧本和台词列表。
3. 前 3 秒必须出现可见异常、危机、关系破裂或反常结果，不能用背景介绍开场。
4. 本集只解决阶段问题，必须推进主线并留下下一集可直接承接的行动问题。
5. 必须遵守角色性格、精灵能力边界、人物关系、反派动机和世界规则；不能靠突然升级、无代价新能力或无依据失忆反转。
6. 以《洛克王国：世界》手游开放世界为语境，不要套用旧页游剧情。
7. 必须使用这些角色名：${names.length ? names.join("、") : "根据输入选择 2-4 个明确角色"}。
8. 热梗素材：${compact(payload.memeSeed, "未提供；使用原创平台化口语，不得冒充实时热梗")}。每套必须把梗转化为不同的剧情动作、道具或规则机制，不能只写一句流行台词。
9. 目标时长 ${payload.duration} 秒，本集为第 ${payload.episodeNumber} 集。
10. 三套分别使用不同的创新引擎、喜剧机制和视觉母题；至少一套用视觉喜剧，一套用规则误导，一套用关系反差，但不能复用失忆、万能黑衣人、契约突然失效等通用套路。
11. 每套必须有一个一眼能记住、静音也能看懂的 9:16 强画面，并让反转由前面出现过的规则、道具或人物选择触发。

项目与连续性资料：${bibleContext(payload)}

本集输入：${creativeInputSummary(payload)}
${payload.previousScript ? `上一集剧本（只用于承接，不得重写）：${stringify(payload.previousScript, 7000)}` : ""}

返回结构：
{
  "plans": [
    {
      "angle": "6字以内的差异化角度",
      "title": "这套策划的一句话方向",
      "why": "适合当前选题的理由",
      "innovation": "本集独有、能推动因果的创新机制",
      "memeMechanic": "热梗如何变成动作、道具、规则或回扣笑点",
      "visualSetpiece": "最强竖屏画面及前中后景变化",
      "plan": {
        "openingHook": "前3秒具体画面和事件",
        "conflict": "本集必须解决的对立问题与代价",
        "reversal": "改变观众判断的新事实",
        "endingSuspense": "下一集必须行动或回答的问题",
        "targetEmotion": "情绪A -> 情绪B -> 情绪C"
      }
    }
  ]
}
限制：plans 必须正好 3 条；每项都必须具体到角色和场景，不得出现“制造冲突”“留下悬念”等空泛表述。`;
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
  for (const key of ["characters", "structure", "dialogue", "rhythm", "reversals", "innovationPoints", "comedyBeats", "visualHighlights", "hooks", "tags"]) {
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
      characters: shot.characters || "",
      scene: shot.scene || "",
      action: shot.action || "",
      line: shot.line || "",
      scale: shot.scale || "",
      movement: shot.movement || "",
      sound: shot.sound || "",
      subtitle: shot.subtitle || "",
      visualPrompt: shot.visualPrompt || "",
      assetLinks: shot.assetLinks || "",
      assetNote: shot.assetNote || "",
      assetStatus: ["已有", "待制作", "待采集"].includes(shot.assetStatus) ? shot.assetStatus : "待制作",
    })),
  };
}

function normalizeContinuity(result) {
  const report = result && typeof result === "object" ? result : {};
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const requiredAreas = ["角色性格", "精灵能力", "人物关系", "悬念承接"];
  return {
    score: Math.max(0, Math.min(100, Number(report.score) || 0)),
    summary: String(report.summary || "一致性检查完成"),
    checks: requiredAreas.map((area) => {
      const source = checks.find((check) => String(check.area || "").includes(area)) || {};
      return {
        area,
        status: ["pass", "warn", "fail"].includes(source.status) ? source.status : "warn",
        evidence: String(source.evidence || "模型未提供明确依据"),
        fix: String(source.fix || "请人工确认后再继续生成。"),
      };
    }),
    mustPreserve: Array.isArray(report.mustPreserve) ? report.mustPreserve.map(String).slice(0, 5) : [],
    nextEpisodeCarryover: String(report.nextEpisodeCarryover || ""),
  };
}

function normalizePlans(result) {
  const source = Array.isArray(result?.plans) ? result.plans : [];
  const requiredKeys = ["openingHook", "conflict", "reversal", "endingSuspense", "targetEmotion"];
  const plans = source.slice(0, 3).map((item, index) => {
    const plan = item?.plan && typeof item.plan === "object" ? item.plan : {};
    return {
      id: `ai-plan-${crypto.randomUUID()}`,
      angle: String(item?.angle || `方案 ${index + 1}`),
      title: String(item?.title || "未命名策划"),
      why: String(item?.why || "根据当前创作资料生成"),
      innovation: String(item?.innovation || ""),
      memeMechanic: String(item?.memeMechanic || ""),
      visualSetpiece: String(item?.visualSetpiece || ""),
      plan: Object.fromEntries(requiredKeys.map((key) => [key, String(plan[key] || "").trim()])),
    };
  }).filter((item) => requiredKeys.every((key) => item.plan[key]));
  if (plans.length !== 3) throw new Error("AI 没有返回 3 套完整策划，请重新生成");
  return { plans };
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

async function repairJsonWithDeepSeek(env, input, malformed, maxTokens) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  let response;
  try {
    response = await fetch(`${env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelFor(input, env),
        messages: [
          { role: "system", content: "你是 JSON 格式修复器。只修复标点、引号、括号和转义错误，不改写字段、顺序和内容；只输出严格 JSON。" },
          { role: "user", content: String(malformed || "").slice(0, 24_000) },
        ],
        temperature: 0,
        max_tokens: Math.max(1200, Math.min(Number(maxTokens || 1800), 2600)),
        response_format: { type: "json_object" },
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch (cause) {
    if (cause?.name === "AbortError") throw codedError("AI 返回格式异常，自动修复超时，请重新生成。", "AI_JSON_REPAIR_TIMEOUT");
    throw cause;
  } finally {
    clearTimeout(timeoutId);
  }
  const raw = await response.text();
  if (!response.ok) throw codedError(`AI 返回格式异常，自动修复失败（${response.status}）`, "AI_JSON_REPAIR_FAILED");
  const data = JSON.parse(raw);
  return extractJson(data.choices?.[0]?.message?.content || raw);
}

async function askDeepSeek(env, input, prompt, maxTokens) {
  if (!env.DEEPSEEK_API_KEY) {
    const missing = new Error("未配置 DeepSeek API Key");
    missing.code = "NO_DEEPSEEK_KEY";
    throw missing;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 75_000);
  let response;
  try {
    response = await fetch(`${env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"}/chat/completions`, {
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
      signal: controller.signal,
    });
  } catch (cause) {
    if (cause?.name === "AbortError") throw codedError("DeepSeek 响应超时，请缩短输入后重试。", "UPSTREAM_TIMEOUT");
    throw cause;
  } finally {
    clearTimeout(timeoutId);
  }
  const raw = await response.text();
  if (!response.ok) {
    const upstream = new Error(`DeepSeek 请求失败（${response.status}）`);
    upstream.code = response.status === 401 || response.status === 403 ? "DEEPSEEK_AUTH_ERROR" : "DEEPSEEK_API_ERROR";
    throw upstream;
  }
  const data = JSON.parse(raw);
  const content = data.choices?.[0]?.message?.content || raw;
  try {
    return extractJson(content);
  } catch (cause) {
    console.warn(JSON.stringify({ event: "ai_json_repair", model: modelFor(input, env), error: cause?.message || "parse failed" }));
    try {
      return await repairJsonWithDeepSeek(env, input, content, maxTokens);
    } catch (repairError) {
      if (repairError?.code) throw repairError;
      throw codedError("AI 返回格式异常，自动修复仍失败，请重新生成。", "AI_JSON_INVALID");
    }
  }
}

function authorized(request, env) {
  const expected = String(env.APP_ACCESS_CODE || "").trim();
  return expected && request.headers.get("x-roco-access-code") === expected;
}

async function readInput(request) {
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > MAX_INPUT_BYTES) throw codedError("输入内容过大，请缩短项目资产或历史摘要后重试。", "REQUEST_TOO_LARGE");
  const raw = await request.text();
  if (raw.length > MAX_INPUT_BYTES) throw codedError("输入内容过大，请缩短项目资产或历史摘要后重试。", "REQUEST_TOO_LARGE");
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch (_) {
    throw codedError("请求内容不是有效 JSON。", "INVALID_REQUEST");
  }
  return payload.input || payload;
}

async function api(request, env, url) {
  if (!authorized(request, env)) return error("请输入访问码", "ACCESS_CODE_REQUIRED", 401);

  if (request.method === "GET" && url.pathname === "/api/status") {
    const configured = Boolean(env.DEEPSEEK_API_KEY);
    let usage = null;
    try {
      usage = await dailyUsageStatus(env);
    } catch (_) {
      usage = { limit: usageLimit(env), unavailable: true };
    }
    return json({
      ok: true,
      aiConnected: configured,
      provider: "deepseek",
      model: env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      availableModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
      message: configured ? "AI connected" : "AI not connected",
      usage,
    });
  }

  if (request.method !== "POST") return error("Not found", "NOT_FOUND", 404);
  if (!AI_PATH_COST.has(url.pathname)) return error("Not found", "NOT_FOUND", 404);
  const retryAfter = consumeRateLimit(request, url.pathname);
  if (retryAfter) {
    return new Response(JSON.stringify({ ok: false, error: "请求过于频繁，请稍后再试。", code: "RATE_LIMITED", retryAfter }), {
      status: 429,
      headers: { ...JSON_HEADERS, "retry-after": String(retryAfter) },
    });
  }
  const input = await readInput(request);
  const model = modelFor(input, env);
  if (!env.DEEPSEEK_API_KEY) return error("未配置 DeepSeek API Key", "NO_DEEPSEEK_KEY", 500);
  let usage;
  try {
    usage = await reserveDailyBudget(env, url.pathname, model);
  } catch (cause) {
    if (cause?.code === "DAILY_BUDGET_EXCEEDED") throw cause;
    throw codedError("AI 用量保护暂时不可用，为避免产生失控费用，本次请求未执行。", "USAGE_GUARD_UNAVAILABLE");
  }
  const requestId = crypto.randomUUID();
  console.log(JSON.stringify({ event: "ai_request", requestId, path: url.pathname, model, units: usage.units, usedUnits: usage.usedUnits, at: new Date().toISOString() }));

  if (url.pathname === "/api/script") {
    const result = normalizeScript(await askDeepSeek(env, input, scriptPrompt(input), 2200));
    return json({ ok: true, source: "deepseek", model, usage, result });
  }

  if (url.pathname === "/api/storyboard") {
    if (!input.script && !input.previousScript) return error("请先生成或恢复一个剧本，再生成分镜", "SCRIPT_REQUIRED", 400);
    const result = normalizeStoryboard(await askDeepSeek(env, input, storyboardPrompt(input), 2600));
    return json({ ok: true, source: "deepseek", model, usage, result });
  }

  if (url.pathname === "/api/plans") {
    const result = normalizePlans(await askDeepSeek(env, input, plansPrompt(input), 2200));
    return json({ ok: true, source: "deepseek", model, usage, result });
  }

  if (url.pathname === "/api/topics") {
    const count = Math.max(1, Math.min(Number(input.count || 8), 12));
    const result = normalizeTopics(await askDeepSeek(env, input, topicsPrompt(input), 1700), count);
    return json({ ok: true, source: "deepseek", model, usage, result });
  }

  if (url.pathname === "/api/continuity-check") {
    if (!input.script && !input.previousScript) return error("请先提供需要检查的剧本", "SCRIPT_REQUIRED", 400);
    const result = normalizeContinuity(await askDeepSeek(env, input, continuityPrompt(input), 1500));
    return json({ ok: true, source: "deepseek", model, usage, result });
  }

  if (url.pathname === "/api/generate") {
    const scriptResult = normalizeScript(await askDeepSeek(env, input, scriptPrompt(input), 2200));
    const storyboardResult = normalizeStoryboard(await askDeepSeek(env, { ...input, script: scriptResult.script }, storyboardPrompt({ ...input, script: scriptResult.script }), 2600));
    return json({ ok: true, source: "deepseek", model, usage, result: { ...scriptResult, ...storyboardResult } });
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
      const status = code === "NO_DEEPSEEK_KEY"
        ? 500
        : code === "REQUEST_TOO_LARGE"
          ? 413
          : code === "INVALID_REQUEST"
            ? 400
            : code === "DAILY_BUDGET_EXCEEDED" || code === "USAGE_GUARD_UNAVAILABLE"
              ? 429
              : code === "UPSTREAM_TIMEOUT"
                ? 504
                : 502;
      return error(cause?.message || "生成服务暂时不可用", code, status);
    }
  },
};

export const __test = {
  normalizeInput,
  normalizeStoryboard,
  normalizeContinuity,
  normalizePlans,
  extractJson,
  creativeInputSummary,
  requestUnits,
  usageDay,
  reserveDailyBudget,
  dailyUsageStatus,
};
