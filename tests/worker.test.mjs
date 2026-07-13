import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { __test } from "../cloudflare/worker.mjs";

const require = createRequire(import.meta.url);
const workflow = require("../workflow-core.js");
const apiClientModule = require("../api-client.js");
const dataStoreModule = require("../data-store.js");
const projectDomain = require("../project-domain.js");
const episodePlanner = require("../episode-planner.js");
const uiTemplates = require("../ui-templates.js");

test("storyboard normalizer retains production fields", () => {
  const result = __test.normalizeStoryboard({
    storyboard: [{
      shot: 1,
      seconds: 3,
      characters: "阿洛、迪莫",
      scene: "月牙镇",
      visual: "契约发光",
      action: "迪莫后退",
      line: "别过来。",
      scale: "近景",
      movement: "推镜",
      sound: "低频警报",
      subtitle: "契约失效",
      visualPrompt: "雨夜月牙镇，发光契约",
      assetLinks: "迪莫雨夜立绘",
      assetNote: "待录警报音",
      assetStatus: "待制作",
    }, {
      shot: 2,
      characters: "阿洛",
      scene: "月牙镇",
      visual: "阿洛接住徽章",
      action: "抬头",
      assetStatus: "已有",
    }],
  }, 15);
  assert.equal(result.storyboard[0].assetStatus, "待制作");
  assert.equal(result.storyboard[0].assetLinks, "迪莫雨夜立绘");
  assert.equal(result.storyboard[0].characters, "阿洛、迪莫");
  assert.equal(result.storyboard[0].seconds, 10);
  assert.equal(result.storyboard[1].seconds, 5);
  assert.equal(result.storyboard[1].timeRange, "10-15秒");
});

test("continuity normalizer always returns the four required checks", () => {
  const result = __test.normalizeContinuity({
    score: 86,
    summary: "主线承接正常",
    checks: [{ area: "角色性格", status: "pass", evidence: "阿洛仍然嘴硬", fix: "无需调整" }],
  });
  assert.equal(result.score, 86);
  assert.deepEqual(result.checks.map((check) => check.area), ["角色性格", "精灵能力", "人物关系", "悬念承接"]);
});

test("bible normalizer requires all continuity fields", () => {
  const bible = Object.fromEntries(["characters", "abilities", "relations", "antagonist", "worldRules", "mainConflict", "hookRules"].map((key) => [key, `${key}内容`]));
  assert.deepEqual(__test.normalizeBible({ bible }).bible, bible);
  assert.throws(() => __test.normalizeBible({ bible: { characters: "只有角色" } }), /不完整/);
});

test("meme lab normalizer requires six usable mechanisms", () => {
  const ideas = Array.from({ length: 6 }, (_, index) => ({
    phrase: `梗${index + 1}`,
    meaning: "情绪误会",
    mechanism: `道具机制${index + 1}`,
    comedy: `铺垫 -> 误导 -> 回扣${index + 1}`,
    fit: "升级段",
    risk: "避免照搬",
    sourceType: "用户素材",
  }));
  assert.equal(__test.normalizeMemeIdeas({ ideas }).ideas.length, 6);
  assert.throws(() => __test.normalizeMemeIdeas({ ideas: ideas.slice(0, 5) }), /6 个完整梗机制/);
});

test("AI plan normalizer requires three complete episode plans", () => {
  const result = __test.normalizePlans({
    plans: ["危机", "关系", "规则"].map((angle, index) => ({
      angle,
      title: `方案${index + 1}`,
      why: "适合当前选题",
      innovation: `创新机制${index + 1}`,
      memeMechanic: `梗机制${index + 1}`,
      visualSetpiece: `强画面${index + 1}`,
      plan: {
        openingHook: `开头${index + 1}`,
        conflict: `冲突${index + 1}`,
        reversal: `反转${index + 1}`,
        endingSuspense: `悬念${index + 1}`,
        targetEmotion: "紧张 -> 错愕 -> 追更",
      },
    })),
  });
  assert.equal(result.plans.length, 3);
  assert.equal(result.plans[1].plan.reversal, "反转2");
  assert.equal(result.plans[1].innovation, "创新机制2");
  assert.throws(() => __test.normalizePlans({ plans: result.plans.slice(0, 2) }), /3 套完整策划/);
});

