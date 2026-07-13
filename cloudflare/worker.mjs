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
  ["/api/bible", 1],
  ["/api/character-card", 1],
  ["/api/meme-lab", 1],
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

function providerCallUnits(model) {
  return model === "deepseek-v4-pro" ? 3 : 1;
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

async function reserveUsageUnits(env, units) {
  const day = usageDay();
  const limit = usageLimit(env);
  const safeUnits = Math.max(1, Math.min(Number(units || 1), limit));
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
    `).bind(day, safeUnits, new Date().toISOString(), limit).first();
    if (!row) throw codedError("今日 AI 调用额度已用完，请明天再试或由管理员调整预算。", "DAILY_BUDGET_EXCEEDED");
    return { day, units: safeUnits, usedUnits: Number(row.usedUnits), requestCount: Number(row.requestCount), limit, remaining: limit - Number(row.usedUnits) };
  }

  const current = fallbackDailyUsage.get(day) || { usedUnits: 0, requestCount: 0 };
  if (current.usedUnits + safeUnits > limit) {
    throw codedError("今日 AI 调用额度已用完，请明天再试或由管理员调整预算。", "DAILY_BUDGET_EXCEEDED");
  }
  const next = { usedUnits: current.usedUnits + safeUnits, requestCount: current.requestCount + 1 };
  fallbackDailyUsage.clear();
  fallbackDailyUsage.set(day, next);
  return { day, units: safeUnits, ...next, limit, remaining: limit - next.usedUnits, fallback: true };
}

async function reserveDailyBudget(env, path, model) {
  return reserveUsageUnits(env, requestUnits(path, model));
}

async function releaseDailyBudget(env, reservation) {
  if (!reservation?.day || !reservation?.units) return null;
  const limit = usageLimit(env);
  if (env.USAGE_DB) {
    const row = await env.USAGE_DB.prepare(`
      UPDATE ai_daily_usage
      SET used_units = MAX(0, used_units - ?),
          request_count = MAX(0, request_count - 1),
          updated_at = ?
      WHERE usage_day = ?
      RETURNING used_units AS usedUnits, request_count AS requestCount
    `).bind(reservation.units, new Date().toISOString(), reservation.day).first();
    return { day: reservation.day, usedUnits: Number(row?.usedUnits || 0), requestCount: Number(row?.requestCount || 0), limit, remaining: limit - Number(row?.usedUnits || 0) };
  }
  const current = fallbackDailyUsage.get(reservation.day) || { usedUnits: 0, requestCount: 0 };
  const next = {
    usedUnits: Math.max(0, current.usedUnits - reservation.units),
    requestCount: Math.max(0, current.requestCount - 1),
  };
  fallbackDailyUsage.set(reservation.day, next);
  return { day: reservation.day, ...next, limit, remaining: limit - next.usedUnits, fallback: true };
}

function createUsageMeter(env, model) {
  let latest = null;
  let totalUnits = 0;
  let providerCalls = 0;
  return {
    async reserve(label = "generation") {
      try {
        const reservation = await reserveUsageUnits(env, providerCallUnits(model));
        reservation.label = label;
        latest = reservation;
        totalUnits += reservation.units;
        providerCalls += 1;
        return reservation;
      } catch (cause) {
        if (cause?.code === "DAILY_BUDGET_EXCEEDED") throw cause;
        throw codedError("AI 用量保护暂时不可用，为避免产生失控费用，本次请求未执行。", "USAGE_GUARD_UNAVAILABLE");
      }
    },
    async release(reservation) {
      try {
        latest = await releaseDailyBudget(env, reservation) || latest;
        totalUnits = Math.max(0, totalUnits - Number(reservation?.units || 0));
        providerCalls = Math.max(0, providerCalls - 1);
      } catch (cause) {
        console.error(JSON.stringify({ event: "usage_release_failed", error: cause?.message || String(cause) }));
      }
    },
    snapshot() {
      return latest ? { ...latest, units: totalUnits, providerCalls } : null;
    },
  };
}

function normalizeIdList(value, limit = 24) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

function normalizeInput(input = {}) {
  const activeMemeIds = normalizeIdList(input.activeMemeIds, 6);
  const activeCharacterIds = normalizeIdList(input.activeCharacterIds, 8);
  return {
    mode: String(input.mode || "new").trim(),
    theme: String(input.theme || "").trim(),
    roles: String(input.roles || "").trim(),
    scene: String(input.scene || input.world || "").trim(),
    direction: String(input.direction || "").trim(),
    audience: String(input.audience || "").trim(),
    duration: Math.max(15, Math.min(Number(input.duration || 60), 180)),
    clipMode: ["smart", "5", "8", "10"].includes(String(input.clipMode)) ? String(input.clipMode) : "smart",
    episodeCount: Math.max(1, Math.min(Number(input.episodeCount || 1), 12)),
    episodeNumber: Math.max(1, Math.min(Number(input.episodeNumber || 1), 999)),
    style: String(input.style || "").trim(),
    memeSeed: String(input.memeSeed || "").trim(),
    memeLabMode: String(input.memeLabMode || "extract").trim(),
    memeRawMaterial: String(input.memeRawMaterial || "").trim(),
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
    activeMemeIds,
    activeCharacterIds,
    projectMemes: activeMemeIds.length && Array.isArray(input.projectMemes) ? input.projectMemes.filter((item) => activeMemeIds.includes(String(item?.id || ""))).slice(0, 6) : [],
    projectCharacterCards: activeCharacterIds.length && Array.isArray(input.projectCharacterCards) ? input.projectCharacterCards.filter((item) => activeCharacterIds.includes(String(item?.id || ""))).slice(0, 8) : [],
    characterDraft: input.characterDraft && typeof input.characterDraft === "object" ? input.characterDraft : {},
    latestReview: input.latestReview && typeof input.latestReview === "object" ? input.latestReview : null,
    episodePlan: input.episodePlan && typeof input.episodePlan === "object" ? input.episodePlan : {},
  };
}

function storyboardSegmentPlan(duration, clipMode = "smart") {
  const total = Math.max(15, Math.min(Number(duration || 60), 180));
  let targetSeconds = Number(clipMode);
  const isSmart = !Number.isFinite(targetSeconds);
  if (isSmart) targetSeconds = 8;
  const smartCount = isSmart ? Math.ceil(total / targetSeconds) : 0;
  const smartBase = isSmart ? Math.floor(total / smartCount) : 0;
  const smartRemainder = isSmart ? total % smartCount : 0;
  const segments = [];
  let start = 0;
  while (start < total) {
    const seconds = isSmart
      ? smartBase + (segments.length < smartRemainder ? 1 : 0)
      : Math.min(targetSeconds, total - start);
    const generationSeconds = isSmart || seconds >= 4 ? seconds : targetSeconds;
    segments.push({
      shot: segments.length + 1,
      start,
      end: start + seconds,
      seconds,
      generationSeconds,
      trimSeconds: Math.max(0, generationSeconds - seconds),
      timeRange: `${String(start).padStart(2, "0")}-${String(start + seconds).padStart(2, "0")}秒`,
    });
    start += seconds;
  }
  return { clipMode, targetSeconds, total, segments };
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

结构化角色卡（只启用本集输入中出现的角色；一旦启用，性格、反差、口头禅、动作习惯、喜剧触发器和底线均为连续性事实）：
${stringify(payload.projectCharacterCards || [], 6500)}

项目梗库（优先选择与本集情绪和角色匹配的 1-2 条；不得把所有梗同时塞入，也不得声称其为实时热榜）：
${stringify(payload.projectMemes || [], 5000)}

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
13. 本集角色若有结构化角色卡，必须让鲜明特质通过选择和动作表现；每名核心角色最多自然使用 1 次口头禅，并在后文用动作、道具或语义反转完成回扣，禁止机械重复。

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
  const segmentPlan = storyboardSegmentPlan(payload.duration, payload.clipMode);
  const segmentCount = segmentPlan.segments.length;
  return `你是抖音竖屏 9:16 短剧分镜导演。只根据给定剧本生成分镜，不能改写或另起剧情。只输出严格 JSON，不要 Markdown 或解释。

要求：
1. 必须延续剧本的标题、冲突、反转、结尾钩子及核心角色；不新增无关主角。
2. 整集 ${payload.duration} 秒必须严格按下面的制作段计划拆成正好 ${segmentCount} 段，每段对应一次独立 AI 视频生成任务：${stringify(segmentPlan.segments, 3000)}。
3. 每段只允许一个连续场景、一个主动作和最多一个角色反应，不允许在一次生成里硬切多个场景或堆叠复杂动作。beatBreakdown 是同一镜头内的动作阶段，不是多个剪辑镜头；第 1 段的前 3 秒必须完成强画面钩子。
4. 场景为《洛克王国：世界》手游开放世界，主要场景：${compact(payload.scene)}。
5. 必须使用这些角色名：${names.length ? names.join("、") : "以剧本为准"}。
6. 必须服从短剧圣经：镜头不能让角色使用超出能力边界的能力，角色关系和反派线索必须延续已完成集数。
7. 每段都必须填写段目标、承接入点、承接出点、角色、场景、动作、台词/旁白、景别、画面提示词、音效/配乐、关联资产和素材状态；素材状态只能是“已有”“待制作”“待采集”。
8. 必须把剧本中的 visualHighlights 和 comedyBeats 落到具体视频段；至少 3 段有清晰的动作变化、遮挡转场、道具反应或环境异变，避免只写“角色震惊”“光芒闪烁”。
9. visualPrompt 必须包含前景、中景、背景、主体动作、明暗或色彩反差、9:16 字幕安全区；音效必须与画面动作卡点。
10. 每段 visualPrompt 要能脱离上下文直接交给视频模型，并明确“单场景连续镜头、无硬切”；continuityIn 和 continuityOut 必须精确描述首尾人物位置、朝向、表情、道具和环境状态，使相邻视频段能用首尾帧或参考图衔接。
11. 所有视频段合起来必须完整实现当前剧本；最后一段必须呈现剧本结尾悬念，不能擅自增加新反转或混入其他剧本内容。
12. 角色若有结构化角色卡，动作链和画面提示词必须体现其标志性动作、反差或喜剧触发器；口头禅只能出现在剧本已有台词中，不得为分镜擅自加戏。

项目连续性资料：${canon}

剧本：${stringify(script, 12000)}

返回结构：
{
  "storyboard": [
    {"shot":1,"timeRange":"00-08秒","seconds":8,"generationSeconds":8,"segmentGoal":"本段推进的唯一剧情任务","continuityIn":"段首人物、道具和环境状态","continuityOut":"段尾人物、道具和环境状态","beatBreakdown":[{"range":"0-3秒","content":"同一镜头内的动作阶段"},{"range":"3-8秒","content":"同一镜头内的动作阶段"}],"characters":"出镜角色","scene":"单一场景","visual":"整段画面概述","action":"一个主动作和最多一个反应","line":"台词/旁白","scale":"单一主景别或平滑景别变化","movement":"一种主要镜头运动","sound":"音效/配乐建议","subtitle":"字幕文案","visualPrompt":"单场景连续镜头、无硬切的完整9:16提示词","assetLinks":"资产库名称或待采集素材","assetNote":"制作备注","assetStatus":"待制作"}
  ]
}
限制：storyboard 必须正好 ${segmentCount} 条，按时间顺序排列；每段内容只能来自当前剧本。`;
}

function continuityPrompt(input) {
  const payload = normalizeInput(input);
  return `你是连续短剧总编审。请检查当前集是否与《洛克王国：世界》手游短剧项目的短剧圣经和已完成集数一致。只输出严格 JSON，不要 Markdown。

检查要求：
1. 角色性格是否跑偏。
2. 精灵能力是否突破设定或无代价解决危机。
3. 前后集人物关系、反派动机和世界规则是否矛盾。
4. 上一集结尾悬念是否被正确承接；若没有上一集，标记 pass。
5. 结构化角色卡中的鲜明特质、口头禅触发条件、动作习惯和底线是否被正确表现，是否出现机械重复口头禅。
6. 只列可执行的问题和修正建议，不能泛泛而谈。

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
限制：checks 必须包含“角色性格”“角色标志性特征”“精灵能力”“人物关系”“悬念承接”五项；score 为 0-100 整数。`;
}

function biblePrompt(input) {
  const payload = normalizeInput(input);
  return `你是连续短剧的系列开发总编。请根据当前创作方向，为《洛克王国：世界》手游粉丝向短剧起草一份可以连续使用 8-12 集的“短剧圣经”。只输出严格 JSON，不要 Markdown 或解释。

目标：创作者即使还没有完整想法，也能直接以这份圣经生成第一集；内容必须具体、可执行，后续剧本和分镜可以据此检查一致性。

要求：
1. 使用当前输入里的具体角色、精灵和手游场景，不要默认替换成迪莫、小洛克或黑衣人；没有填写时再创造 2-4 个明确角色。
2. 角色设定必须包含欲望、性格底色、弱点、口头习惯和绝不能做的事。
3. 每只核心精灵的能力必须写清效果、代价、冷却或场景限制，禁止无代价升级。
4. 关系要写明当前状态、共同秘密和未来可变化的方向；反派要有合理目标、手段、底线和私人连接。
5. 世界规则必须服务剧情，至少给出 4 条可反复制造冲突的规则；使用《洛克王国：世界》手游开放世界语境，不套旧页游剧情。
6. 主线矛盾应包含起点、三次升级和阶段终点，但不能提前写死每集剧情。
7. 钩子规则必须明确前 3 秒、中段信息变化、AI 视频制作段衔接和结尾悬念的执行标准。
8. 当前圣经若只是泛用占位文本，可以重写；若已有具体人名和规则，要继承而不是推翻。

当前项目与已有圣经：${bibleContext(payload)}
当前创作输入：${creativeInputSummary(payload)}

返回结构：
{
  "bible": {
    "characters":"按角色分行的具体设定",
    "abilities":"按精灵分行的能力边界",
    "relations":"角色关系、秘密与变化方向",
    "antagonist":"反派目标、手段、底线与私人连接",
    "worldRules":"至少4条固定世界规则",
    "mainConflict":"系列主线起点、三次升级和阶段终点",
    "hookRules":"前3秒、中段、AI视频段衔接与结尾钩子规则"
  }
}`;
}

function characterCardPrompt(input) {
  const payload = normalizeInput(input);
  return `你是连续短剧的角色设计师。请根据当前《洛克王国：世界》手游短剧项目，为一个能长期连载的角色补全鲜明角色卡。只输出严格 JSON，不要 Markdown、解释或代码围栏。

要求：
1. 优先保留用户已填写的名字、身份和特点，不得擅自替换；缺少名字时，从本集角色输入中选择一个尚未被完整设定的角色。
2. 角色必须有“稳定底色 + 意外反差 + 可重复的行为模式”，不能只写勇敢、善良、搞笑等空词。
3. 给出 2-3 句原创、短促、口语化的口头禅；每句都要对应具体触发情境，不能照搬现实人物或流行作品台词。
4. 动作习惯必须能在竖屏画面中被看见，并可成为撒谎、紧张、逞强或关系变化的视觉线索。
5. 喜剧触发器要能重复制造“铺垫 -> 误导 -> 回扣”，但不能让角色变成只负责出丑的工具人。
6. 欲望、弱点和底线要能制造选择；底线不能与当前短剧圣经冲突。
7. 使用手游开放世界语境，不套用旧页游剧情，不冒充官方设定。

项目资料：${bibleContext(payload)}
当前创作输入：${creativeInputSummary(payload)}
用户已填写草稿：${stringify(payload.characterDraft || {}, 3000)}

返回结构：
{
  "card": {
    "name":"角色名",
    "role":"一句身份定位",
    "traits":"能通过行为证明的核心特质",
    "contrast":"最有记忆点的反差",
    "desire":"长期核心欲望",
    "weakness":"弱点、触发条件与代价",
    "catchphrases":["口头禅1","口头禅2","口头禅3"],
    "mannerism":"可见的动作习惯及触发条件",
    "comedyTrigger":"可重复的喜剧触发与回扣方式",
    "boundary":"绝不能做的事"
  }
}`;
}

function memeLabPrompt(input) {
  const payload = normalizeInput(input);
  const extractMode = payload.memeLabMode !== "inspire";
  return `你是短视频喜剧梗策划。请为《洛克王国：世界》手游短剧生成 6 个可以真正落到剧情和画面的梗机制。只输出严格 JSON，不要 Markdown 或解释。

任务模式：${extractMode ? "真实素材提炼" : "原创平台化梗结构"}
${extractMode
    ? `用户粘贴的真实素材如下：\n${compact(payload.memeRawMaterial || payload.memeSeed)}\n只能分析和改造这些素材，不得声称它们目前正在流行，也不得编造热度、出处或原句。`
    : "用户没有提供真实热榜素材。请生成符合当代短视频节奏的原创梗结构，并明确标记为“原创结构”；不得冒充实时热梗或虚构来源。"}

要求：
1. 每个梗必须改变角色动作、道具用途、任务规则、场景机关或人物误会，不能只给一句网络化台词。
2. 笑点必须包含铺垫和回扣，尽量做到静音也能看懂；能在一个 5-10 秒 AI 视频段内完成一次可见变化。
3. 结合当前主题、角色、场景、短剧圣经和目标受众；不得默认换成迪莫、小洛克或黑衣人。
4. 六个梗的机制必须不同，至少覆盖视觉反差、规则误导、关系错位、道具回扣四类。
5. 标注适用位置和使用风险，避免生硬蹭热点、冒犯现实人物、整段照搬台词或破坏世界观。

项目资料：${bibleContext(payload)}
本集输入：${creativeInputSummary(payload)}

返回结构：
{
  "ideas": [
    {
      "phrase":"素材关键词或原创梗名",
      "meaning":"该素材在当前语境中的情绪或误会点",
      "mechanism":"如何变成角色动作、道具或世界规则并推动剧情",
      "comedy":"铺垫 -> 误导 -> 回扣的具体笑点",
      "fit":"适合放在开头/升级/反转/结尾中的哪个位置",
      "risk":"需要规避的生硬、过时或侵权风险",
      "sourceType":"${extractMode ? "用户素材" : "原创结构"}"
    }
  ]
}
限制：ideas 必须正好 6 条，每条都要具体到当前角色和场景。`;
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

function validationError(scope, issues) {
  const error = codedError(`${scope}结构不完整：${issues.slice(0, 8).join("；")}`, "AI_OUTPUT_INVALID");
  error.validationIssues = issues;
  return error;
}

function textValue(value) {
  return String(value || "").trim();
}

function normalizedLine(value) {
  return textValue(value).replace(/[\s，。！？、：；,.!?:;“”"'（）()\-]/g, "");
}

function normalizeScript(result, input = {}) {
  const source = result?.script || result;
  if (!source || typeof source !== "object") throw validationError("剧本", ["缺少 script 对象"]);
  const script = {
    title: textValue(source.title),
    synopsis: textValue(source.synopsis),
    characters: (Array.isArray(source.characters) ? source.characters : []).map((item) => ({ name: textValue(item?.name), description: textValue(item?.description) })),
    structure: (Array.isArray(source.structure) ? source.structure : []).map((item) => ({ beat: textValue(item?.beat), content: textValue(item?.content) })),
    dialogue: (Array.isArray(source.dialogue) ? source.dialogue : []).map((item) => ({ role: textValue(item?.role), line: textValue(item?.line) })),
    rhythm: (Array.isArray(source.rhythm) ? source.rhythm : []).map(textValue).filter(Boolean),
    reversals: (Array.isArray(source.reversals) ? source.reversals : []).map(textValue).filter(Boolean),
    innovationPoints: (Array.isArray(source.innovationPoints) ? source.innovationPoints : []).map(textValue).filter(Boolean),
    comedyBeats: (Array.isArray(source.comedyBeats) ? source.comedyBeats : []).map((item) => ({ setup: textValue(item?.setup), payoff: textValue(item?.payoff), visualAction: textValue(item?.visualAction) })),
    visualHighlights: (Array.isArray(source.visualHighlights) ? source.visualHighlights : []).map((item) => ({ moment: textValue(item?.moment), verticalComposition: textValue(item?.verticalComposition), effect: textValue(item?.effect) })),
    hooks: (Array.isArray(source.hooks) ? source.hooks : []).map(textValue).filter(Boolean),
    tags: (Array.isArray(source.tags) ? source.tags : []).map(textValue).filter(Boolean),
  };
  const issues = [];
  if (!script.title) issues.push("标题为空");
  if (!script.synopsis || script.synopsis.length < 30) issues.push("故事梗概不足30字");
  if (script.characters.length < 2 || script.characters.length > 5 || script.characters.some((item) => !item.name || !item.description)) issues.push("人物设定需要2-5个完整角色");
  if (script.structure.length !== 5 || script.structure.some((item) => !item.beat || !item.content)) issues.push("剧情结构必须是5个完整节拍");
  if (script.dialogue.length < 6 || script.dialogue.length > 8 || script.dialogue.some((item) => !item.role || !item.line)) issues.push("台词必须是6-8句且角色、内容均不为空");
  if (!script.rhythm.length || script.rhythm.length > 3) issues.push("情绪节奏需要1-3条");
  if (!script.reversals.length || script.reversals.length > 3) issues.push("反转点需要1-3条");
  if (script.innovationPoints.length < 2 || script.innovationPoints.length > 3) issues.push("创新机制需要2-3条");
  if (script.comedyBeats.length !== 2 || script.comedyBeats.some((item) => !item.setup || !item.payoff || !item.visualAction)) issues.push("笑点设计必须是2条完整的铺垫、回扣和视觉动作");
  if (script.visualHighlights.length !== 3 || script.visualHighlights.some((item) => !item.moment || !item.verticalComposition || !item.effect)) issues.push("视觉爆点必须是3条完整设计");
  if (!script.hooks.length || script.hooks.length > 3) issues.push("爆点与结尾钩子需要1-3条");
  if (!script.tags.length || script.tags.length > 3) issues.push("话题标签需要1-3条");
  const requestedNames = roleNames(input);
  const scriptNames = script.characters.map((item) => item.name);
  const missingNames = requestedNames.filter((name) => !scriptNames.some((candidate) => candidate === name || candidate.includes(name) || name.includes(candidate)));
  if (missingNames.length) issues.push(`缺少用户指定角色：${missingNames.join("、")}`);
  if (issues.length) throw validationError("剧本", issues);
  return { script };
}

function normalizeStoryboard(result, duration, clipMode = "smart", script = null) {
  const source = Array.isArray(result?.storyboard) ? result.storyboard : Array.isArray(result) ? result : [];
  if (!source.length) throw validationError("分镜", ["缺少 storyboard 数组"]);
  const plan = storyboardSegmentPlan(duration || source.reduce((sum, item) => sum + Number(item?.seconds || 0), 0), clipMode);
  const expectedSegments = plan.segments.length;
  if (source.length !== expectedSegments) throw validationError("分镜", [`应返回${expectedSegments}个视频段，实际为${source.length}个`]);
  const storyboard = source.map((shot, index) => {
      const planned = plan.segments[index];
      return {
        shot: index + 1,
        timeRange: planned.timeRange,
        seconds: planned.seconds,
        generationSeconds: planned.generationSeconds,
        trimSeconds: planned.trimSeconds,
        generationMode: "单场景连续镜头",
        segmentGoal: String(shot.segmentGoal || ""),
        continuityIn: String(shot.continuityIn || ""),
        continuityOut: String(shot.continuityOut || ""),
        beatBreakdown: (Array.isArray(shot.beatBreakdown) ? shot.beatBreakdown : []).slice(0, 4).map((beat) => ({
          range: textValue(beat?.range),
          content: textValue(beat?.content),
        })),
        visual: textValue(shot.visual), characters: textValue(shot.characters), scene: textValue(shot.scene), action: textValue(shot.action),
        line: textValue(shot.line), scale: textValue(shot.scale), movement: textValue(shot.movement), sound: textValue(shot.sound),
        subtitle: textValue(shot.subtitle), visualPrompt: textValue(shot.visualPrompt), assetLinks: textValue(shot.assetLinks), assetNote: textValue(shot.assetNote),
        assetStatus: ["已有", "待制作", "待采集"].includes(shot.assetStatus) ? shot.assetStatus : "待制作",
      };
    });
  const requiredFields = ["segmentGoal", "continuityIn", "continuityOut", "visual", "characters", "scene", "action", "line", "scale", "movement", "sound", "subtitle", "visualPrompt"];
  const issues = [];
  storyboard.forEach((shot, index) => {
    const missing = requiredFields.filter((field) => !shot[field]);
    if (missing.length) issues.push(`第${index + 1}段缺少${missing.join("/")}`);
    if (!shot.beatBreakdown.length || shot.beatBreakdown.some((beat) => !beat.range || !beat.content)) issues.push(`第${index + 1}段缺少完整动作阶段`);
  });
  const scriptLines = (script?.dialogue || []).map((item) => normalizedLine(item?.line)).filter((line) => line.length >= 2);
  if (scriptLines.length) {
    const storyboardText = normalizedLine(storyboard.map((shot) => shot.line).join(" "));
    const matched = scriptLines.filter((line) => storyboardText.includes(line)).length;
    const minimumMatches = Math.min(3, Math.ceil(scriptLines.length * 0.4));
    if (matched < minimumMatches) issues.push(`分镜台词仅承接剧本${matched}句，至少需要${minimumMatches}句原台词`);
  }
  if (issues.length) throw validationError("分镜", issues);
  return { storyboard };
}

function normalizeContinuity(result) {
  const report = result && typeof result === "object" ? result : {};
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const requiredAreas = ["角色性格", "角色标志性特征", "精灵能力", "人物关系", "悬念承接"];
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

function normalizeBible(result) {
  const bible = result?.bible && typeof result.bible === "object" ? result.bible : result;
  const keys = ["characters", "abilities", "relations", "antagonist", "worldRules", "mainConflict", "hookRules"];
  if (!bible || typeof bible !== "object") throw new Error("AI 没有返回可用短剧圣经");
  const normalized = Object.fromEntries(keys.map((key) => [key, String(bible[key] || "").trim()]));
  if (keys.some((key) => !normalized[key])) throw new Error("AI 返回的短剧圣经不完整，请重新生成");
  return { bible: normalized };
}

function normalizeMemeIdeas(result) {
  const source = Array.isArray(result?.ideas) ? result.ideas : [];
  const ideas = source.slice(0, 6).map((idea) => ({
    phrase: String(idea?.phrase || "").trim(),
    meaning: String(idea?.meaning || "").trim(),
    mechanism: String(idea?.mechanism || "").trim(),
    comedy: String(idea?.comedy || "").trim(),
    fit: String(idea?.fit || "").trim(),
    risk: String(idea?.risk || "").trim(),
    sourceType: String(idea?.sourceType || "原创结构").trim(),
  })).filter((idea) => idea.phrase && idea.mechanism && idea.comedy);
  if (ideas.length !== 6) throw new Error("AI 没有返回 6 个完整梗机制，请重新生成");
  return { ideas };
}

function normalizeCharacterCard(result) {
  const source = result?.card || result;
  if (!source || typeof source !== "object") throw new Error("AI 没有返回可用角色卡");
  const card = {
    name: String(source.name || "").trim(), role: String(source.role || "").trim(), traits: String(source.traits || "").trim(),
    contrast: String(source.contrast || "").trim(), desire: String(source.desire || "").trim(), weakness: String(source.weakness || "").trim(),
    catchphrases: (Array.isArray(source.catchphrases) ? source.catchphrases : []).map((item) => String(item).trim()).filter(Boolean).slice(0, 5),
    mannerism: String(source.mannerism || "").trim(), comedyTrigger: String(source.comedyTrigger || "").trim(), boundary: String(source.boundary || "").trim(),
  };
  if (!card.name || !card.role || !card.traits || !card.catchphrases.length || !card.boundary) throw new Error("AI 返回的角色卡不完整");
  return { card };
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

async function repairJsonWithDeepSeek(env, input, malformed, maxTokens, usageMeter) {
  const reservation = await usageMeter.reserve("json-repair");
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
        max_tokens: Math.max(1200, Math.min(Number(maxTokens || 1800), 7000)),
        response_format: { type: "json_object" },
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch (cause) {
    await usageMeter.release(reservation);
    if (cause?.name === "AbortError") throw codedError("AI 返回格式异常，自动修复超时，请重新生成。", "AI_JSON_REPAIR_TIMEOUT");
    throw cause;
  } finally {
    clearTimeout(timeoutId);
  }
  const raw = await response.text();
  if (!response.ok) {
    await usageMeter.release(reservation);
    throw codedError(`AI 返回格式异常，自动修复失败（${response.status}）`, "AI_JSON_REPAIR_FAILED");
  }
  const data = JSON.parse(raw);
  return extractJson(data.choices?.[0]?.message?.content || raw);
}

async function askDeepSeek(env, input, prompt, maxTokens, usageMeter, options = {}) {
  if (!env.DEEPSEEK_API_KEY) {
    const missing = new Error("未配置 DeepSeek API Key");
    missing.code = "NO_DEEPSEEK_KEY";
    throw missing;
  }
  const reservation = await usageMeter.reserve(options.label || "generation");
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
          { role: "system", content: options.system || "你是严格执行用户输入的中文短剧创作助手。必须使用用户给定角色名，只输出 JSON。" },
          { role: "user", content: prompt },
        ],
        temperature: Number.isFinite(options.temperature) ? options.temperature : 0.88,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch (cause) {
    await usageMeter.release(reservation);
    if (cause?.name === "AbortError") throw codedError("DeepSeek 响应超时，请缩短输入后重试。", "UPSTREAM_TIMEOUT");
    throw cause;
  } finally {
    clearTimeout(timeoutId);
  }
  const raw = await response.text();
  if (!response.ok) {
    await usageMeter.release(reservation);
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
      return await repairJsonWithDeepSeek(env, input, content, maxTokens, usageMeter);
    } catch (repairError) {
      if (repairError?.code) throw repairError;
      throw codedError("AI 返回格式异常，自动修复仍失败，请重新生成。", "AI_JSON_INVALID");
    }
  }
}

async function normalizeWithRepair(env, input, rawResult, normalizer, maxTokens, usageMeter, scope) {
  try {
    return normalizer(rawResult);
  } catch (cause) {
    if (cause?.code !== "AI_OUTPUT_INVALID") throw cause;
    const issues = Array.isArray(cause.validationIssues) ? cause.validationIssues : [cause.message];
    console.warn(JSON.stringify({ event: "ai_structure_repair", scope, issues }));
    const prompt = `你是严格 JSON 结构修复器。原结果已经是合法 JSON，但缺少必填内容。请只根据问题清单补齐或修正原结果，不要改变主题、角色、剧情因果、剧本结尾或既有台词含义。只输出完整严格 JSON。\n\n问题清单：\n${issues.map((item) => `- ${item}`).join("\n")}\n\n原结果：\n${stringify(rawResult, 24000)}`;
    const repaired = await askDeepSeek(env, input, prompt, maxTokens, usageMeter, {
      label: "structure-repair",
      temperature: 0.12,
      system: "你是 JSON 结构修复器，只补齐校验失败字段，不改写已经成立的内容。只输出 JSON。",
    });
    return normalizer(repaired);
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
  if (url.pathname === "/api/storyboard" && !input.script && !input.previousScript) {
    return error("请先生成或恢复一个剧本，再生成分镜", "SCRIPT_REQUIRED", 400);
  }
  if (["/api/storyboard", "/api/generate"].includes(url.pathname)) {
    const plannedCount = storyboardSegmentPlan(input.duration, input.clipMode).segments.length;
    if (plannedCount > 24) return error("当前分段会产生超过 24 个视频段，请改用智能/8秒/10秒模式或缩短总时长。", "TOO_MANY_SEGMENTS", 400);
  }
  const model = modelFor(input, env);
  if (!env.DEEPSEEK_API_KEY) return error("未配置 DeepSeek API Key", "NO_DEEPSEEK_KEY", 500);
  const usageMeter = createUsageMeter(env, model);
  const requestId = crypto.randomUUID();
  const success = (result) => {
    const usage = usageMeter.snapshot();
    console.log(JSON.stringify({ event: "ai_request_complete", requestId, path: url.pathname, model, units: usage?.units || 0, providerCalls: usage?.providerCalls || 0, usedUnits: usage?.usedUnits, at: new Date().toISOString() }));
    return json({ ok: true, source: "deepseek", model, usage, result });
  };

  if (url.pathname === "/api/script") {
    const raw = await askDeepSeek(env, input, scriptPrompt(input), 2200, usageMeter);
    const result = await normalizeWithRepair(env, input, raw, (value) => normalizeScript(value, input), 2200, usageMeter, "script");
    return success(result);
  }

  if (url.pathname === "/api/storyboard") {
    const storyboardDuration = Math.max(15, Math.min(Number(input.duration || 60), 180));
    const segmentCount = storyboardSegmentPlan(storyboardDuration, input.clipMode).segments.length;
    const segmentTokens = Math.min(7000, 1600 + (segmentCount * 380));
    const raw = await askDeepSeek(env, input, storyboardPrompt(input), segmentTokens, usageMeter);
    const script = input.script || input.previousScript;
    const result = await normalizeWithRepair(env, input, raw, (value) => normalizeStoryboard(value, storyboardDuration, input.clipMode, script), segmentTokens, usageMeter, "storyboard");
    return success(result);
  }

  if (url.pathname === "/api/plans") {
    const result = normalizePlans(await askDeepSeek(env, input, plansPrompt(input), 2200, usageMeter));
    return success(result);
  }

  if (url.pathname === "/api/bible") {
    const result = normalizeBible(await askDeepSeek(env, input, biblePrompt(input), 2400, usageMeter));
    return success(result);
  }

  if (url.pathname === "/api/character-card") {
    const result = normalizeCharacterCard(await askDeepSeek(env, input, characterCardPrompt(input), 1500, usageMeter));
    return success(result);
  }

  if (url.pathname === "/api/meme-lab") {
    if (input.memeLabMode !== "inspire" && !String(input.memeRawMaterial || input.memeSeed || "").trim()) {
      return error("请先提供热榜标题、分享文案或评论素材", "MEME_MATERIAL_REQUIRED", 400);
    }
    const result = normalizeMemeIdeas(await askDeepSeek(env, input, memeLabPrompt(input), 2100, usageMeter));
    return success(result);
  }

  if (url.pathname === "/api/topics") {
    const count = Math.max(1, Math.min(Number(input.count || 8), 12));
    const result = normalizeTopics(await askDeepSeek(env, input, topicsPrompt(input), 1700, usageMeter), count);
    return success(result);
  }

  if (url.pathname === "/api/continuity-check") {
    if (!input.script && !input.previousScript) return error("请先提供需要检查的剧本", "SCRIPT_REQUIRED", 400);
    const result = normalizeContinuity(await askDeepSeek(env, input, continuityPrompt(input), 1500, usageMeter));
    return success(result);
  }

  if (url.pathname === "/api/generate") {
    const rawScript = await askDeepSeek(env, input, scriptPrompt(input), 2200, usageMeter);
    const scriptResult = await normalizeWithRepair(env, input, rawScript, (value) => normalizeScript(value, input), 2200, usageMeter, "script");
    const storyboardDuration = Math.max(15, Math.min(Number(input.duration || 60), 180));
    const segmentCount = storyboardSegmentPlan(storyboardDuration, input.clipMode).segments.length;
    const segmentTokens = Math.min(7000, 1600 + (segmentCount * 380));
    const storyboardInput = { ...input, script: scriptResult.script };
    const rawStoryboard = await askDeepSeek(env, storyboardInput, storyboardPrompt(storyboardInput), segmentTokens, usageMeter);
    const storyboardResult = await normalizeWithRepair(env, storyboardInput, rawStoryboard, (value) => normalizeStoryboard(value, storyboardDuration, input.clipMode, scriptResult.script), segmentTokens, usageMeter, "storyboard");
    return success({ ...scriptResult, ...storyboardResult });
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
  normalizeScript,
  storyboardSegmentPlan,
  normalizeStoryboard,
  normalizeContinuity,
  normalizeBible,
  normalizeCharacterCard,
  normalizeMemeIdeas,
  normalizePlans,
  extractJson,
  creativeInputSummary,
  requestUnits,
  providerCallUnits,
  usageDay,
  reserveDailyBudget,
  releaseDailyBudget,
  dailyUsageStatus,
};
