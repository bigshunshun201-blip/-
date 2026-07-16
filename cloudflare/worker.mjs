import { jsonrepair } from "jsonrepair";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const ALLOWED_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);
const BIBLE_FIELDS = ["characters", "abilities", "relations", "antagonist", "worldRules", "mainConflict", "hookRules"];
const MAX_INPUT_BYTES = 120_000;
const MAX_ARCHIVE_BYTES = 2_000_000;
const RATE_WINDOW_MS = 60_000;
const MAX_AI_REQUESTS_PER_WINDOW = 12;
const AI_GENERATION_TIMEOUT_MS = 90_000;
const AI_REPAIR_TIMEOUT_MS = 60_000;
const AI_HEARTBEAT_INTERVAL_MS = 10_000;
const SCRIPT_OUTPUT_TOKENS = 7200;
const SCRIPT_DOCTOR_OUTPUT_TOKENS = 8000;
const RECAST_OUTPUT_TOKENS = 8000;
const MAX_STORYBOARD_OUTPUT_TOKENS = 8000;
const STORYBOARD_CHUNK_SIZE = 4;
const rateBuckets = new Map();
const fallbackDailyUsage = new Map();
const AI_PATH_COST = new Map([
  ["/api/script", 1],
  ["/api/rewrite-script", 1],
  ["/api/script-canon-review", 1],
  ["/api/storyboard", 1],
  ["/api/bible", 1],
  ["/api/episode-bible", 1],
  ["/api/character-card", 1],
  ["/api/meme-lab", 1],
  ["/api/plans", 1],
  ["/api/creative-mix", 1],
  ["/api/beat-sheet", 1],
  ["/api/topics", 1],
  ["/api/continuity-check", 1],
  ["/api/series-ledger", 1],
  ["/api/script-doctor", 1],
  ["/api/recast-script", 1],
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

function responseForCause(cause) {
  const code = cause?.code || "SERVER_ERROR";
  const status = code === "NO_DEEPSEEK_KEY"
    ? 500
    : code === "REQUEST_TOO_LARGE"
      ? 413
      : code === "INVALID_REQUEST" || code === "INVALID_ARCHIVE_REQUEST" || code === "INVALID_WORKSPACE_KEY"
        ? 400
        : code === "ARCHIVE_TOO_LARGE"
          ? 413
          : code === "ARCHIVE_VERSION_CONFLICT"
            ? 409
            : code === "ARCHIVE_NOT_FOUND"
              ? 404
              : code === "ARCHIVE_DB_UNAVAILABLE"
                ? 503
                : code === "DAILY_BUDGET_EXCEEDED" || code === "USAGE_GUARD_UNAVAILABLE"
                  ? 429
                  : code === "UPSTREAM_TIMEOUT"
                    ? 504
                    : code === "CLIENT_ABORTED"
                      ? 499
                      : 502;
  return error(cause?.message || "生成服务暂时不可用", code, status);
}

function heartbeatJsonResponse(run) {
  const encoder = new TextEncoder();
  const heartbeat = `${" ".repeat(1024)}\n`;
  let canceled = false;
  let heartbeatId;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(heartbeat));
      heartbeatId = setInterval(() => {
        if (canceled) return;
        try {
          controller.enqueue(encoder.encode(heartbeat));
        } catch (_) {
          canceled = true;
          clearInterval(heartbeatId);
        }
      }, AI_HEARTBEAT_INTERVAL_MS);

      void (async () => {
        let response;
        try {
          response = await run();
        } catch (cause) {
          response = responseForCause(cause);
        }
        try {
          const body = await response.text();
          if (!canceled) controller.enqueue(encoder.encode(body));
        } catch (cause) {
          if (!canceled) {
            const fallback = await responseForCause(cause).text();
            controller.enqueue(encoder.encode(fallback));
          }
        } finally {
          clearInterval(heartbeatId);
          if (!canceled) controller.close();
        }
      })();
    },
    cancel() {
      canceled = true;
      clearInterval(heartbeatId);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { ...JSON_HEADERS, "x-roco-response-mode": "heartbeat" },
  });
}

function shouldHeartbeat(request, url) {
  return request.method === "POST" && AI_PATH_COST.has(url.pathname);
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || ""))));
}

async function readArchiveRequest(request) {
  if (!request.body) throw codedError("备份请求缺少内容。", "INVALID_ARCHIVE_REQUEST");
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > MAX_ARCHIVE_BYTES) throw codedError("云端备份超过 2MB，请先精简大型历史资产。", "ARCHIVE_TOO_LARGE");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_ARCHIVE_BYTES) throw codedError("云端备份超过 2MB，请先精简大型历史资产。", "ARCHIVE_TOO_LARGE");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    throw codedError("备份内容不是有效 JSON。", "INVALID_ARCHIVE_REQUEST");
  }
}

async function archiveWorkspaceHash(workspaceKey) {
  const key = String(workspaceKey || "").trim();
  if (key.length < 24 || key.length > 200) throw codedError("恢复密钥无效。", "INVALID_WORKSPACE_KEY");
  return sha256(key);
}

async function archiveList(env, workspaceHash) {
  if (!env.USAGE_DB) throw codedError("云端档案数据库不可用。", "ARCHIVE_DB_UNAVAILABLE");
  const head = await env.USAGE_DB.prepare(
    "SELECT current_revision AS currentRevision, updated_at AS updatedAt FROM archive_workspaces WHERE workspace_hash = ?",
  ).bind(workspaceHash).first();
  const result = await env.USAGE_DB.prepare(
    "SELECT revision, checksum, project_count AS projectCount, created_at AS createdAt FROM project_archive_versions WHERE workspace_hash = ? ORDER BY revision DESC LIMIT 20",
  ).bind(workspaceHash).all();
  return {
    currentRevision: Number(head?.currentRevision || 0),
    updatedAt: head?.updatedAt || null,
    versions: (result?.results || []).map((item) => ({ ...item, revision: Number(item.revision), projectCount: Number(item.projectCount || 0) })),
  };
}