test("UI contains the production workflow controls", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["planOpeningHook", "autoPlanBtn", "suggestPlansBtn", "planSuggestions", "planHistoryList", "planReadyState", "memeLabBtn", "memeInspireBtn", "memeLabResults", "generateBibleBtn", "applyBibleTemplateBtn", "storyboardHistory", "checkContinuityBtn", "assetLibrary", "reviewCommentThemes", "exportProjectBtn"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /open\.douyin\.com\/platform\/resource\/docs\/openapi\/data-open-service\/tops-data\/hot-video-list/);
  assert.match(html, /data-ai-model-switch/);
});

test("JSON extraction repairs common missing commas from model output", () => {
  const betweenObjects = __test.extractJson('{"storyboard":[{"shot":1} {"shot":2}]}');
  assert.deepEqual(betweenObjects.storyboard.map((shot) => shot.shot), [1, 2]);
  const betweenProperties = __test.extractJson('{"shots":[1,2] "title":"分镜"}');
  assert.equal(betweenProperties.title, "分镜");
});

test("episode planner produces three complete and distinct starting plans", () => {
  const options = episodePlanner.generatePlanOptions({
    theme: "迪莫拒绝回家",
    roles: "阿洛：老玩家；迪莫：搭档；影像人：对手",
    scene: "月牙镇",
    memeSeed: "这合理吗",
  }, { seed: 7, count: 3 });
  assert.equal(options.length, 3);
  assert.equal(new Set(options.map((option) => option.angle)).size, 3);
  for (const option of options) {
    assert.equal(episodePlanner.planIsComplete(option.plan), true);
    assert.match(option.plan.openingHook, /月牙镇|阿洛|迪莫/);
  }
});

test("episode planner fills only missing fields when a creator has started writing", () => {
  const plan = episodePlanner.completePlan({
    theme: "契约异常",
    episodePlan: { openingHook: "我自己写的开头" },
  }, { seed: 3 });
  assert.equal(plan.openingHook, "我自己写的开头");
  assert.equal(episodePlanner.planIsComplete(plan), true);
});

test("continuity uses episodes before the target instead of the selected episode id", () => {
  const episodes = [1, 2, 3, 4].map((episodeNumber) => ({
    id: `episode-${episodeNumber}`,
    episodeNumber,
    script: { title: `第${episodeNumber}集`, synopsis: `剧情${episodeNumber}`, hooks: [`悬念${episodeNumber}`] },
    versions: [{ id: `v-${episodeNumber}`, consistency: { mustPreserve: [`事实${episodeNumber}`] } }],
    activeVersionId: `v-${episodeNumber}`,
  }));
  const context = workflow.continuityForTarget(episodes, 4, 3);
  assert.deepEqual(context.map((item) => item.episodeNumber), [1, 2, 3]);
  assert.deepEqual(context.at(-1).mustPreserve, ["事实3"]);
});

test("project-backed history is compacted and hydrated without duplicating scripts", () => {
  const history = [{
    id: "history-1",
    projectId: "project-1",
    projectName: "测试项目",
    episodeNumber: 1,
    input: { theme: "契约失效", duration: 60, episodeNumber: 1 },
    script: { title: "消失的契约" },
    storyboard: [{ shot: 1 }],
    creativePack: { titleVariants: [] },
  }];
  const compact = workflow.compactHistory(history);
  assert.equal(compact[0].script, undefined);
  assert.equal(compact[0].archivedInProject, true);

  const projects = [{
    id: "project-1",
    name: "测试项目",
    episodes: [{
      episodeNumber: 1,
      versions: [{ historyId: "history-1", input: history[0].input, script: history[0].script, storyboard: history[0].storyboard }],
    }],
  }];
  const hydrated = workflow.hydrateHistory(compact, projects);
  assert.equal(hydrated[0].script.title, "消失的契约");
  assert.equal(hydrated[0].storyboard.length, 1);
});

test("frontend includes request timeout and stale-result protection", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(source, /apiTimeoutMs = 90_000/);
  assert.match(source, /assertActiveAiOperation\(operation\)/);
  assert.match(source, /resetCurrentCreation\(\)/);
  assert.doesNotMatch(source, /window\.prompt\("新项目名称"/);
});

test("topic selection prepares planning without directly generating a script", async () => {
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(source, /function prepareTopicPlanning\(index, mode = "new"\)/);
  assert.doesNotMatch(source, /function generateFromTopic/);
  assert.match(source, /prepareTopicPlanning\(Number\(generateButton\.dataset\.topicGenerate\), "new"\)/);
  assert.match(source, /applyEpisodePlan\(\{\}\)/);
});

test("script generation stays gated until the episode plan is complete", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(html, /id="generateBtn" disabled>先完成本集策划/);
  assert.ok(html.indexOf("id=\"generateBtn\"") > html.indexOf("id=\"planTargetEmotion\""));
  assert.match(source, /episodePlanner\.planIsComplete\(getInput\(\)\.episodePlan\)/);
  assert.match(source, /generateButton\.disabled = isBusy \|\| !hasCompletePlan/);
});

test("daily budget weights Pro requests and blocks requests over the limit", async () => {
  const env = { DAILY_AI_UNIT_LIMIT: "10" };
  assert.equal(__test.requestUnits("/api/script", "deepseek-v4-flash"), 1);
  assert.equal(__test.requestUnits("/api/plans", "deepseek-v4-flash"), 1);
  assert.equal(__test.requestUnits("/api/bible", "deepseek-v4-flash"), 1);
  assert.equal(__test.requestUnits("/api/meme-lab", "deepseek-v4-flash"), 1);
  assert.equal(__test.requestUnits("/api/generate", "deepseek-v4-pro"), 6);
  const first = await __test.reserveDailyBudget(env, "/api/generate", "deepseek-v4-pro");
  assert.equal(first.usedUnits, 6);
  await assert.rejects(
    __test.reserveDailyBudget(env, "/api/generate", "deepseek-v4-pro"),
    (error) => error.code === "DAILY_BUDGET_EXCEEDED",
  );
  assert.equal(__test.usageDay(new Date("2026-07-13T16:30:00.000Z")), "2026-07-14");
});