async function saveArchive(env, request) {
  const body = await readArchiveRequest(request);
  const workspaceHash = await archiveWorkspaceHash(body.workspaceKey);
  const archive = body.archive && typeof body.archive === "object" ? body.archive : null;
  if (!archive || !Array.isArray(archive.projects)) throw codedError("备份中缺少项目档案。", "INVALID_ARCHIVE_REQUEST");
  const payloadJson = JSON.stringify(archive);
  if (new TextEncoder().encode(payloadJson).byteLength > MAX_ARCHIVE_BYTES) throw codedError("云端备份超过 2MB，请先精简大型历史资产。", "ARCHIVE_TOO_LARGE");
  if (!env.USAGE_DB) throw codedError("云端档案数据库不可用。", "ARCHIVE_DB_UNAVAILABLE");
  const current = await env.USAGE_DB.prepare(
    `SELECT current_revision AS currentRevision,
      (SELECT checksum FROM project_archive_versions WHERE workspace_hash = ? ORDER BY revision DESC LIMIT 1) AS currentChecksum
     FROM archive_workspaces WHERE workspace_hash = ?`,
  ).bind(workspaceHash, workspaceHash).first();
  const currentRevision = Number(current?.currentRevision || 0);
  const baseRevision = body.baseRevision === null || body.baseRevision === undefined ? null : Number(body.baseRevision);
  if ((currentRevision > 0 && baseRevision === null) || (baseRevision !== null && baseRevision !== currentRevision)) {
    const cause = codedError("云端已有更新版本，请先刷新恢复点后再备份。", "ARCHIVE_VERSION_CONFLICT");
    cause.currentRevision = currentRevision;
    throw cause;
  }
  const now = new Date().toISOString();
  const checksum = await sha256(payloadJson);
  if (currentRevision > 0 && current?.currentChecksum === checksum) {
    return { revision: currentRevision, checksum, projectCount: archive.projects.length, createdAt: now, unchanged: true };
  }
  const revision = currentRevision + 1;
  try {
    await env.USAGE_DB.batch([
      env.USAGE_DB.prepare(`
      INSERT INTO archive_workspaces (workspace_hash, current_revision, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_hash) DO UPDATE SET
        current_revision = excluded.current_revision,
        updated_at = excluded.updated_at
      WHERE current_revision = ?
    `).bind(workspaceHash, revision, now, now, currentRevision),
      env.USAGE_DB.prepare(`
      INSERT INTO project_archive_versions (workspace_hash, revision, payload_json, checksum, project_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(workspaceHash, revision, payloadJson, checksum, archive.projects.length, now),
      env.USAGE_DB.prepare(`
      DELETE FROM project_archive_versions
      WHERE workspace_hash = ? AND revision NOT IN (
        SELECT revision FROM project_archive_versions WHERE workspace_hash = ? ORDER BY revision DESC LIMIT 20
      )
      `).bind(workspaceHash, workspaceHash),
    ]);
  } catch (cause) {
    const latest = await env.USAGE_DB.prepare(
      "SELECT current_revision AS currentRevision FROM archive_workspaces WHERE workspace_hash = ?",
    ).bind(workspaceHash).first();
    if (Number(latest?.currentRevision || 0) !== currentRevision) {
      throw codedError("云端已有更新版本，请先刷新恢复点后再备份。", "ARCHIVE_VERSION_CONFLICT");
    }
    throw cause;
  }
  return { revision, checksum, projectCount: archive.projects.length, createdAt: now };
}

async function loadArchive(env, body) {
  const workspaceHash = await archiveWorkspaceHash(body.workspaceKey);
  if (!env.USAGE_DB) throw codedError("云端档案数据库不可用。", "ARCHIVE_DB_UNAVAILABLE");
  const requestedRevision = Math.max(0, Number(body.revision || 0));
  const row = requestedRevision
    ? await env.USAGE_DB.prepare("SELECT revision, payload_json AS payloadJson, checksum, created_at AS createdAt FROM project_archive_versions WHERE workspace_hash = ? AND revision = ?").bind(workspaceHash, requestedRevision).first()
    : await env.USAGE_DB.prepare("SELECT revision, payload_json AS payloadJson, checksum, created_at AS createdAt FROM project_archive_versions WHERE workspace_hash = ? ORDER BY revision DESC LIMIT 1").bind(workspaceHash).first();
  if (!row) throw codedError("没有找到对应的云端恢复点。", "ARCHIVE_NOT_FOUND");
  return { revision: Number(row.revision), checksum: row.checksum, createdAt: row.createdAt, archive: JSON.parse(row.payloadJson) };
}

async function handleArchiveApi(request, env, url) {
  if (request.method !== "POST") return error("Not found", "NOT_FOUND", 404);
  if (url.pathname === "/api/archive/save") return json({ ok: true, result: await saveArchive(env, request) });
  const body = await readArchiveRequest(request);
  const workspaceHash = await archiveWorkspaceHash(body.workspaceKey);
  if (url.pathname === "/api/archive/list") return json({ ok: true, result: await archiveList(env, workspaceHash) });
  if (url.pathname === "/api/archive/load") return json({ ok: true, result: await loadArchive(env, body) });
  return error("Not found", "NOT_FOUND", 404);
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

function createUsageMeter(env, model, signal = null) {
  let latest = null;
  let totalUnits = 0;
  let providerCalls = 0;
  return {
    signal,
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
  const continuation = input.continuationContext && typeof input.continuationContext === "object" ? input.continuationContext : null;
  return {
    mode: String(input.mode || input.creationMode || "new").trim(),
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
    creativeMixBrief: String(input.creativeMixBrief || "").trim(),
    memeLabMode: String(input.memeLabMode || "extract").trim(),
    memeRawMaterial: String(input.memeRawMaterial || "").trim(),
    aiModel: String(input.aiModel || "").trim(),
    competitorInsights: String(input.competitorInsights || "").trim(),
    continueInstruction: String(input.continueInstruction || "").trim(),
    previousScript: input.previousScript || continuation?.sourceScript || null,
    previousStoryboard: input.previousStoryboard || continuation?.sourceStoryboard || null,
    continuationContext: continuation ? {
      sourceRef: continuation.sourceRef && typeof continuation.sourceRef === "object" ? continuation.sourceRef : null,
      brief: continuation.brief && typeof continuation.brief === "object" ? continuation.brief : {},
      sourceScript: continuation.sourceScript || input.previousScript || null,
      sourceStoryboard: Array.isArray(continuation.sourceStoryboard) ? continuation.sourceStoryboard : [],
      sourceEpisodeBible: continuation.sourceEpisodeBible && typeof continuation.sourceEpisodeBible === "object" ? continuation.sourceEpisodeBible : null,
    } : null,
    script: input.script || null,
    scriptVersionId: String(input.scriptVersionId || "").trim(),
    rewriteTarget: input.rewriteTarget && typeof input.rewriteTarget === "object" ? {
      beatIds: normalizeIdList(input.rewriteTarget.beatIds, 8),
      instruction: String(input.rewriteTarget.instruction || "").trim(),
    } : null,
    generationBibleSnapshot: input.generationBibleSnapshot && typeof input.generationBibleSnapshot === "object" ? input.generationBibleSnapshot : null,
    recastMappings: (Array.isArray(input.recastMappings) ? input.recastMappings : []).slice(0, 5).map((item) => ({
      fromName: String(item?.fromName || "").trim(),
      targetCharacterId: String(item?.targetCharacterId || "").trim(),
    })).filter((item) => item.fromName && item.targetCharacterId),
    projectName: String(input.projectName || "").trim(),
    projectLogline: String(input.projectLogline || "").trim(),
    projectBible: input.projectBible && typeof input.projectBible === "object" ? input.projectBible : {},
    episodeBible: input.episodeBible && typeof input.episodeBible === "object" ? input.episodeBible : null,
    sourceEpisodeBible: input.sourceEpisodeBible && typeof input.sourceEpisodeBible === "object" ? input.sourceEpisodeBible : null,
    projectContinuity: Array.isArray(input.projectContinuity) ? input.projectContinuity.slice(-3) : [],
    projectSeriesLedger: input.projectSeriesLedger && typeof input.projectSeriesLedger === "object" ? input.projectSeriesLedger : {},
    projectCanonSources: Array.isArray(input.projectCanonSources) ? input.projectCanonSources.slice(-30) : [],
    projectEpisodes: Array.isArray(input.projectEpisodes) ? input.projectEpisodes.slice(-30) : [],
    projectAssets: Array.isArray(input.projectAssets) ? input.projectAssets.slice(-24) : [],
    activeMemeIds,
    activeCharacterIds,
    projectMemes: activeMemeIds.length && Array.isArray(input.projectMemes) ? input.projectMemes.filter((item) => activeMemeIds.includes(String(item?.id || ""))).slice(0, 6) : [],
    projectCharacterCards: activeCharacterIds.length && Array.isArray(input.projectCharacterCards) ? input.projectCharacterCards.filter((item) => activeCharacterIds.includes(String(item?.id || ""))).slice(0, 8) : [],
    candidateMemes: Array.isArray(input.candidateMemes) ? input.candidateMemes.slice(0, 30) : [],
    candidateCharacterCards: Array.isArray(input.candidateCharacterCards) ? input.candidateCharacterCards.slice(0, 20) : [],
    characterDraft: input.characterDraft && typeof input.characterDraft === "object" ? input.characterDraft : {},
    latestReview: input.latestReview && typeof input.latestReview === "object" ? input.latestReview : null,
    episodePlan: input.episodePlan && typeof input.episodePlan === "object" ? input.episodePlan : {},
    beatSheet: Array.isArray(input.beatSheet) ? input.beatSheet.slice(0, 8) : [],
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

function storyboardOutputTokens(segmentCount) {
  // A production-ready segment carries continuity, action phases, sound and a standalone video prompt.
  // The previous budget was sized for the older compact schema and could truncate even a valid response.
  return Math.min(MAX_STORYBOARD_OUTPUT_TOKENS, 3600 + (Math.max(1, Number(segmentCount) || 1) * 1000));
}

function storyboardSegmentChunks(segments, chunkSize = STORYBOARD_CHUNK_SIZE) {
  const size = Math.max(1, Math.floor(Number(chunkSize) || STORYBOARD_CHUNK_SIZE));
  const chunks = [];
  for (let index = 0; index < segments.length; index += size) chunks.push(segments.slice(index, index + size));
  return chunks;
}

function roleNames(input) {
  const text = String(input.roles || "");
  const fieldLabels = new Set(["反差", "口头禅", "动作习惯", "底线", "弱点", "欲望", "身份", "特点", "笑点", "喜剧触发", "能力", "代价", "限制"]);
  const matched = [...text.matchAll(/(?:^|[\n；;])\s*([^：:\n；;]{1,20})\s*[：:]/g)]
    .map((match) => match[1].trim())
    .filter((name) => name && !fieldLabels.has(name));
  const fallback = text.split(/[\n；;]+/).map((item) => item.trim().split(/[:：]/)[0].trim()).filter((name) => name && !fieldLabels.has(name));
  return [...new Set(matched.length ? matched : fallback)].slice(0, 4);
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
    projectSeriesLedger,
    projectCanonSources,
    projectEpisodes,
    continuationContext,
    episodeBible,
    sourceEpisodeBible,
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
  for (const attempt of [...new Set([punctuationRepair, normalized, candidate])]) {
    try {
      return JSON.parse(jsonrepair(attempt));
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

系列总圣经（长期底稿，发生冲突时不得无理由推翻）：
${stringify(canonical, 8500)}

本次创作圣经（当前剧本版本的直接生成约束；与系列总圣经有细化差异时，以本次创作圣经为准，但不得无铺垫改写长期事实）：
${payload.episodeBible ? stringify(payload.episodeBible, 8500) : "尚未提供；只能用于策划或起草本次圣经，不得生成正式剧本。"}

已完成集数连续性摘要（只能承接和推进，不能推翻已发生的关键事实）：
${continuity}

连载台账（所有未解悬念、人物现状、能力代价、道具归属和下一集义务均为高优先级连续性事实）：
${stringify(payload.projectSeriesLedger || {}, 7500)}

手游设定来源库（按“手游官方已确认 > 宣传片或实机内容 > 合理推测 > 项目原创二设”使用；“禁用页游设定”必须回避。来源不足时明确作为二设，不得把页游内容冒充手游事实）：
${stringify(payload.projectCanonSources || [], 6500)}

可复用内容资产（优先复用其中适配本集的角色立绘、场景、口头禅、冲突/标题/封面模板和 BGM/SFX 方案；不适配时不要生硬套用）：
${stringify(payload.projectAssets || [], 5000)}

本集选中的结构化角色卡（它们是必须落实的创作素材，但不是全体角色白名单；剧情仍可按需要加入未入库的临时角色。一旦选中，性格、反差、口头禅、动作习惯、喜剧触发器和底线均为连续性事实）：
${stringify(payload.projectCharacterCards || [], 6500)}

项目梗库（优先选择与本集情绪和角色匹配的 1-2 条；不得把所有梗同时塞入，也不得声称其为实时热榜）：
${stringify(payload.projectMemes || [], 5000)}

最近发布复盘（用于调整下一集钩子、标题与封面方向；无数据时忽略）：
${stringify(payload.latestReview || {}, 2200)}`;
}

function continuationPromptContext(payload, scriptLimit = 9000) {
  if (payload.mode !== "continue" && !payload.continuationContext) return "";
  const context = payload.continuationContext || {};
  return `
续写来源引用：${stringify(context.sourceRef || {}, 1200)}
续写承接卡（高优先级）：${stringify(context.brief || {}, 5000)}
来源剧本绑定的本次圣经（只继承来源版本真实保存的快照；为空代表旧版本未保存，不得用当前系列总圣经伪造）：${context.sourceEpisodeBible || payload.sourceEpisodeBible ? stringify(context.sourceEpisodeBible || payload.sourceEpisodeBible, 7000) : "历史快照缺失"}
来源剧本（只用于承接，不得复述或改写上一集）：${stringify(context.sourceScript || payload.previousScript || {}, scriptLimit)}
续写硬规则：第一节拍必须对来源结尾钩子采取行动或给出阶段兑现；保留人物与关系现状、能力代价、道具归属和必须保留事实；新增选题、角色、梗或场景只能在完成承接后升级冲突；结尾必须产生一个新的、下一集可直接执行的悬念。`;
}

function scriptPrompt(input) {
  const payload = normalizeInput(input);
  const names = roleNames(payload);
  const canon = bibleContext(payload);
  const dialogueTarget = Math.max(12, Math.min(24, Math.round(payload.duration / 4)));
  const dialogueMinimum = Math.max(10, dialogueTarget - 2);
  const dialogueMaximum = Math.min(24, dialogueTarget + 2);
  const continuation = payload.mode === "continue"
    ? `\n这是续写任务，不是新建本集。续写方向：${compact(payload.continueInstruction, "升级冲突并保留核心角色关系")}。${continuationPromptContext(payload, 9000)}`
    : "";
  return `你是擅长抖音竖屏连续剧的中文短剧编剧。为《洛克王国：世界》手游粉丝向二创创作一集可拍摄短剧，只输出严格 JSON，不要 Markdown、解释或代码围栏。

创作边界：
1. 必须围绕本次主题「${compact(payload.theme)}」重新创作，不能套用固定故事。
2. 这是手游开放世界语境：探索、传送点、精灵互动、收集、区域首领、隐藏宝藏、地图任务；不要当成旧页游剧情。
3. 不暗示官方授权，不写成官方宣传。
4. 前 3 秒必须抛出强信息钩子；中段每 8-12 秒至少一次信息变化；结尾留下一集能直接承接的问题。
5. 台词必须口语化、短句、可拍摄。热梗素材：${compact(payload.memeSeed, "未提供；使用原创的平台化口语，不得冒充实时热梗")}。热梗必须转化为动作、道具、世界规则或误会机制，不能只把流行句塞进台词。
6. 必须使用下列用户指定角色名，不能擅自替换：${names.length ? names.join("、") : "未指定，可根据主题自创 2-4 名角色"}。角色库不是白名单，在总角色数 2-5 人的范围内，可以按剧情需要加入未入库的临时角色。
7. 本次创作圣经是当前版本的直接约束。角色、能力、关系、反派、世界规则、主线和钩子都必须与其一致。
8. 剧本完成后仅提取会影响后续集数的新增长期事实为 canonDeltas；普通动作、单集胜负和已写入本次圣经的事实不要重复上报。
9. 必须遵守系列与本次圣经的性格、能力边界、角色关系、反派动机、世界规则和钩子规则；不得用失忆、突然升级、复活或新能力偷换已建立事实。
10. 本集为第 ${payload.episodeNumber || 1} 集。它应推进系列主线矛盾，但只解决本集问题，不能终结整个项目主线。
11. 必须严格执行本集策划：开头钩子、核心冲突、反转信息、结尾悬念、时长与目标情绪都要在标题、结构、台词和钩子中可见；不要写成完整闭环故事。
12. 至少制造 2 次意外的概念碰撞，例如“精灵能力限制 + 当代生活困境”或“开放世界机关 + 社交误会”；因果必须成立，不能为了怪而怪。
13. 至少设计 2 个笑点，使用“铺垫 -> 误导 -> 回扣”或可静音看懂的视觉笑点；至少 3 个竖屏强画面，主体动作和前后景变化要明确。
14. 除非本集输入明确要求，不得重复使用失忆、万能黑衣人、契约突然失效、无代价升级等通用套路。反转必须来自本集已出现的规则、道具或人物选择。
15. 本集角色若有结构化角色卡，必须让鲜明特质通过选择和动作表现；每名核心角色最多自然使用 1 次口头禅，并在后文用动作、道具或语义反转完成回扣，禁止机械重复。
16. 必须按已确认的 8 个剧情节拍展开，不得跳过、调换或另起因果；structure 中用 beatIds 标明每一段落实了哪些节拍。
17. 必须执行“角色与梗融合要求”。每张已选角色卡都要有不可替代的戏剧任务和关键选择；每个已选梗都要绑定触发角色，形成铺垫、回扣和剧情后果，并在 assetIntegration 中逐项说明。assetIntegration 只记录本集明确选中的角色卡和梗；自创角色、临时角色和自然产生的笑点不要伪造 assetId。

项目连续性资料：${canon}

本集策划（高优先级）：${stringify(payload.episodePlan || {}, 2600)}

已确认剧情节拍表（高优先级，正式剧本必须逐拍落实）：${stringify(payload.beatSheet || [], 7000)}

本集角色与梗融合要求（高优先级）：${compact(payload.creativeMixBrief, "未填写；根据已选角色卡和梗自然融合")}

本集创作输入：${creativeInputSummary(payload)}${continuation}

返回结构：
{
  "script": {
    "title": "标题，18字以内",
    "synopsis": "120-220字故事梗概，交代目标、阻力、反转和未解决悬念",
    "characters": [{"name":"角色名","description":"人物性格、当前目标、本集关键选择、能力边界及可拍摄的动作或说话特征"}],
    "structure": [
      {"beat":"0-3秒 强钩子","beatIds":["BEAT-01"],"content":"包含角色动作、可见异常和立即问题的具体剧情"},
      {"beat":"冲突建立","beatIds":["BEAT-02"],"content":"包含人物目标、阻力和失败代价的具体剧情"},
      {"beat":"行动与升级","beatIds":["BEAT-03","BEAT-04","BEAT-05"],"content":"分层写清行动、笑点回扣和新信息造成的升级"},
      {"beat":"反转与选择","beatIds":["BEAT-06","BEAT-07"],"content":"写清前置铺垫如何兑现，以及人物被迫做出的选择"},
      {"beat":"选择后果与结尾钩子","beatIds":["BEAT-08"],"content":"呈现选择后果和下一集能直接承接的悬念"}
    ],
    "dialogue": [{"id":"LINE-01","beatIds":["BEAT-01"],"role":"角色名","line":"短台词","intention":"这句话想让对方做什么","subtext":"没说出口的真实意思"}],
    "rhythm": ["情绪节奏"],
    "reversals": ["反转点"],
    "innovationPoints": ["本集独有的剧情机制，以及它怎样推动冲突"],
    "comedyBeats": [{"setup":"笑点铺垫","payoff":"误导或回扣","visualAction":"静音也能看懂的动作"}],
    "visualHighlights": [{"moment":"强画面发生时刻","verticalComposition":"9:16前中后景构图","effect":"画面变化或特效"}],
    "assetIntegration": {
      "characters":[{"assetId":"仅填写已选角色卡id","name":"角色名","storyFunction":"不可替代的本集戏剧任务","choice":"本集关键选择"}],
      "memes":[{"assetId":"仅填写已选梗id","name":"梗名","triggerRole":"触发角色","setup":"铺垫","payoff":"回扣","plotEffect":"如何改变人物行动或剧情结果"}]
    },
    "canonDeltas": [{"id":"CANON-01","field":"characters|abilities|relations|antagonist|worldRules|mainConflict|hookRules","fact":"建议补入本次圣经的长期事实","evidence":"该事实在剧本中的具体依据","risk":"若长期保留可能产生的限制或冲突"}],
    "hooks": ["爆点或结尾钩子"],
    "tags": ["话题标签"]
  }
}
限制：characters 2-5 个；structure 固定 5 段并覆盖 BEAT-01 至 BEAT-08；根据本集 ${payload.duration} 秒时长，dialogue 应为 ${dialogueMinimum}-${dialogueMaximum} 句，每句都要有 intention 和 subtext，避免用长独白凑字数；innovationPoints 1-3 条；comedyBeats 1-3 条；visualHighlights 2-4 条；canonDeltas 允许 0-8 条；rhythm、reversals、hooks、tags 各不超过 3 条。`;
}

function recastPrompt(input) {
  const payload = normalizeInput(input);
  const cardMap = new Map(payload.projectCharacterCards.map((card) => [textValue(card?.id), card]));
  const mappings = payload.recastMappings.map((item) => ({
    fromName: item.fromName,
    targetCharacterId: item.targetCharacterId,
    targetCharacter: cardMap.get(item.targetCharacterId) || null,
  }));
  return `你是连续短剧的改角编剧。请对现有剧本执行批量智能换角，只输出严格 JSON，不要 Markdown、解释或代码围栏。

换角原则：
1. 严格按映射把原角色替换为目标角色卡；没有映射的角色必须保留。
2. 保留原剧本的核心冲突、5段结构、beatIds、反转逻辑、结尾悬念、时长和镜头潜力，不另写一个故事。
3. 不做机械改名。必须同步改写人物描述、台词角色名、说话节奏、动作习惯、口头禅、关键选择、笑点触发方式和能力使用，使其符合目标角色卡与短剧圣经。
4. 如果目标角色能力无法完成原动作，用符合设定的动作、道具或协作方式实现同一剧情后果，不得突破能力边界。
5. 每个目标角色卡都必须进入 assetIntegration.characters，并写清本集戏剧任务与关键选择。未入库角色允许保留，但不要为其伪造 assetId。
6. 原剧本已有的梗绑定、创新机制、视觉爆点和铺垫回扣应尽量保留；因角色特质变化而调整时，必须保持同等戏剧功能。
7. 返回完整 script 对象，字段与原剧本完全一致；characters 2-5 个，dialogue 6-24 句，structure 固定5段。

换角映射：
${stringify(mappings, 9000)}

项目设定：
${bibleContext(payload)}

原剧本：
${stringify(payload.script, 22000)}

返回结构：{"script":{"title":"","synopsis":"","characters":[],"structure":[],"dialogue":[],"rhythm":[],"reversals":[],"innovationPoints":[],"comedyBeats":[],"visualHighlights":[],"assetIntegration":{"characters":[],"memes":[]},"canonDeltas":[],"hooks":[],"tags":[]}}`;
}

function rewriteScriptPrompt(input) {
  const payload = normalizeInput(input);
  const targetBeatIds = payload.rewriteTarget?.beatIds || [];
  return `你是中文竖屏短剧的精修编剧。只对指定剧情节拍及其关联台词做局部改写，只输出严格 JSON，不要 Markdown 或解释。

目标节拍：${targetBeatIds.join("、")}
改写要求：${compact(payload.rewriteTarget?.instruction, "增强冲突、画面动作和台词表现力，同时保持原有因果")}

硬约束：
1. 只能修改 structure 中 beatIds 与目标节拍相交的 content，以及 dialogue 中 beatIds 与目标节拍相交的台词内容。
2. 允许在目标节拍内增删台词，但保留未删除台词原有 id；新增台词 id 使用 LINE-REV-加两位数字。
3. 标题、梗概、人物、非目标结构、非目标台词、情绪节奏、反转、创新机制、笑点、视觉爆点、素材绑定、结尾钩子和标签必须原样返回。
4. 不得突破本次圣经中的能力、人物关系和世界规则，不得改变续写来源已经发生的事实。
5. 改写要形成可拍动作、视觉变化和明确台词意图，不能只替换形容词。
6. 返回完整 script 对象，字段不能缺失；另返回 changeSummary 和 affectedBeatIds。

项目与本次圣经：
${bibleContext(payload)}
${continuationPromptContext(payload, 7000)}

当前完整剧本：
${stringify(payload.script, 24000)}

返回结构：
{"script":{"title":"","synopsis":"","characters":[],"structure":[],"dialogue":[],"rhythm":[],"reversals":[],"innovationPoints":[],"comedyBeats":[],"visualHighlights":[],"assetIntegration":{"characters":[],"memes":[]},"canonDeltas":[],"hooks":[],"tags":[]},"changeSummary":"具体说明改了什么和为什么","affectedBeatIds":["BEAT-01"]}`;
}

function scriptCanonReviewPrompt(input) {
  const payload = normalizeInput(input);
  return `你是连续短剧的设定与连续性总编。复核待批准剧本是否与系列总圣经、本次创作圣经、来源集和连载台账一致。只输出严格 JSON，不要 Markdown 或解释。

检查范围：
1. 角色性格、目标、口头习惯和行为底线是否跑偏。
2. 精灵能力是否突破能力边界、代价、冷却或已记录状态。
3. 人物关系、已知事实、道具归属和反派动机是否矛盾。
4. 续写第一段是否实际承接来源结尾钩子，不能只复述上一集。
5. 结尾是否形成下一集可执行的新悬念，并遵守钩子规则。
6. generationBibleSnapshot 是生成时不可变依据；episodeBible 是当前校准快照。不得为了迁就剧本而自动改写长期设定。

判定规则：没有实质冲突时 status 返回 passed；有任何需要修正的冲突时返回 issues。每个问题必须引用剧本证据、违反的规则和可执行修改建议。只有确实应成为长期事实的内容才能放入 bibleDeltas。

项目资料：
${bibleContext(payload)}
生成时圣经快照：${stringify(payload.generationBibleSnapshot || {}, 8500)}
${continuationPromptContext(payload, 9000)}

待批准剧本：
${stringify(payload.script, 24000)}

返回结构：
{"review":{"status":"passed或issues","summary":"复核结论","issues":[{"id":"REVIEW-01","category":"角色性格|能力边界|人物关系|连续性|道具状态|结尾钩子|世界规则","severity":"高|中|低","evidence":"剧本中的具体证据","rule":"冲突的圣经或来源事实","recommendation":"如何修改剧本","beatIds":["BEAT-01"],"dialogueIds":["LINE-01"]}],"bibleDeltas":[{"id":"CANON-REVIEW-01","field":"characters|abilities|relations|antagonist|worldRules|mainConflict|hookRules","fact":"建议补入本次圣经的长期事实","evidence":"剧本依据","risk":"对后续的限制"}]}}`;
}

function storyboardPrompt(input, options = {}) {
  const payload = normalizeInput(input);
  const script = payload.script || payload.previousScript;
  const names = roleNames(payload);
  const canon = bibleContext(payload);
  const segmentPlan = storyboardSegmentPlan(payload.duration, payload.clipMode);
  const requestedSegments = Array.isArray(options.segments) && options.segments.length ? options.segments : segmentPlan.segments;
  const segmentCount = requestedSegments.length;
  const isChunk = segmentCount !== segmentPlan.segments.length;
  const firstShot = requestedSegments[0]?.shot || 1;
  const lastShot = requestedSegments.at(-1)?.shot || firstShot;
  const productionInstruction = isChunk
    ? `整集 ${payload.duration} 秒共 ${segmentPlan.segments.length} 段。本次只生成第 ${firstShot}-${lastShot} 段，必须严格返回下面 ${segmentCount} 段，不要输出其他段：${stringify(requestedSegments, 3000)}`
    : `整集 ${payload.duration} 秒必须严格按下面的制作段计划拆成正好 ${segmentCount} 段，每段对应一次独立 AI 视频生成任务：${stringify(requestedSegments, 3000)}`;
  const previousContinuity = textValue(options.previousContinuity);
  const compactRetry = Boolean(options.compactRetry);
  return `你是抖音竖屏 9:16 短剧分镜导演。只根据给定剧本生成分镜，不能改写或另起剧情。只输出严格 JSON，不要 Markdown 或解释。

要求：
1. 必须延续剧本的标题、冲突、反转、结尾钩子及核心角色；不新增无关主角。
2. ${productionInstruction}。每段对应一次独立 AI 视频生成任务。
3. 每段只允许一个连续场景、一个主动作和最多一个角色反应，不允许在一次生成里硬切多个场景或堆叠复杂动作。beatBreakdown 是同一镜头内的动作阶段，不是多个剪辑镜头；第 1 段的前 3 秒必须完成强画面钩子。
4. 场景为《洛克王国：世界》手游开放世界，主要场景：${compact(payload.scene)}。
5. 必须使用这些角色名：${names.length ? names.join("、") : "以剧本为准"}。
6. 必须服从短剧圣经：镜头不能让角色使用超出能力边界的能力，角色关系和反派线索必须延续已完成集数。
7. 每段都必须填写段目标、承接入点、承接出点、角色、场景、动作、台词/旁白、景别、画面提示词、音效/配乐、关联资产和素材状态；素材状态只能是“已有”“待制作”“待采集”。
8. 必须把本批所对应的 visualHighlights 和 comedyBeats 落到具体视频段；本批尽可能安排清晰的动作变化、遮挡转场、道具反应或环境异变，避免只写“角色震惊”“光芒闪烁”。
9. visualPrompt 必须包含前景、中景、背景、主体动作、明暗或色彩反差、9:16 字幕安全区；音效必须与画面动作卡点。
10. 每段 visualPrompt 要能脱离上下文直接交给视频模型，并明确“单场景连续镜头、无硬切”；continuityIn 和 continuityOut 必须精确描述首尾人物位置、朝向、表情、道具和环境状态，使相邻视频段能用首尾帧或参考图衔接。
11. 所有视频段合起来必须完整实现当前剧本；最后一段必须呈现剧本结尾悬念，不能擅自增加新反转或混入其他剧本内容。
12. 角色若有结构化角色卡，动作链和画面提示词必须体现其标志性动作、反差或喜剧触发器；口头禅只能出现在剧本已有台词中，不得为分镜擅自加戏。
13. 每段必须用 beatIds 和 dialogueIds 原样引用剧本中的节拍与台词 id；分镜台词必须与所引用 LINE 原台词一致，不能只写意思相近的新台词。
14. 每段 visualPrompt 建议 ${compactRetry ? "80-140" : "100-180"} 字，完整写清环境、构图、角色外观与位置、连续动作、镜头、光色、特效和禁止事项；continuityIn、continuityOut 各建议 ${compactRetry ? "30-60" : "40-90"} 字。增加的是制作信息密度，不得增加剧本之外的新事件。
15. beatBreakdown 按本段时长拆成 ${compactRetry ? "正好 2 个" : "2-3 个"}连续动作阶段，写清每阶段的起点、动作变化和落点，确保可直接用于一次 AI 视频生成。
${previousContinuity ? `16. 本批第一段 continuityIn 必须准确承接上一批最后状态，不得重置人物或道具：${previousContinuity}` : ""}
${compactRetry ? "17. 这是单段紧凑重试：每个字段只写一次，不复述要求、不输出备选方案、不在字符串中嵌套 JSON。" : ""}

项目连续性资料：${canon}

${continuationPromptContext(payload, 5000)}

剧本：${stringify(script, 12000)}

返回结构：
{
  "storyboard": [
    {"clipId":"CLIP-01","shot":1,"beatIds":["BEAT-01"],"dialogueIds":["LINE-01"],"timeRange":"00-08秒","seconds":8,"generationSeconds":8,"segmentGoal":"本段推进的唯一剧情任务","continuityIn":"段首人物、道具和环境状态","continuityOut":"段尾人物、道具和环境状态","beatBreakdown":[{"range":"0-3秒","content":"同一镜头内的动作阶段"},{"range":"3-8秒","content":"同一镜头内的动作阶段"}],"characters":"出镜角色","scene":"单一场景","visual":"整段画面概述","action":"一个主动作和最多一个反应","line":"所引用剧本原台词/旁白","scale":"单一主景别或平滑景别变化","movement":"一种主要镜头运动","sound":"音效/配乐建议","subtitle":"字幕文案","visualPrompt":"单场景连续镜头、无硬切的完整9:16提示词","assetLinks":"资产库名称或待采集素材","assetNote":"制作备注","assetStatus":"待制作"}
  ]
}
限制：storyboard 必须正好 ${segmentCount} 条，对应第 ${firstShot}-${lastShot} 段并按时间顺序排列；每段内容只能来自当前剧本。宁可把同一动作写具体，也不要用空泛形容词或新增剧情来拉长输出。`;
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
${continuationPromptContext(payload, 7000)}
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

function seriesLedgerPrompt(input) {
  const payload = normalizeInput(input);
  return `你是连续短剧的场记与故事编辑。请根据全部已归档集数更新项目“连载台账”，只输出严格 JSON，不要 Markdown 或解释。

原则：
1. 台账只记录已在剧本中发生、明确建立或必须承接的事实；不能把推测写成已发生事实。
2. 旧台账中仍有效的未解悬念必须保留；已经在后续集明确解决的内容移入 resolvedQuestions。
3. 人物状态写当前目标、已知事实、隐瞒事实、核心关系状态和最后变化；能力状态写代价、冷却、禁用条件和最后使用集。
4. 关键道具写持有人、当前状态和“铺垫/回收”进度；重复梗写上次用法、变化和下次使用规则，防止机械重复。
5. nextObligations 必须是下一集能直接执行的具体义务，例如“第4集开头承接徽章裂开后的选择”，不能写“继续推进主线”。
6. 必须遵守《洛克王国：世界》手游来源边界，不得把页游设定补进台账。

项目资料：${bibleContext(payload)}
旧台账：${stringify(payload.projectSeriesLedger || {}, 7500)}
已归档集数场记摘要（按集数顺序，摘要中的代表台词只用于辨认人物声音）：${stringify(payload.projectEpisodes || [], 52000)}

返回结构：
{"ledger":{"throughEpisode":3,"openQuestions":[{"id":"Q-01","question":"未解问题","originEpisode":1,"nextAction":"何时如何承接"}],"resolvedQuestions":[{"id":"Q-00","resolution":"解决事实","resolvedEpisode":2}],"characterStates":[{"name":"角色名","currentGoal":"当前目标","knownFacts":"已知事实","hiddenFacts":"隐瞒事实","relationshipState":"核心关系现状","lastChange":"最后一次变化"}],"abilityStates":[{"name":"精灵或能力","status":"当前可用状态","costCooldown":"代价或冷却","lastUsedEpisode":1}],"propStates":[{"name":"道具名","holder":"持有人","status":"状态","setupPayoff":"铺垫或回收进度"}],"antagonistProgress":"反派计划推进到哪一步","recurringGags":[{"name":"梗名","lastUse":"上次用法","evolution":"已经怎样变化","nextUseRule":"下次如何升级或暂停"}],"nextObligations":["下一集必须承接的具体行动"]}}`;
}

function scriptDoctorPrompt(input) {
  const payload = normalizeInput(input);
  return `你是专业短剧总编和剧本医生。请诊断当前《洛克王国：世界》手游竖屏短剧，并在不改变已确认策划、8节拍因果、人物设定、能力边界和结尾核心承诺的前提下，给出一版完整修订稿。只输出严格 JSON，不要 Markdown。

必须检查：
1. 主角是否主动追求具体目标，还是只被事件拖着走；失败代价和被迫选择是否落实。
2. 冲突是否逐拍升级，每个反转是否由前文规则、道具或选择触发；铺垫是否有回收。
3. 各角色台词能否遮住名字仍被识别；是否遵守说话节奏、压力反应、称呼习惯、撒谎破绽与禁用表达。
4. 已选梗是否成为动作、规则或后果，而不是硬塞流行语；笑点是否有铺垫、误导、回扣。
5. 9:16画面是否有清晰主体动作、道具变化和前中后景；是否能拆成可生成的视频段。
6. 前3秒是否静音也能理解，结尾是否提出下一集必须行动的问题。
7. 手游设定来源是否可靠；来源不明只能作为项目二设，禁用页游设定不得出现。

项目资料：${bibleContext(payload)}
本集策划：${stringify(payload.episodePlan || {}, 3500)}
已确认节拍：${stringify(payload.beatSheet || [], 7500)}
当前剧本：${stringify(payload.script || payload.previousScript || {}, 15000)}

返回结构：
{"report":{"score":0,"summary":"一句话诊断","priority":"最优先修复的一件事","dimensions":[{"area":"主角主动性|冲突升级|铺垫回收|台词区分|梗与笑点|画面表现|结尾钩子|设定边界","score":0}],"issues":[{"severity":"高|中|低","area":"问题维度","problem":"具体问题","evidence":"引用剧情位置或短句作为依据","fix":"可直接执行的修改","beatIds":["BEAT-01"],"dialogueIds":["LINE-01"]}]},"revisedScript":{"title":"完整修订后的剧本对象，结构必须与原剧本生成接口完全一致"}}

限制：dimensions 必须覆盖8个维度；issues 只保留最多8个高价值问题；revisedScript 必须返回完整对象，不得省略未修改字段，并保留稳定的 BEAT 与 LINE 对应。`;
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

function episodeBiblePrompt(input) {
  const payload = normalizeInput(input);
  return `你是连续短剧的单集统筹编剧。请为当前这一版剧本起草“本次创作圣经”，只输出严格 JSON，不要 Markdown、解释或代码围栏。

这不是重写系列总圣经，也不是提前写完整剧本。它是生成当前剧本时必须遵守的可编辑设定快照。

要求：
1. 七项都必须具体对应当前主题、角色、场景、本集策划和8段节拍，不能复制泛用占位句。
2. 角色只写本集实际需要约束的人物：稳定性格、当前欲望、弱点、语言/动作特征、绝不能做的事。
3. 能力只写本集可能调用的效果、代价、冷却、道具状态和不可突破边界。
4. 关系写明本集开场状态、允许发生的变化，以及本集不能提前跨越的关系阶段。
5. 世界规则和反派必须能在画面中通过行动、道具或环境变化体现。
6. 主线矛盾要写清本集推进什么、不能解决什么；钩子规则必须约束第一段承接/兑现、反转和新的可执行结尾悬念。
7. 续写时优先继承来源版本保存的本次圣经、承接卡和来源剧本事实；历史快照缺失时明确保守处理，不得补造来源设定。
8. 可以把系列总圣经细化到当前一集，但不能无铺垫推翻角色底线、能力代价、关系状态、道具归属或手游设定来源边界。

项目与系列资料：${bibleContext(payload)}
当前创作输入：${creativeInputSummary(payload)}
本集策划：${stringify(payload.episodePlan || {}, 4000)}
已确认节拍：${stringify(payload.beatSheet || [], 8500)}
${continuationPromptContext(payload, 8000)}

返回结构：
{"bible":{"characters":"本集角色约束","abilities":"本集能力边界","relations":"本集关系起点与可变范围","antagonist":"本集反派目标、手段和底线","worldRules":"本集生效的场景、任务、道具与世界规则","mainConflict":"本集如何推进主线以及不能提前解决的内容","hookRules":"开头承接、反转与结尾新悬念规则"}}`;
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
8. 建立稳定的“语言指纹”：说话节奏、压力下反应、撒谎破绽、称呼习惯和禁用表达必须彼此一致，并能用于后续台词检查。
9. 补全角色内在需求、旧伤和隐瞒秘密，使外在欲望与内在需求产生矛盾。

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
    "boundary":"绝不能做的事",
    "speechPattern":"说话节奏和句式习惯",
    "pressureResponse":"压力下的语言与行动反应",
    "lieTell":"撒谎时可观察的语言或动作破绽",
    "addressStyle":"对不同关系角色的称呼习惯",
    "forbiddenPhrases":["绝不符合该角色的表达"],
    "innerNeed":"尚未承认的内在需求",
    "wound":"造成错误信念的旧伤",
    "secret":"会改变关系判断的隐瞒秘密"
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

function creativeMixPrompt(input) {
  const payload = normalizeInput(input);
  return `你是连续短剧的选角与喜剧机制策划。请只从候选角色卡和候选梗中设计 3 套不同的“角色 × 梗”剧情组合。只输出严格 JSON，不要 Markdown 或解释。

候选角色卡（characterIds 必须原样引用其中 id）：
${stringify(payload.candidateCharacterCards, 9000)}

候选梗（memeIds 必须原样引用其中 id）：
${stringify(payload.candidateMemes, 9000)}

要求：
1. 每套选择 2-4 个角色和 1-2 个梗；不得创造不存在的 id。
2. 角色不能只是出场名单。必须说明双方欲望、弱点或底线如何发生关系碰撞，并迫使主角作出选择。
3. 梗必须由某个具体角色触发，变成动作、道具、任务规则或误会；写清铺垫、误导、回扣及它如何改变剧情。
4. 三套的角色关系、梗机制、核心选择和开场画面必须不同，不能只换措辞。
5. 组合必须符合《洛克王国：世界》手游开放世界语境，不套旧页游剧情。
6. planPatch 只补人物因果，不代替完整本集策划。

项目资料：${bibleContext(payload)}
本集输入：${creativeInputSummary(payload)}

返回结构：
{
  "mixes": [{
    "angle":"6字以内差异角度",
    "title":"一句话组合方向",
    "characterIds":["候选角色id"],
    "memeIds":["候选梗id"],
    "relationshipCollision":"两个角色的欲望、弱点或底线如何正面冲突",
    "memeMechanism":"谁触发梗，如何铺垫、误导、回扣并改变剧情",
    "plotEngine":"这套组合如何持续制造行动与后果",
    "openingImage":"静音也能看懂的前3秒竖屏画面",
    "planPatch":{
      "protagonistGoal":"本集具体目标",
      "stakes":"失败会失去什么",
      "forcedChoice":"必须二选一的选择",
      "relationshipShift":"关系从什么变成什么"
    }
  }]
}
限制：mixes 必须正好 3 条，每条字段完整。`;
}

function beatSheetPrompt(input) {
  const payload = normalizeInput(input);
  return `你是抖音连续短剧的故事编辑。请把已确认的本集策划拆成正好 8 个因果节拍，不写完整剧本。只输出严格 JSON，不要 Markdown 或解释。

要求：
1. 每个节拍必须由人物目标和行动推动，不能只写“危机升级”“发生反转”等结果。
2. causalLink 必须明确上一拍为什么导致这一拍，使用“因为/但是/所以”表达因果。
3. 第1拍在前3秒展示异常结果；第2-6拍不断增加阻力、代价和信息；第7拍落实反转与被迫选择；第8拍兑现选择后果并留下下一集必须行动的问题。
4. 必须严格执行主角目标、失败代价、被迫选择和关系变化。
5. 已选角色卡必须通过动作和选择体现性格；已选梗必须至少在两个节拍中形成铺垫与回扣，不能只出现在一句台词。
6. assetIds 只引用当前已选角色卡或梗的 id；没有相关资产时返回空数组。
7. 8 个 timeRange 合计覆盖约 ${payload.duration} 秒，动作密度适合竖屏短视频。
8. 使用《洛克王国：世界》手游开放世界语境，不套旧页游剧情。

本集角色与梗融合要求：${compact(payload.creativeMixBrief, "未填写；根据已选角色卡和梗设计自然融合")}
本集策划：${stringify(payload.episodePlan, 5000)}
项目资料：${bibleContext(payload)}
本集输入：${creativeInputSummary(payload)}
${continuationPromptContext(payload, 7000)}

返回结构：
{
  "beats":[{
    "id":"BEAT-01",
    "timeRange":"0-3秒",
    "dramaticTask":"本拍唯一戏剧任务",
    "characterGoal":"此刻谁想得到什么",
    "action":"角色采取的可见行动",
    "newInformation":"观众或角色新增的信息",
    "emotion":"本拍结束时的目标情绪",
    "causalLink":"上一拍如何导致本拍，第一拍说明事件起因",
    "assetIds":["角色或梗id"]
  }]
}
限制：beats 必须正好 8 条，id 从 BEAT-01 到 BEAT-08。`;
}

function plansPrompt(input, options = {}) {
  const payload = normalizeInput(input);
  const names = roleNames(payload);
  const compactRetry = Boolean(options.compactRetry);
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
12. 每套必须写清主角的具体目标、失败代价、不可兼得的被迫选择，以及本集结束后的关系变化；不能只从观众视角罗列钩子。
${compactRetry ? "13. 这是截断后的紧凑重试：每个字符串字段只写一句，每项不超过 55 字，不复述项目资料，不提供备选解释；仍必须保留 3 套方案和全部字段。" : ""}

项目与连续性资料：${bibleContext(payload)}

本集输入：${creativeInputSummary(payload)}
${continuationPromptContext(payload, 7000)}

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
        "protagonistGoal": "主角本集具体想得到、保护或证明什么",
        "stakes": "失败会立刻失去什么",
        "forcedChoice": "主角必须在什么和什么之间二选一",
        "reversal": "改变观众判断的新事实",
        "relationshipShift": "核心关系从什么状态变成什么状态",
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

function normalizeTextList(value, maxItems) {
  const items = Array.isArray(value) ? value : [value];
  return [...new Set(items
    .filter((item) => typeof item === "string" || typeof item === "number")
    .map(textValue)
    .filter(Boolean))]
    .slice(0, maxItems);
}

function normalizedLine(value) {
  return textValue(value).replace(/[\s，。！？、：；,.!?:;“”"'（）()\-]/g, "");
}

function normalizeScript(result, input = {}) {
  const payload = normalizeInput(input);
  const source = result?.script || result;
  if (!source || typeof source !== "object") throw validationError("剧本", ["缺少 script 对象"]);
  const sourceDialogue = Array.isArray(source.dialogue) ? source.dialogue : [];
  const usedDialogueIds = new Set();
  const validBeatIds = payload.beatSheet.length === 8 ? payload.beatSheet.map((beat, index) => textValue(beat?.id) || `BEAT-${String(index + 1).padStart(2, "0")}`) : [];
  const script = {
    title: textValue(source.title),
    synopsis: textValue(source.synopsis),
    characters: (Array.isArray(source.characters) ? source.characters : []).map((item) => ({ name: textValue(item?.name), description: textValue(item?.description) })),
    structure: (Array.isArray(source.structure) ? source.structure : []).map((item) => ({ beat: textValue(item?.beat), beatIds: normalizeIdList(item?.beatIds, 8), content: textValue(item?.content) })),
    dialogue: sourceDialogue.map((item, index) => {
      const supplied = normalizeIdList(item?.beatIds, 8).filter((id) => !validBeatIds.length || validBeatIds.includes(id));
      const fallback = validBeatIds.length ? [validBeatIds[Math.min(validBeatIds.length - 1, Math.floor(index * validBeatIds.length / Math.max(1, sourceDialogue.length)))]] : [];
      const requestedId = textValue(item?.id);
      let id = /^LINE-[A-Z0-9-]+$/i.test(requestedId) && !usedDialogueIds.has(requestedId)
        ? requestedId
        : `LINE-${String(index + 1).padStart(2, "0")}`;
      while (usedDialogueIds.has(id)) id = `LINE-${String(index + 1).padStart(2, "0")}-${usedDialogueIds.size + 1}`;
      usedDialogueIds.add(id);
      return { id, beatIds: supplied.length ? supplied : fallback, role: textValue(item?.role), line: textValue(item?.line), intention: textValue(item?.intention), subtext: textValue(item?.subtext) };
    }),
    rhythm: normalizeTextList(source.rhythm, 3),
    reversals: normalizeTextList(source.reversals, 3),
    innovationPoints: normalizeTextList(source.innovationPoints, 3),
    comedyBeats: (Array.isArray(source.comedyBeats) ? source.comedyBeats : []).map((item) => ({ setup: textValue(item?.setup), payoff: textValue(item?.payoff), visualAction: textValue(item?.visualAction) })),
    visualHighlights: (Array.isArray(source.visualHighlights) ? source.visualHighlights : []).map((item) => ({ moment: textValue(item?.moment), verticalComposition: textValue(item?.verticalComposition), effect: textValue(item?.effect) })),
    assetIntegration: {
      characters: (Array.isArray(source.assetIntegration?.characters) ? source.assetIntegration.characters : []).map((item) => ({ assetId: textValue(item?.assetId), name: textValue(item?.name), storyFunction: textValue(item?.storyFunction), choice: textValue(item?.choice) })),
      memes: (Array.isArray(source.assetIntegration?.memes) ? source.assetIntegration.memes : []).map((item) => ({ assetId: textValue(item?.assetId), name: textValue(item?.name), triggerRole: textValue(item?.triggerRole), setup: textValue(item?.setup), payoff: textValue(item?.payoff), plotEffect: textValue(item?.plotEffect) })),
    },
    canonDeltas: (Array.isArray(source.canonDeltas) ? source.canonDeltas : []).slice(0, 8).map((item, index) => ({
      id: textValue(item?.id) || `CANON-${String(index + 1).padStart(2, "0")}`,
      field: BIBLE_FIELDS.includes(textValue(item?.field)) ? textValue(item?.field) : "",
      fact: textValue(item?.fact || item?.suggestedFact),
      evidence: textValue(item?.evidence),
      risk: textValue(item?.risk) || "需确认是否会限制后续剧情。",
    })).filter((item) => item.field && item.fact && item.evidence),
    hooks: normalizeTextList(source.hooks, 3),
    tags: normalizeTextList(source.tags, 3),
  };
  const issues = [];
  if (!script.title) issues.push("标题为空");
  if (!script.synopsis || script.synopsis.length < 30) issues.push("故事梗概不足30字");
  if (script.characters.length < 2 || script.characters.length > 5 || script.characters.some((item) => !item.name || !item.description)) issues.push("人物设定需要2-5个完整角色");
  if (script.structure.length !== 5 || script.structure.some((item) => !item.beat || !item.content)) issues.push("剧情结构必须是5个完整节拍");
  if (script.dialogue.length < 6 || script.dialogue.length > 24 || script.dialogue.some((item) => !item.role || !item.line)) issues.push("台词必须是6-24句且角色、内容均不为空");
  if (!script.rhythm.length || script.rhythm.length > 3) issues.push("情绪节奏需要1-3条");
  if (!script.reversals.length || script.reversals.length > 3) issues.push("反转点需要1-3条");
  if (script.innovationPoints.length < 1 || script.innovationPoints.length > 3) issues.push("创新机制需要1-3条");
  if (script.comedyBeats.length < 1 || script.comedyBeats.length > 3 || script.comedyBeats.some((item) => !item.setup || !item.payoff || !item.visualAction)) issues.push("笑点设计必须是1-3条完整的铺垫、回扣和视觉动作");
  if (script.visualHighlights.length < 2 || script.visualHighlights.length > 4 || script.visualHighlights.some((item) => !item.moment || !item.verticalComposition || !item.effect)) issues.push("视觉爆点必须是2-4条完整设计");
  if (!script.hooks.length || script.hooks.length > 3) issues.push("爆点与结尾钩子需要1-3条");
  if (!script.tags.length || script.tags.length > 3) issues.push("话题标签需要1-3条");
  const requestedNames = roleNames(input);
  const scriptNames = script.characters.map((item) => item.name);
  const missingNames = requestedNames.filter((name) => !scriptNames.some((candidate) => candidate === name || candidate.includes(name) || name.includes(candidate)));
  if (missingNames.length) issues.push(`缺少用户指定角色：${missingNames.join("、")}`);
  if (payload.beatSheet.length === 8) {
    const coveredBeatIds = new Set(script.structure.flatMap((item) => item.beatIds));
    const missingBeatIds = payload.beatSheet.map((beat, index) => textValue(beat?.id) || `BEAT-${String(index + 1).padStart(2, "0")}`).filter((id) => !coveredBeatIds.has(id));
    if (missingBeatIds.length) issues.push(`剧情结构未覆盖已确认节拍：${missingBeatIds.join("、")}`);
    if (script.dialogue.some((item) => !item.beatIds.length)) issues.push("每句台词必须关联至少一个已确认节拍id");
  }
  const selectedCharacterIds = new Set(payload.projectCharacterCards.map((item) => textValue(item?.id)).filter(Boolean));
  script.assetIntegration.characters = script.assetIntegration.characters.filter((item) => selectedCharacterIds.has(item.assetId));
  const integratedCharacterIds = new Set(script.assetIntegration.characters.map((item) => item.assetId));
  const missingCharacterAssets = [...selectedCharacterIds].filter((id) => !integratedCharacterIds.has(id));
  if (missingCharacterAssets.length || script.assetIntegration.characters.some((item) => !item.name || !item.storyFunction || !item.choice)) issues.push("已选角色卡必须逐个说明戏剧任务和关键选择；未入库角色可以正常参与剧情，无需写入角色卡绑定");
  const selectedMemeIds = new Set(payload.projectMemes.map((item) => textValue(item?.id)).filter(Boolean));
  script.assetIntegration.memes = script.assetIntegration.memes.filter((item) => selectedMemeIds.has(item.assetId));
  const integratedMemeIds = new Set(script.assetIntegration.memes.map((item) => item.assetId));
  const missingMemeAssets = [...selectedMemeIds].filter((id) => !integratedMemeIds.has(id));
  if (missingMemeAssets.length || script.assetIntegration.memes.some((item) => !item.name || !item.triggerRole || !item.setup || !item.payoff || !item.plotEffect)) issues.push("已选梗必须逐个说明触发角色、铺垫、回扣和剧情后果；自然产生的其他笑点无需写入梗库绑定");
  if (issues.length) throw validationError("剧本", issues);
  return { script };
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function sameJson(left, right) {
  return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));
}

function itemTouchesBeats(item, beatIds) {
  return normalizeIdList(item?.beatIds, 8).some((id) => beatIds.includes(id));
}

function rewriteScopeViolations(original, candidate, targetBeatIds) {
  const violations = [];
  const lockedFields = ["title", "synopsis", "characters", "rhythm", "reversals", "innovationPoints", "comedyBeats", "visualHighlights", "assetIntegration", "hooks", "tags"];
  lockedFields.forEach((field) => {
    if (!sameJson(original[field], candidate[field])) violations.push(field);
  });
  const structureCount = Math.max(original.structure.length, candidate.structure.length);
  for (let index = 0; index < structureCount; index += 1) {
    const before = original.structure[index];
    const after = candidate.structure[index];
    if (!itemTouchesBeats(before || after, targetBeatIds) && !sameJson(before, after)) violations.push(`structure:${index + 1}`);
  }
  const beforeLines = new Map(original.dialogue.map((item) => [item.id, item]));
  const afterLines = new Map(candidate.dialogue.map((item) => [item.id, item]));
  [...new Set([...beforeLines.keys(), ...afterLines.keys()])].forEach((id) => {
    const before = beforeLines.get(id);
    const after = afterLines.get(id);
    if (!itemTouchesBeats(before || after, targetBeatIds) && !sameJson(before, after)) violations.push(`dialogue:${id}`);
  });
  return [...new Set(violations)];
}

function scopeRewriteCandidate(original, candidate, targetBeatIds) {
  const scoped = JSON.parse(JSON.stringify(original));
  const targetStructures = candidate.structure.filter((item) => itemTouchesBeats(item, targetBeatIds));
  let structureCursor = 0;
  scoped.structure = original.structure.map((before, index) => {
    if (!itemTouchesBeats(before, targetBeatIds)) return before;
    const after = targetStructures[structureCursor++] || candidate.structure[index];
    if (!after) return before;
    return { ...after, beatIds: [...before.beatIds] };
  });

  const originalLines = new Map(original.dialogue.map((item) => [item.id, item]));
  const candidateLines = new Map(candidate.dialogue.map((item) => [item.id, item]));
  const omittedTargetLines = [];
  scoped.dialogue = original.dialogue.flatMap((before) => {
    if (!itemTouchesBeats(before, targetBeatIds)) return [before];
    const after = candidateLines.get(before.id);
    if (!after) {
      omittedTargetLines.push(before);
      return [];
    }
    return [{ ...after, id: before.id, beatIds: [...before.beatIds] }];
  });
  candidate.dialogue.forEach((after) => {
    if (!originalLines.has(after.id) && itemTouchesBeats(after, targetBeatIds) && scoped.dialogue.length < 24) scoped.dialogue.push(after);
  });
  while (scoped.dialogue.length < 6 && omittedTargetLines.length) scoped.dialogue.push(omittedTargetLines.shift());
  return scoped;
}

function normalizeRewriteScript(result, input = {}) {
  const payload = normalizeInput(input);
  const targetBeatIds = payload.rewriteTarget?.beatIds || [];
  if (!payload.script || !targetBeatIds.length) throw validationError("局部改写", ["缺少当前剧本或目标节拍"]);
  const original = normalizeScript({ script: payload.script }, payload).script;
  const candidate = normalizeScript({ script: result?.script || result }, payload).script;
  const violations = rewriteScopeViolations(original, candidate, targetBeatIds);
  const scopedCandidate = scopeRewriteCandidate(original, candidate, targetBeatIds);
  if (sameJson(original, scopedCandidate)) throw validationError("局部改写", ["模型没有对目标节拍或关联台词产生任何实际改动"]);
  const changeSummary = textValue(result?.changeSummary);
  if (!changeSummary) throw validationError("局部改写", ["缺少修改摘要"]);
  return {
    script: scopedCandidate,
    changeSummary: violations.length ? `${changeSummary}（已自动忽略 ${violations.length} 处锁定区域改动）` : changeSummary,
    discardedChanges: violations,
    affectedBeatIds: normalizeIdList(result?.affectedBeatIds, 8).filter((id) => targetBeatIds.includes(id)).length
      ? normalizeIdList(result?.affectedBeatIds, 8).filter((id) => targetBeatIds.includes(id))
      : targetBeatIds,
  };
}

function normalizeScriptCanonReview(result) {
  const source = result?.review || result;
  if (!source || typeof source !== "object") throw validationError("圣经复核", ["缺少 review 对象"]);
  const issues = (Array.isArray(source.issues) ? source.issues : []).slice(0, 12).map((item, index) => ({
    id: textValue(item?.id) || `REVIEW-${String(index + 1).padStart(2, "0")}`,
    category: textValue(item?.category) || "连续性",
    severity: ["高", "中", "低"].includes(textValue(item?.severity)) ? textValue(item?.severity) : "中",
    evidence: textValue(item?.evidence),
    rule: textValue(item?.rule),
    recommendation: textValue(item?.recommendation),
    beatIds: normalizeIdList(item?.beatIds, 8),
    dialogueIds: normalizeIdList(item?.dialogueIds, 12),
  })).filter((item) => item.evidence && item.rule && item.recommendation);
  const bibleDeltas = (Array.isArray(source.bibleDeltas) ? source.bibleDeltas : []).slice(0, 8).map((item, index) => ({
    id: textValue(item?.id) || `CANON-REVIEW-${String(index + 1).padStart(2, "0")}`,
    field: BIBLE_FIELDS.includes(textValue(item?.field)) ? textValue(item?.field) : "",
    fact: textValue(item?.fact),
    evidence: textValue(item?.evidence),
    risk: textValue(item?.risk) || "采用后会成为本剧本版本的长期约束。",
  })).filter((item) => item.field && item.fact && item.evidence);
  const requestedStatus = textValue(source.status);
  const status = issues.length || requestedStatus === "issues" ? "issues" : "passed";
  const summary = textValue(source.summary);
  if (!summary) throw validationError("圣经复核", ["缺少复核结论"]);
  if (status === "issues" && !issues.length) throw validationError("圣经复核", ["判定存在问题但没有提供可执行问题明细"]);
  return { review: { status, summary, issues, bibleDeltas } };
}

function normalizeRecastScript(result, input = {}) {
  const payload = normalizeInput(input);
  const cardMap = new Map(payload.projectCharacterCards.map((card) => [textValue(card?.id), card]));
  const mappings = payload.recastMappings.map((item) => ({
    fromName: item.fromName,
    targetCharacterId: item.targetCharacterId,
    targetName: textValue(cardMap.get(item.targetCharacterId)?.name),
  }));
  const issues = [];
  if (!payload.script || typeof payload.script !== "object") issues.push("缺少需要换角的原剧本");
  if (!mappings.length) issues.push("至少选择一个换角映射");
  if (mappings.some((item) => !item.targetName)) issues.push("换角目标必须来自当前项目角色库");
  if (new Set(mappings.map((item) => item.fromName)).size !== mappings.length) issues.push("同一个原角色不能重复映射");
  if (new Set(mappings.map((item) => item.targetCharacterId)).size !== mappings.length) issues.push("多个原角色不能替换成同一张角色卡");
  if (issues.length) throw validationError("智能换角", issues);

  const recastInput = {
    ...payload,
    roles: "",
    activeCharacterIds: mappings.map((item) => item.targetCharacterId),
    projectCharacterCards: mappings.map((item) => cardMap.get(item.targetCharacterId)),
  };
  const script = normalizeScript(result, recastInput).script;
  const originalNames = (Array.isArray(payload.script.characters) ? payload.script.characters : []).map((item) => textValue(item?.name)).filter(Boolean);
  const sourceNames = new Set(mappings.map((item) => item.fromName));
  const expectedNames = [
    ...originalNames.filter((name) => !sourceNames.has(name)),
    ...mappings.map((item) => item.targetName),
  ];
  const actualNames = script.characters.map((item) => item.name);
  const missingNames = expectedNames.filter((name) => !actualNames.some((candidate) => candidate === name || candidate.includes(name) || name.includes(candidate)));
  const serializedScript = JSON.stringify(script);
  const retainedSourceNames = [...sourceNames].filter((name) => !mappings.some((item) => item.fromName === name && item.targetName === name)
    && serializedScript.includes(name));
  if (missingNames.length) issues.push(`换角后缺少应保留或替换得到的角色：${missingNames.join("、")}`);
  if (retainedSourceNames.length) issues.push(`换角后仍在人物、梗概、结构或台词中残留原角色：${retainedSourceNames.join("、")}`);
  if (issues.length) throw validationError("智能换角", issues);
  return { script, mappings };
}

function normalizeStoryboard(result, duration, clipMode = "smart", script = null) {
  const source = Array.isArray(result?.storyboard) ? result.storyboard : Array.isArray(result) ? result : [];
  if (!source.length) throw validationError("分镜", ["缺少 storyboard 数组"]);
  const plan = storyboardSegmentPlan(duration || source.reduce((sum, item) => sum + Number(item?.seconds || 0), 0), clipMode);
  const expectedSegments = plan.segments.length;
  if (source.length !== expectedSegments) throw validationError("分镜", [`应返回${expectedSegments}个视频段，实际为${source.length}个`]);
  const scriptBeatIds = [...new Set((script?.structure || []).flatMap((item) => normalizeIdList(item?.beatIds, 8)))];
  const scriptDialogueIds = (script?.dialogue || []).map((item, index) => textValue(item?.id) || `LINE-${String(index + 1).padStart(2, "0")}`);
  const scriptDialogueById = new Map((script?.dialogue || []).map((item, index) => [scriptDialogueIds[index], textValue(item?.line)]));
  const storyboard = source.map((shot, index) => {
      const planned = plan.segments[index];
      const suppliedBeatIds = normalizeIdList(shot?.beatIds, 8).filter((id) => scriptBeatIds.includes(id));
      const suppliedDialogueIds = normalizeIdList(shot?.dialogueIds, 10).filter((id) => scriptDialogueIds.includes(id));
      const fallbackBeat = scriptBeatIds.length ? [scriptBeatIds[Math.min(scriptBeatIds.length - 1, Math.floor(index * scriptBeatIds.length / source.length))]] : [];
      const fallbackDialogue = scriptDialogueIds.length ? [scriptDialogueIds[Math.min(scriptDialogueIds.length - 1, Math.floor(index * scriptDialogueIds.length / source.length))]] : [];
      const resolvedDialogueIds = suppliedDialogueIds.length ? suppliedDialogueIds : fallbackDialogue;
      const referencedLine = resolvedDialogueIds.map((id) => scriptDialogueById.get(id)).filter(Boolean).join(" / ");
      const resolvedLine = referencedLine || textValue(shot.line);
      return {
        clipId: `CLIP-${String(index + 1).padStart(2, "0")}`,
        shot: index + 1,
        beatIds: suppliedBeatIds.length ? suppliedBeatIds : fallbackBeat,
        dialogueIds: resolvedDialogueIds,
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
        line: resolvedLine, scale: textValue(shot.scale), movement: textValue(shot.movement), sound: textValue(shot.sound),
        subtitle: textValue(shot.subtitle) || resolvedLine, visualPrompt: textValue(shot.visualPrompt), assetLinks: textValue(shot.assetLinks), assetNote: textValue(shot.assetNote),
        assetStatus: ["已有", "待制作", "待采集"].includes(shot.assetStatus) ? shot.assetStatus : "待制作",
      };
    });
  const requiredFields = ["segmentGoal", "continuityIn", "continuityOut", "visual", "characters", "scene", "action", "line", "scale", "movement", "sound", "subtitle", "visualPrompt"];
  const issues = [];
  storyboard.forEach((shot, index) => {
    const missing = requiredFields.filter((field) => !shot[field]);
    if (missing.length) issues.push(`第${index + 1}段缺少${missing.join("/")}`);
    if (!shot.beatBreakdown.length || shot.beatBreakdown.some((beat) => !beat.range || !beat.content)) issues.push(`第${index + 1}段缺少完整动作阶段`);
    if (scriptBeatIds.length && !shot.beatIds.length) issues.push(`第${index + 1}段未关联剧本节拍`);
    if (scriptDialogueIds.length && !shot.dialogueIds.length) issues.push(`第${index + 1}段未关联剧本台词`);
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

function normalizeSeriesLedger(result) {
  const source = result?.ledger || result;
  if (!source || typeof source !== "object") throw validationError("连载台账", ["缺少 ledger 对象"]);
  const objects = (key, fields) => (Array.isArray(source[key]) ? source[key] : []).slice(0, 30).map((item) => Object.fromEntries(fields.map((field) => [field, field.toLowerCase().includes("episode") ? Number(item?.[field] || 0) : textValue(item?.[field])]))).filter((item) => fields.some((field) => item[field]));
  const ledger = {
    throughEpisode: Math.max(0, Number(source.throughEpisode || 0)),
    openQuestions: objects("openQuestions", ["id", "question", "originEpisode", "nextAction"]),
    resolvedQuestions: objects("resolvedQuestions", ["id", "resolution", "resolvedEpisode"]),
    characterStates: objects("characterStates", ["name", "currentGoal", "knownFacts", "hiddenFacts", "relationshipState", "lastChange"]),
    abilityStates: objects("abilityStates", ["name", "status", "costCooldown", "lastUsedEpisode"]),
    propStates: objects("propStates", ["name", "holder", "status", "setupPayoff"]),
    antagonistProgress: textValue(source.antagonistProgress),
    recurringGags: objects("recurringGags", ["name", "lastUse", "evolution", "nextUseRule"]),
    nextObligations: (Array.isArray(source.nextObligations) ? source.nextObligations : []).map(textValue).filter(Boolean).slice(0, 12),
    updatedAt: new Date().toISOString(),
  };
  const issues = [];
  if (!ledger.characterStates.length) issues.push("至少需要一条人物现状");
  if (!ledger.nextObligations.length) issues.push("至少需要一条下一集具体承接义务");
  if (issues.length) throw validationError("连载台账", issues);
  return { ledger };
}

function normalizeScriptDoctor(result, input = {}) {
  const reportSource = result?.report || {};
  const requiredAreas = ["主角主动性", "冲突升级", "铺垫回收", "台词区分", "梗与笑点", "画面表现", "结尾钩子", "设定边界"];
  const dimensions = Array.isArray(reportSource.dimensions) ? reportSource.dimensions : [];
  const report = {
    score: Math.max(0, Math.min(100, Number(reportSource.score) || 0)),
    summary: textValue(reportSource.summary), priority: textValue(reportSource.priority),
    dimensions: requiredAreas.map((area) => {
      const item = dimensions.find((candidate) => textValue(candidate?.area).includes(area)) || {};
      return { area, score: Math.max(0, Math.min(100, Number(item.score) || 0)) };
    }),
    issues: (Array.isArray(reportSource.issues) ? reportSource.issues : []).slice(0, 8).map((item) => ({ severity: ["高", "中", "低"].includes(item?.severity) ? item.severity : "中", area: textValue(item?.area), problem: textValue(item?.problem), evidence: textValue(item?.evidence), fix: textValue(item?.fix), beatIds: normalizeIdList(item?.beatIds, 8), dialogueIds: normalizeIdList(item?.dialogueIds, 10) })).filter((item) => item.problem && item.evidence && item.fix),
  };
  const issues = [];
  if (!report.summary || !report.priority) issues.push("诊断结论与优先修复项不能为空");
  if (report.issues.length < 2) issues.push("至少需要2条有依据的具体问题");
  let revisedScript;
  try { revisedScript = normalizeScript({ script: result?.revisedScript }, input).script; } catch (cause) { issues.push(`修订稿不可用：${cause.message}`); }
  if (issues.length) throw validationError("剧本医生", issues);
  return { report, revisedScript };
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
    speechPattern: String(source.speechPattern || "").trim(), pressureResponse: String(source.pressureResponse || "").trim(), lieTell: String(source.lieTell || "").trim(),
    addressStyle: String(source.addressStyle || "").trim(), forbiddenPhrases: (Array.isArray(source.forbiddenPhrases) ? source.forbiddenPhrases : []).map((item) => String(item).trim()).filter(Boolean).slice(0, 8),
    innerNeed: String(source.innerNeed || "").trim(), wound: String(source.wound || "").trim(), secret: String(source.secret || "").trim(),
  };
  if (!card.name || !card.role || !card.traits || !card.catchphrases.length || !card.boundary) throw new Error("AI 返回的角色卡不完整");
  return { card };
}

function normalizePlans(result) {
  const source = Array.isArray(result?.plans) ? result.plans : [];
  const requiredKeys = ["openingHook", "conflict", "protagonistGoal", "stakes", "forcedChoice", "reversal", "relationshipShift", "endingSuspense", "targetEmotion"];
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

function normalizeCreativeMixes(result, input = {}) {
  const payload = normalizeInput(input);
  const validCharacterIds = new Set(payload.candidateCharacterCards.map((item) => textValue(item?.id)).filter(Boolean));
  const validMemeIds = new Set(payload.candidateMemes.map((item) => textValue(item?.id)).filter(Boolean));
  const planKeys = ["protagonistGoal", "stakes", "forcedChoice", "relationshipShift"];
  const mixes = (Array.isArray(result?.mixes) ? result.mixes : []).slice(0, 3).map((item, index) => ({
    id: `creative-mix-${crypto.randomUUID()}`,
    angle: textValue(item?.angle) || `搭配 ${index + 1}`,
    title: textValue(item?.title),
    characterIds: normalizeIdList(item?.characterIds, 4).filter((id) => validCharacterIds.has(id)),
    memeIds: normalizeIdList(item?.memeIds, 2).filter((id) => validMemeIds.has(id)),
    relationshipCollision: textValue(item?.relationshipCollision),
    memeMechanism: textValue(item?.memeMechanism),
    plotEngine: textValue(item?.plotEngine),
    openingImage: textValue(item?.openingImage),
    planPatch: Object.fromEntries(planKeys.map((key) => [key, textValue(item?.planPatch?.[key])])),
  })).filter((item) => item.title && item.characterIds.length >= 2 && item.memeIds.length && item.relationshipCollision && item.memeMechanism && item.plotEngine && item.openingImage && planKeys.every((key) => item.planPatch[key]));
  if (mixes.length !== 3) throw validationError("角色与梗搭配", ["必须返回3套完整搭配，并且只能引用候选资产id"]);
  return { mixes };
}

function normalizeBeatSheet(result, input = {}) {
  const payload = normalizeInput(input);
  const validAssetIds = new Set([
    ...payload.projectCharacterCards.map((item) => textValue(item?.id)),
    ...payload.projectMemes.map((item) => textValue(item?.id)),
  ].filter(Boolean));
  const beats = (Array.isArray(result?.beats) ? result.beats : []).slice(0, 8).map((item, index) => ({
    id: `BEAT-${String(index + 1).padStart(2, "0")}`,
    timeRange: textValue(item?.timeRange),
    dramaticTask: textValue(item?.dramaticTask),
    characterGoal: textValue(item?.characterGoal),
    action: textValue(item?.action),
    newInformation: textValue(item?.newInformation),
    emotion: textValue(item?.emotion),
    causalLink: textValue(item?.causalLink),
    assetIds: normalizeIdList(item?.assetIds, 4).filter((id) => validAssetIds.has(id)),
  }));
  const issues = [];
  if (beats.length !== 8) issues.push("必须返回8个剧情节拍");
  beats.forEach((beat, index) => {
    if (!beat.timeRange || !beat.dramaticTask || !beat.characterGoal || !beat.action || !beat.newInformation || !beat.emotion || !beat.causalLink) issues.push(`第${index + 1}拍字段不完整`);
  });
  if (validAssetIds.size && !beats.some((beat) => beat.assetIds.length)) issues.push("已选角色或梗没有进入任何节拍");
  if (issues.length) throw validationError("剧情节拍表", issues);
  return { beats };
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
  const timeoutId = setTimeout(() => controller.abort(), AI_REPAIR_TIMEOUT_MS);
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
        max_tokens: Math.max(1200, Math.min(Number(maxTokens || 1800), MAX_STORYBOARD_OUTPUT_TOKENS)),
        response_format: { type: "json_object" },
        stream: false,
      }),
      signal: usageMeter.signal ? AbortSignal.any([controller.signal, usageMeter.signal]) : controller.signal,
    });
  } catch (cause) {
    await usageMeter.release(reservation);
    if (cause?.name === "AbortError") {
      if (usageMeter.signal?.aborted) throw codedError("请求已取消，自动修复已停止。", "CLIENT_ABORTED");
      throw codedError("AI 返回格式异常，自动修复超时，请重新生成。", "AI_JSON_REPAIR_TIMEOUT");
    }
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
  const timeoutId = setTimeout(() => controller.abort(), AI_GENERATION_TIMEOUT_MS);
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
      signal: usageMeter.signal ? AbortSignal.any([controller.signal, usageMeter.signal]) : controller.signal,
    });
  } catch (cause) {
    await usageMeter.release(reservation);
    if (cause?.name === "AbortError") {
      if (usageMeter.signal?.aborted) throw codedError("请求已取消，生成已停止。", "CLIENT_ABORTED");
      throw codedError("DeepSeek 响应超时，请缩短输入后重试。", "UPSTREAM_TIMEOUT");
    }
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
  if (data.choices?.[0]?.finish_reason === "length") {
    throw codedError("AI 本次输出达到模型长度上限，系统未保存不完整结果。", "AI_OUTPUT_TRUNCATED");
  }
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

function normalizeStoryboardChunk(result, expectedSegments) {
  const source = Array.isArray(result?.storyboard) ? result.storyboard : Array.isArray(result) ? result : [];
  const issues = [];
  if (source.length !== expectedSegments.length) issues.push(`本批应返回${expectedSegments.length}个视频段，实际为${source.length}个`);
  // Dialogue text and subtitles are deterministically restored from dialogueIds after all chunks merge.
  const requiredFields = ["segmentGoal", "continuityIn", "continuityOut", "visual", "characters", "scene", "action", "scale", "movement", "sound", "visualPrompt"];
  source.forEach((shot, index) => {
    if (!shot || typeof shot !== "object") {
      issues.push(`本批第${index + 1}段不是有效对象`);
      return;
    }
    const missing = requiredFields.filter((field) => !textValue(shot[field]));
    if (missing.length) issues.push(`本批第${index + 1}段缺少${missing.join("/")}`);
    const breakdown = Array.isArray(shot.beatBreakdown) ? shot.beatBreakdown : [];
    if (breakdown.length < 2 || breakdown.some((beat) => !textValue(beat?.range) || !textValue(beat?.content))) issues.push(`本批第${index + 1}段需要2-3个完整动作阶段`);
  });
  if (issues.length) throw validationError("分镜分批", issues);
  return { storyboard: source };
}

async function generateStoryboardInChunks(env, input, duration, usageMeter) {
  const plan = storyboardSegmentPlan(duration, input.clipMode);
  const script = input.script || input.previousScript;

  const generateChunk = async (segments, previousContinuity = "", compactRetry = false) => {
    const maxTokens = compactRetry ? Math.min(MAX_STORYBOARD_OUTPUT_TOKENS, 6500) : storyboardOutputTokens(segments.length);
    try {
      const raw = await askDeepSeek(env, input, storyboardPrompt(input, { segments, previousContinuity, compactRetry }), maxTokens, usageMeter, {
        label: `storyboard-${segments[0].shot}-${segments.at(-1).shot}`,
        temperature: compactRetry ? 0.42 : 0.72,
      });
      const normalized = await normalizeWithRepair(
        env,
        input,
        raw,
        (value) => normalizeStoryboardChunk(value, segments),
        maxTokens,
        usageMeter,
        `storyboard-${segments[0].shot}-${segments.at(-1).shot}`,
      );
      return normalized.storyboard;
    } catch (cause) {
      if (cause?.code !== "AI_OUTPUT_TRUNCATED") throw cause;
      if (segments.length === 1) {
        if (compactRetry) throw codedError("该视频段两次生成都被模型截断，请稍后重试本段。系统已保留剧本和已有分镜，不需要缩短整部剧本。", "STORYBOARD_SEGMENT_TRUNCATED");
        console.warn(JSON.stringify({ event: "storyboard_single_segment_compact_retry", shot: segments[0].shot }));
        return generateChunk(segments, previousContinuity, true);
      }
      const middle = Math.ceil(segments.length / 2);
      console.warn(JSON.stringify({ event: "storyboard_chunk_split", firstShot: segments[0].shot, lastShot: segments.at(-1).shot }));
      const firstHalf = await generateChunk(segments.slice(0, middle), previousContinuity);
      const secondHalf = await generateChunk(segments.slice(middle), textValue(firstHalf.at(-1)?.continuityOut));
      return [
        ...firstHalf,
        ...secondHalf,
      ];
    }
  };

  const storyboard = [];
  let previousContinuity = "";
  for (const segments of storyboardSegmentChunks(plan.segments)) {
    const generated = await generateChunk(segments, previousContinuity);
    storyboard.push(...generated);
    previousContinuity = textValue(generated.at(-1)?.continuityOut);
  }
  return normalizeStoryboard({ storyboard }, duration, input.clipMode, script);
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

  if (url.pathname.startsWith("/api/archive/")) return handleArchiveApi(request, env, url);

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
  if (["/api/script", "/api/generate"].includes(url.pathname) && (!Array.isArray(input.beatSheet) || input.beatSheet.length !== 8)) {
    return error("请先生成并确认完整的8节拍表，再生成正式剧本", "BEAT_SHEET_REQUIRED", 400);
  }
  if (["/api/script", "/api/generate"].includes(url.pathname)
    && (!input.episodeBible || BIBLE_FIELDS.some((field) => !textValue(input.episodeBible[field])))) {
    return error("请先准备并确认完整的本次创作圣经，再生成正式剧本", "EPISODE_BIBLE_REQUIRED", 400);
  }
  if (url.pathname === "/api/storyboard" && !input.script && !input.previousScript) {
    return error("请先生成或恢复一个剧本，再生成分镜", "SCRIPT_REQUIRED", 400);
  }
  if (url.pathname === "/api/rewrite-script" && (!input.script || !Array.isArray(input.rewriteTarget?.beatIds) || !input.rewriteTarget.beatIds.length)) {
    return error("请提供当前剧本、目标节拍和改写要求", "REWRITE_TARGET_REQUIRED", 400);
  }
  if (url.pathname === "/api/script-canon-review" && (!input.script || !input.episodeBible)) {
    return error("请提供待批准剧本及其本次创作圣经", "CANON_REVIEW_CONTEXT_REQUIRED", 400);
  }
  if (["/api/storyboard", "/api/generate"].includes(url.pathname)) {
    const plannedCount = storyboardSegmentPlan(input.duration, input.clipMode).segments.length;
    if (plannedCount > 24) return error("当前分段会产生超过 24 个视频段，请改用智能/8秒/10秒模式或缩短总时长。", "TOO_MANY_SEGMENTS", 400);
  }
  const model = modelFor(input, env);
  if (!env.DEEPSEEK_API_KEY) return error("未配置 DeepSeek API Key", "NO_DEEPSEEK_KEY", 500);
  const usageMeter = createUsageMeter(env, model, request.signal);
  const requestId = crypto.randomUUID();
  const success = (result) => {
    const usage = usageMeter.snapshot();
    console.log(JSON.stringify({ event: "ai_request_complete", requestId, path: url.pathname, model, units: usage?.units || 0, providerCalls: usage?.providerCalls || 0, usedUnits: usage?.usedUnits, at: new Date().toISOString() }));
    return json({ ok: true, source: "deepseek", model, usage, result });
  };

  if (url.pathname === "/api/script") {
    const raw = await askDeepSeek(env, input, scriptPrompt(input), SCRIPT_OUTPUT_TOKENS, usageMeter);
    const result = await normalizeWithRepair(env, input, raw, (value) => normalizeScript(value, input), SCRIPT_OUTPUT_TOKENS, usageMeter, "script");
    return success(result);
  }

  if (url.pathname === "/api/rewrite-script") {
    const raw = await askDeepSeek(env, input, rewriteScriptPrompt(input), SCRIPT_OUTPUT_TOKENS, usageMeter, { temperature: 0.55 });
    const result = await normalizeWithRepair(env, input, raw, (value) => normalizeRewriteScript(value, input), SCRIPT_OUTPUT_TOKENS, usageMeter, "rewrite-script");
    return success(result);
  }

  if (url.pathname === "/api/script-canon-review") {
    const raw = await askDeepSeek(env, input, scriptCanonReviewPrompt(input), 3600, usageMeter, { temperature: 0.2 });
    const result = await normalizeWithRepair(env, input, raw, normalizeScriptCanonReview, 3600, usageMeter, "script-canon-review");
    return success(result);
  }

  if (url.pathname === "/api/storyboard") {
    const storyboardDuration = Math.max(15, Math.min(Number(input.duration || 60), 180));
    const result = await generateStoryboardInChunks(env, input, storyboardDuration, usageMeter);
    return success(result);
  }

  if (url.pathname === "/api/plans") {
    let rawPlans;
    try {
      rawPlans = await askDeepSeek(env, input, plansPrompt(input), 5000, usageMeter, {
        label: "episode-plans",
        temperature: 0.78,
      });
    } catch (cause) {
      if (cause?.code !== "AI_OUTPUT_TRUNCATED") throw cause;
      console.warn(JSON.stringify({ event: "episode_plans_compact_retry" }));
      try {
        rawPlans = await askDeepSeek(env, input, plansPrompt(input, { compactRetry: true }), 6500, usageMeter, {
          label: "episode-plans-compact-retry",
          temperature: 0.52,
        });
      } catch (retryCause) {
        if (retryCause?.code === "AI_OUTPUT_TRUNCATED") {
          throw codedError("三套本集策划连续两次被模型截断，请再次点击生成。当前输入、已保存策划和剧本均未被覆盖。", "PLANS_OUTPUT_TRUNCATED");
        }
        throw retryCause;
      }
    }
    const result = normalizePlans(rawPlans);
    return success(result);
  }

  if (url.pathname === "/api/creative-mix") {
    if (!Array.isArray(input.candidateCharacterCards) || input.candidateCharacterCards.length < 2 || !Array.isArray(input.candidateMemes) || !input.candidateMemes.length) {
      return error("角色库至少需要2张角色卡，梗库至少需要1条梗", "CREATIVE_ASSETS_REQUIRED", 400);
    }
    const result = normalizeCreativeMixes(await askDeepSeek(env, input, creativeMixPrompt(input), 2400, usageMeter), input);
    return success(result);
  }

  if (url.pathname === "/api/beat-sheet") {
    const requiredPlanKeys = ["openingHook", "conflict", "protagonistGoal", "stakes", "forcedChoice", "reversal", "relationshipShift", "endingSuspense", "targetEmotion"];
    if (requiredPlanKeys.some((key) => !textValue(input.episodePlan?.[key]))) {
      return error("请先完成包含人物目标、失败代价、被迫选择和关系变化的本集策划", "EPISODE_PLAN_REQUIRED", 400);
    }
    const result = normalizeBeatSheet(await askDeepSeek(env, input, beatSheetPrompt(input), 2600, usageMeter), input);
    return success(result);
  }

  if (url.pathname === "/api/bible") {
    const result = normalizeBible(await askDeepSeek(env, input, biblePrompt(input), 2400, usageMeter));
    return success(result);
  }

  if (url.pathname === "/api/episode-bible") {
    const requiredPlanKeys = ["openingHook", "conflict", "protagonistGoal", "stakes", "forcedChoice", "reversal", "relationshipShift", "endingSuspense", "targetEmotion"];
    if (requiredPlanKeys.some((key) => !textValue(input.episodePlan?.[key])) || !Array.isArray(input.beatSheet) || input.beatSheet.length !== 8) {
      return error("请先完成本集策划并确认完整的8节拍表", "EPISODE_BIBLE_CONTEXT_REQUIRED", 400);
    }
    const result = normalizeBible(await askDeepSeek(env, input, episodeBiblePrompt(input), 2600, usageMeter));
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

  if (url.pathname === "/api/series-ledger") {
    if (!Array.isArray(input.projectEpisodes) || !input.projectEpisodes.length) return error("请先归档至少一集剧本", "EPISODES_REQUIRED", 400);
    const raw = await askDeepSeek(env, input, seriesLedgerPrompt(input), 3000, usageMeter);
    const result = await normalizeWithRepair(env, input, raw, normalizeSeriesLedger, 3000, usageMeter, "series-ledger");
    return success(result);
  }

  if (url.pathname === "/api/script-doctor") {
    if (!input.script && !input.previousScript) return error("请先提供需要诊断的剧本", "SCRIPT_REQUIRED", 400);
    const raw = await askDeepSeek(env, input, scriptDoctorPrompt(input), SCRIPT_DOCTOR_OUTPUT_TOKENS, usageMeter, { temperature: 0.55 });
    const result = await normalizeWithRepair(env, input, raw, (value) => normalizeScriptDoctor(value, input), SCRIPT_DOCTOR_OUTPUT_TOKENS, usageMeter, "script-doctor");
    return success(result);
  }

  if (url.pathname === "/api/recast-script") {
    if (!input.script || !Array.isArray(input.recastMappings) || !input.recastMappings.length) {
      return error("请先提供当前剧本，并至少选择一个角色替换关系", "RECAST_MAPPING_REQUIRED", 400);
    }
    const raw = await askDeepSeek(env, input, recastPrompt(input), RECAST_OUTPUT_TOKENS, usageMeter, { temperature: 0.5 });
    const result = await normalizeWithRepair(env, input, raw, (value) => normalizeRecastScript(value, input), RECAST_OUTPUT_TOKENS, usageMeter, "recast-script");
    return success(result);
  }

  if (url.pathname === "/api/generate") {
    const rawScript = await askDeepSeek(env, input, scriptPrompt(input), SCRIPT_OUTPUT_TOKENS, usageMeter);
    const scriptResult = await normalizeWithRepair(env, input, rawScript, (value) => normalizeScript(value, input), SCRIPT_OUTPUT_TOKENS, usageMeter, "script");
    const storyboardDuration = Math.max(15, Math.min(Number(input.duration || 60), 180));
    const storyboardInput = { ...input, script: scriptResult.script };
    const storyboardResult = await generateStoryboardInChunks(env, storyboardInput, storyboardDuration, usageMeter);
    return success({ ...scriptResult, ...storyboardResult });
  }

  return error("Not found", "NOT_FOUND", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        if (shouldHeartbeat(request, url)) return heartbeatJsonResponse(() => api(request, env, url));
        return await api(request, env, url);
      }
      return env.ASSETS.fetch(request);
    } catch (cause) {
      return responseForCause(cause);
    }
  },
};

export const __test = {
  normalizeInput,
  normalizeScript,
  normalizeRewriteScript,
  normalizeScriptCanonReview,
  storyboardSegmentPlan,
  storyboardOutputTokens,
  storyboardSegmentChunks,
  normalizeStoryboard,
  normalizeStoryboardChunk,
  normalizeContinuity,
  normalizeBible,
  normalizeCharacterCard,
  normalizeSeriesLedger,
  normalizeScriptDoctor,
  normalizeRecastScript,
  normalizeMemeIdeas,
  normalizePlans,
  normalizeCreativeMixes,
  normalizeBeatSheet,
  scriptPrompt,
  rewriteScriptPrompt,
  scriptCanonReviewPrompt,
  plansPrompt,
  beatSheetPrompt,
  storyboardPrompt,
  continuityPrompt,
  episodeBiblePrompt,
  extractJson,
  creativeInputSummary,
  requestUnits,
  providerCallUnits,
  usageDay,
  reserveDailyBudget,
  releaseDailyBudget,
  dailyUsageStatus,
  heartbeatJsonResponse,
  shouldHeartbeat,
};