test("API client stores an access code and retries only after a 401 challenge", async () => {
  const stored = new Map();
  const calls = [];
  const client = apiClientModule.create({
    timeoutMs: 1000,
    storage: { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    promptForAccess: () => "private-code",
    fetchImpl: async (_path, options) => {
      calls.push(options);
      return calls.length === 1
        ? new Response(JSON.stringify({ ok: false, code: "ACCESS_CODE_REQUIRED", error: "请输入访问码" }), { status: 401 })
        : new Response(JSON.stringify({ ok: true, value: 1 }), { status: 200 });
    },
  });
  const response = await client.request("/api/status");
  assert.equal(response.value, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers["X-Roco-Access-Code"], "private-code");
});

test("API client aborts requests after the configured timeout", async () => {
  const client = apiClientModule.create({
    timeoutMs: 5,
    storage: { getItem: () => null },
    fetchImpl: async (_path, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
  });
  await assert.rejects(client.request("/api/status"), (error) => error.code === "REQUEST_TIMEOUT");
});

test("local DeepSeek development delegates API routes to the production worker", async () => {
  const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
  assert.match(source, /handleSharedDeepSeekApi/);
  assert.match(source, /import\("\.\/cloudflare\/worker\.mjs"\)/);
  assert.match(source, /url\.pathname\.startsWith\("\/api\/"\)/);
});

test("data store migrates legacy JSON and preserves a localStorage fallback", async () => {
  const values = new Map([["projects", JSON.stringify([{ id: "legacy-project" }])]]);
  const fallbackStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const store = dataStoreModule.create({ indexedDb: null, fallbackStorage });
  assert.deepEqual(await store.get("projects"), [{ id: "legacy-project" }]);
  assert.equal(await store.set("draft", { currentProjectId: "legacy-project" }), "localStorage");
  assert.deepEqual(JSON.parse(values.get("draft")), { currentProjectId: "legacy-project" });
});

test("project domain appends versions without overwriting an episode", () => {
  const project = projectDomain.createProjectRecord("版本测试", { worldRules: "规则" });
  assert.deepEqual(project.planBatches, []);
  const first = projectDomain.upsertEpisodeVersion(project, {
    mode: "new",
    input: { episodeNumber: 1, theme: "第一版" },
    versionSnapshot: { script: { title: "第一版" }, historyId: "history-1" },
  });
  const second = projectDomain.upsertEpisodeVersion(project, {
    currentEpisodeId: first.episode.id,
    mode: "new",
    input: { episodeNumber: 1, theme: "第二版" },
    versionSnapshot: { script: { title: "第二版" }, historyId: "history-2" },
  });
  assert.equal(project.episodes.length, 1);
  assert.equal(second.episode.versions.length, 2);
  assert.equal(second.episode.script.title, "第二版");
  projectDomain.applyEpisodeVersion(second.episode, first.version.id);
  assert.equal(second.episode.script.title, "第一版");
});

test("storyboard versions stay attached to one script version and can be restored", () => {
  const project = projectDomain.createProjectRecord("分镜留痕");
  const { episode, version } = projectDomain.upsertEpisodeVersion(project, {
    mode: "new",
    input: { episodeNumber: 1 },
    versionSnapshot: { script: { title: "当前剧本" } },
  });
  const first = projectDomain.updateActiveStoryboard(episode, [{ shot: 1, segmentGoal: "第一版" }], { model: "flash" });
  const second = projectDomain.updateActiveStoryboard(episode, [{ shot: 1, segmentGoal: "第二版" }], { model: "pro" });
  assert.equal(projectDomain.activeEpisodeVersion(episode).storyboardVersions.length, 2);
  assert.equal(first.scriptVersionId, version.id);
  assert.equal(second.scriptVersionId, version.id);
  projectDomain.applyStoryboardVersion(episode, first.id);
  assert.equal(episode.storyboard[0].segmentGoal, "第一版");
  assert.equal(episode.activeStoryboardVersionId, first.id);
});

test("project domain validates episode plans and preserves review thresholds", () => {
  assert.throws(
    () => projectDomain.validateEpisodePlan({ episodePlan: { openingHook: "异常" } }),
    /核心冲突.*反转信息.*结尾悬念.*目标情绪/,
  );
  const insights = projectDomain.deriveReviewInsights({ views: 10000, completionRate: 20, likes: 500, comments: 20, shares: 10 });
  assert.match(insights.hook, /前 3 秒取消铺垫/);
  assert.equal(insights.interactionRate, 5.3);
});

test("UI templates escape model content and keep production controls", () => {
  const scriptHtml = uiTemplates.script({
    synopsis: "<img src=x onerror=alert(1)>",
    tags: ["<script>"],
    characters: [], structure: [], dialogue: [], rhythm: [], reversals: [],
    innovationPoints: ["道具会说反话"], comedyBeats: [{ setup: "铺垫", payoff: "回扣", visualAction: "道具翻面" }],
    visualHighlights: [{ moment: "爆点", verticalComposition: "前中后景", effect: "反色" }], hooks: [],
  });
  assert.doesNotMatch(scriptHtml, /<img|<script>/);
  assert.match(scriptHtml, /&lt;img/);
  assert.match(scriptHtml, /创新机制/);
  assert.match(scriptHtml, /笑点设计/);
  assert.match(scriptHtml, /视觉爆点/);

  const storyboardHtml = uiTemplates.storyboard([{ shot: 1, timeRange: "00-10秒", seconds: 10, segmentGoal: "抛出异常", beatBreakdown: [{ range: "0-3秒", content: "徽章裂开" }], assetStatus: "待制作" }], true);
  assert.match(storyboardHtml, /data-shot-field="assetLinks"/);
  assert.match(storyboardHtml, /option value="待制作" selected/);
  assert.match(storyboardHtml, /第 1 段/);
  assert.match(storyboardHtml, /徽章裂开/);
  assert.match(storyboardHtml, /data-copy-storyboard-segment="0"/);
});

test("page loads domain and template modules before app.js", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const domainIndex = html.indexOf("project-domain.js");
  const plannerIndex = html.indexOf("episode-planner.js");
  const templatesIndex = html.indexOf("ui-templates.js");
  const appIndex = html.indexOf("app.js");
  assert.ok(domainIndex > 0 && plannerIndex > domainIndex && templatesIndex > plannerIndex && appIndex > templatesIndex);
});
