import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { __test } from "../cloudflare/worker.mjs";

const require = createRequire(import.meta.url);
const workflow = require("../workflow-core.js");
const apiClientModule = require("../api-client.js");
const dataStoreModule = require("../data-store.js");
const archiveSyncModule = require("../archive-sync.js");
const appStateModule = require("../app-state.js");
const aiOperationModule = require("../ai-operation.js");
const generationClientModule = require("../generation-client.js");
const projectDomain = require("../project-domain.js");
const episodePlanner = require("../episode-planner.js");
const uiTemplates = require("../ui-templates.js");

test("storyboard normalizer retains production fields", () => {
  const result = __test.normalizeStoryboard({
    storyboard: [{
      shot: 1,
      seconds: 3,
      segmentGoal: "抛出契约异常",
      continuityIn: "阿洛在画面左侧，迪莫在右侧，契约完整",
      continuityOut: "阿洛仍在左侧，迪莫后退，契约出现裂纹",
      beatBreakdown: [{ range: "0-3秒", content: "契约发光后裂开" }],
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
      segmentGoal: "让阿洛获得线索",
      continuityIn: "阿洛在左侧接住从契约掉落的徽章",
      continuityOut: "阿洛举起徽章看向画外，迪莫仍在右后方",
      beatBreakdown: [{ range: "0-4秒", content: "徽章落下，阿洛接住" }, { range: "4-7秒", content: "阿洛发现背面坐标" }],
      characters: "阿洛",
      scene: "月牙镇",
      visual: "阿洛接住徽章",
      action: "抬头",
      line: "坐标为什么指向聆风塔？",
      scale: "中近景",
      movement: "跟随徽章下落后上摇",
      sound: "金属落手声，低频悬念音",
      subtitle: "坐标指向聆风塔",
      visualPrompt: "9:16月牙镇单场景连续镜头，前景徽章，中景阿洛接住后抬头，背景迪莫，字幕安全区留空",
      assetStatus: "已有",
    }],
  }, 15);
  assert.equal(result.storyboard[0].assetStatus, "待制作");
  assert.equal(result.storyboard[0].assetLinks, "迪莫雨夜立绘");
  assert.equal(result.storyboard[0].characters, "阿洛、迪莫");
  assert.equal(result.storyboard[0].seconds, 8);
  assert.equal(result.storyboard[0].generationSeconds, 8);
  assert.equal(result.storyboard[1].seconds, 7);
  assert.equal(result.storyboard[1].timeRange, "08-15秒");
  assert.equal(result.storyboard[1].generationMode, "单场景连续镜头");
  assert.equal(result.storyboard[0].clipId, "CLIP-01");
});

test("storyboard segment planner adapts duration and marks fixed-mode trimming", () => {
  const sixty = __test.storyboardSegmentPlan(60, "smart");
  assert.equal(sixty.targetSeconds, 8);
  assert.equal(sixty.segments.length, 8);
  assert.deepEqual(sixty.segments.map((segment) => segment.seconds), [8, 8, 8, 8, 7, 7, 7, 7]);
  const seventyFive = __test.storyboardSegmentPlan(75, "smart");
  assert.equal(seventyFive.targetSeconds, 8);
  assert.deepEqual(seventyFive.segments.map((segment) => segment.seconds), [8, 8, 8, 8, 8, 7, 7, 7, 7, 7]);
  const fixedEight = __test.storyboardSegmentPlan(75, "8");
  assert.equal(fixedEight.segments.at(-1).seconds, 3);
  assert.equal(fixedEight.segments.at(-1).generationSeconds, 8);
  assert.equal(fixedEight.segments.at(-1).trimSeconds, 5);
  for (const mode of ["smart", "5", "8", "10"]) {
    for (let duration = 15; duration <= 180; duration += 7) {
      const plan = __test.storyboardSegmentPlan(duration, mode);
      assert.equal(plan.segments.reduce((sum, segment) => sum + segment.seconds, 0), duration);
      assert.equal(plan.segments[0].start, 0);
      assert.equal(plan.segments.at(-1).end, duration);
      if (mode === "smart") assert.ok(plan.segments.every((segment) => segment.seconds >= 4));
    }
  }
});

test("script normalizer rejects incomplete output and missing requested roles", () => {
  const valid = {
    script: {
      title: "契约裂开的第八秒",
      synopsis: "阿洛在月牙镇发现迪莫的契约突然裂开，追查时却发现裂纹会回应谎言。两人必须在巡逻队赶到前找出真相，结尾坐标却指向被封锁的聆风塔。",
      characters: [{ name: "阿洛", description: "嘴硬但不放弃伙伴" }, { name: "迪莫", description: "谨慎且会主动质疑命令" }],
      structure: Array.from({ length: 5 }, (_, index) => ({ beat: `节拍${index + 1}`, content: `推进剧情${index + 1}` })),
      dialogue: Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? "迪莫" : "阿洛", line: `有效短台词${index + 1}` })),
      rhythm: ["惊讶 -> 紧张 -> 悬疑"], reversals: ["裂纹回应的是谎言"],
      innovationPoints: ["契约裂纹充当测谎机关", "徽章坐标反向指路"],
      comedyBeats: [{ setup: "阿洛嘴硬", payoff: "契约立刻裂开", visualAction: "裂纹追着阿洛移动" }, { setup: "迪莫装镇定", payoff: "尾巴先躲开", visualAction: "尾巴缩到路牌后" }],
      visualHighlights: Array.from({ length: 3 }, (_, index) => ({ moment: `画面${index + 1}`, verticalComposition: "前中后景分层", effect: "明暗反转" })),
      hooks: ["坐标指向聆风塔"], tags: ["洛克王国世界", "短剧"],
    },
  };
  assert.equal(__test.normalizeScript(valid, { roles: "阿洛：调查者；迪莫：搭档" }).script.dialogue.length, 6);
  assert.equal(__test.normalizeScript(valid, { roles: "阿洛：调查者；反差：越怕越逞强；底线：不牺牲伙伴\n迪莫：搭档；动作习惯：紧张时后退" }).script.characters.length, 2);
  const integrated = structuredClone(valid);
  integrated.script.structure.forEach((item, index) => { item.beatIds = index < 4 ? [`BEAT-0${index + 1}`] : ["BEAT-05", "BEAT-06", "BEAT-07", "BEAT-08"]; });
  integrated.script.assetIntegration = {
    characters: [{ assetId: "char-1", name: "阿洛", storyFunction: "主动调查裂纹", choice: "公开错误或失去搭档" }],
    memes: [{ assetId: "meme-1", name: "嘴硬检测", triggerRole: "阿洛", setup: "阿洛装镇定", payoff: "徽章播报真话", plotEffect: "迫使阿洛承认错误" }],
  };
  const integratedInput = {
    roles: "阿洛：调查者；迪莫：搭档", beatSheet: Array.from({ length: 8 }, (_, index) => ({ id: `BEAT-0${index + 1}` })),
    activeCharacterIds: ["char-1"], projectCharacterCards: [{ id: "char-1", name: "阿洛" }],
    activeMemeIds: ["meme-1"], projectMemes: [{ id: "meme-1", phrase: "嘴硬检测" }],
  };
  const normalizedIntegrated = __test.normalizeScript(integrated, integratedInput).script;
  assert.equal(normalizedIntegrated.assetIntegration.memes[0].triggerRole, "阿洛");
  assert.equal(normalizedIntegrated.dialogue[0].id, "LINE-01");
  assert.ok(normalizedIntegrated.dialogue.every((line) => line.beatIds.length));
  assert.throws(() => __test.normalizeScript({ script: { ...integrated.script, assetIntegration: { characters: [], memes: [] } } }, integratedInput), /已选角色卡/);
  assert.throws(() => __test.normalizeScript({ script: { title: "空壳" } }), (error) => error.code === "AI_OUTPUT_INVALID");
  assert.throws(() => __test.normalizeScript(valid, { roles: "阿洛：调查者；雪影娃娃：搭档" }), /雪影娃娃/);
});

test("generation input only accepts explicitly selected library assets", () => {
  const normalized = __test.normalizeInput({
    activeMemeIds: ["meme-2"], activeCharacterIds: ["character-1"],
    projectMemes: [{ id: "meme-1", phrase: "候选" }, { id: "meme-2", phrase: "本集使用" }],
    projectCharacterCards: [{ id: "character-1", name: "阿洛" }, { id: "character-2", name: "迪莫" }],
  });
  assert.deepEqual(normalized.projectMemes.map((item) => item.id), ["meme-2"]);
  assert.deepEqual(normalized.projectCharacterCards.map((item) => item.id), ["character-1"]);
  assert.deepEqual(__test.normalizeInput({ projectMemes: [{ id: "meme-1" }] }).projectMemes, []);
});

test("continuity normalizer always returns the five required checks", () => {
  const result = __test.normalizeContinuity({
    score: 86,
    summary: "主线承接正常",
    checks: [{ area: "角色性格", status: "pass", evidence: "阿洛仍然嘴硬", fix: "无需调整" }],
  });
  assert.equal(result.score, 86);
  assert.deepEqual(result.checks.map((check) => check.area), ["角色性格", "角色标志性特征", "精灵能力", "人物关系", "悬念承接"]);
});

test("series ledger normalizer keeps actionable cross-episode facts", () => {
  const result = __test.normalizeSeriesLedger({ ledger: {
    openQuestions: [{ id: "Q-01", question: "徽章为何指向聆风塔", originEpisode: 1, nextAction: "第2集查坐标" }],
    characterStates: [{ name: "阿洛", currentGoal: "查坐标", knownFacts: "契约会测谎", hiddenFacts: "隐瞒第一次失败", relationshipState: "与迪莫互疑", lastChange: "承认说谎" }],
    abilityStates: [], propStates: [], antagonistProgress: "", recurringGags: [], resolvedQuestions: [],
    nextObligations: ["第2集前3秒承接徽章坐标"],
  } });
  assert.equal(result.ledger.openQuestions[0].id, "Q-01");
  assert.match(result.ledger.nextObligations[0], /第2集/);
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

test("character card normalizer keeps repeatable character signatures", () => {
  const result = __test.normalizeCharacterCard({ card: {
    name: "洛小岚", role: "遗迹向导", traits: "越慌越装专业", contrast: "怕黑却专接夜间任务",
    desire: "找到失踪的探索记录", weakness: "逞强时会忽略退路", catchphrases: ["问题不大", "我是在尊重未知"],
    mannerism: "撒谎时把徽章转半圈", comedyTrigger: "越维护专业形象，道具越拆台", boundary: "不牺牲精灵伙伴",
  } });
  assert.equal(result.card.name, "洛小岚");
  assert.equal(result.card.catchphrases.length, 2);
  assert.match(result.card.comedyTrigger, /道具/);
  assert.throws(() => __test.normalizeCharacterCard({ card: { name: "空角色" } }), /不完整/);
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
        protagonistGoal: `目标${index + 1}`,
        stakes: `代价${index + 1}`,
        forcedChoice: `选择${index + 1}`,
        reversal: `反转${index + 1}`,
        relationshipShift: `关系变化${index + 1}`,
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

test("creative mix normalizer only accepts candidate character and meme ids", () => {
  const input = {
    candidateCharacterCards: [{ id: "char-1", name: "阿洛" }, { id: "char-2", name: "迪莫" }],
    candidateMemes: [{ id: "meme-1", phrase: "已读乱回" }],
  };
  const mixes = Array.from({ length: 3 }, (_, index) => ({
    angle: `角度${index + 1}`, title: `搭配${index + 1}`, characterIds: ["char-1", "char-2"], memeIds: ["meme-1"],
    relationshipCollision: "阿洛想逞强，迪莫坚持先验证规则",
    memeMechanism: "迪莫把错误回复变成任务指令，随后用同一动作回扣",
    plotEngine: "每次嘴硬都会生成一条更难撤销的错误任务",
    openingImage: "阿洛头顶弹出一排错误任务指令",
    planPatch: { protagonistGoal: "撤销错误任务", stakes: "搭档会被系统带走", forcedChoice: "认错或失去线索", relationshipShift: "从互相拆台到共同担责" },
  }));
  const result = __test.normalizeCreativeMixes({ mixes }, input);
  assert.equal(result.mixes.length, 3);
  assert.deepEqual(result.mixes[0].characterIds, ["char-1", "char-2"]);
  assert.throws(() => __test.normalizeCreativeMixes({ mixes: mixes.map((item) => ({ ...item, characterIds: ["char-1", "unknown"] })) }, input), /3套完整搭配/);
});

test("beat sheet normalizer requires eight causal production beats", () => {
  const beats = Array.from({ length: 8 }, (_, index) => ({
    id: `BEAT-${String(index + 1).padStart(2, "0")}`,
    timeRange: `${index * 8}-${(index + 1) * 8}秒`, dramaticTask: `任务${index + 1}`,
    characterGoal: `目标${index + 1}`, action: `动作${index + 1}`, newInformation: `信息${index + 1}`,
    emotion: `情绪${index + 1}`, causalLink: `因为上一拍，所以进入第${index + 1}拍`, assetIds: ["char-1"],
  }));
  const input = { activeCharacterIds: ["char-1"], projectCharacterCards: [{ id: "char-1", name: "阿洛" }] };
  const result = __test.normalizeBeatSheet({ beats }, input);
  assert.equal(result.beats.length, 8);
  assert.equal(result.beats[7].id, "BEAT-08");
  assert.throws(() => __test.normalizeBeatSheet({ beats: beats.slice(0, 7) }, input), /8个剧情节拍/);
});

test("UI contains the production workflow controls", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["clipMode", "creativeMixBrief", "characterPicker", "memePicker", "suggestCreativeMixBtn", "creativeMixHistoryList", "planOpeningHook", "planProtagonistGoal", "planStakes", "planForcedChoice", "planRelationshipShift", "autoPlanBtn", "suggestPlansBtn", "planSuggestions", "planHistoryList", "generateBeatSheetBtn", "beatSheetList", "approveBeatSheetBtn", "beatSheetHistoryList", "planReadyState", "memeLabBtn", "memeInspireBtn", "memeLabResults", "memeLibrary", "addMemeBtn", "generateBibleBtn", "applyBibleTemplateBtn", "generateCharacterBtn", "saveCharacterBtn", "characterLibrary", "storyboardHistory", "checkContinuityBtn", "assetLibrary", "reviewCommentThemes", "exportProjectBtn", "updateSeriesLedgerBtn", "runScriptDoctorBtn", "addCanonSourceBtn", "characterSpeechPattern", "backupCloudNowBtn", "cloudArchiveVersions", "copyWorkspaceKeyBtn", "connectWorkspaceKeyBtn"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /open\.douyin\.com\/platform\/resource\/docs\/openapi\/data-open-service\/tops-data\/hot-video-list/);
  assert.match(html, /data-ai-model-switch/);
  for (const scope of ["meme", "mix", "plan", "beat", "script", "storyboard", "bible", "character", "continuity", "topics", "ledger", "doctor"]) {
    assert.match(html, new RegExp(`data-ai-model-scope="${scope}"`));
  }
});

test("JSON extraction repairs common missing commas from model output", () => {
  const betweenObjects = __test.extractJson('{"storyboard":[{"shot":1} {"shot":2}]}');
  assert.deepEqual(betweenObjects.storyboard.map((shot) => shot.shot), [1, 2]);
  const betweenProperties = __test.extractJson('{"shots":[1,2] "title":"分镜"}');
  assert.equal(betweenProperties.title, "分镜");
  const truncated = __test.extractJson('{"script":{"title":"未闭合剧本","hooks":["下一集见"');
  assert.equal(truncated.script.title, "未闭合剧本");
  assert.deepEqual(truncated.script.hooks, ["下一集见"]);
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

test("series ledger input compacts long episodes below the request budget", () => {
  const episodes = Array.from({ length: 30 }, (_, index) => ({
    episodeNumber: index + 1,
    updatedAt: `2026-07-${String(index + 1).padStart(2, "0")}`,
    script: {
      title: `第${index + 1}集`,
      synopsis: "很长的剧情".repeat(300),
      structure: Array.from({ length: 8 }, (_, beat) => ({ beat: `节拍${beat + 1}`, content: "推进内容".repeat(100) })),
      dialogue: Array.from({ length: 20 }, (_, line) => ({ id: `LINE-${line + 1}`, role: "阿洛", line: "很长的台词".repeat(100) })),
      hooks: ["结尾悬念".repeat(100)],
    },
  }));
  const batch = workflow.ledgerEpisodeBatch(episodes, 30);
  assert.equal(batch.length, 30);
  assert.ok(JSON.stringify(batch).length < 80_000);
  assert.equal(batch[0].dialogueSignals.length, 3);
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
  assert.match(source, /apiTimeoutMs = 210_000/);
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

test("script generation stays gated until the episode plan and beat sheet are approved", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(html, /id="generateBtn" disabled>先完成本集策划/);
  assert.ok(html.indexOf("id=\"generateBtn\"") > html.indexOf("id=\"planTargetEmotion\""));
  assert.match(source, /episodePlanner\.planIsComplete\(getInput\(\)\.episodePlan\)/);
  assert.match(source, /generateButton\.disabled = isBusy \|\| !hasCompletePlan \|\| !hasApprovedBeatSheet/);
  assert.match(source, /state\.beatSheetApproved && state\.beatSheet\.length === 8/);
});

test("daily budget weights Pro requests and blocks requests over the limit", async () => {
  const env = { DAILY_AI_UNIT_LIMIT: "10" };
  assert.equal(__test.requestUnits("/api/script", "deepseek-v4-flash"), 1);
  assert.equal(__test.requestUnits("/api/plans", "deepseek-v4-flash"), 1);
  assert.equal(__test.requestUnits("/api/bible", "deepseek-v4-flash"), 1);
  assert.equal(__test.requestUnits("/api/meme-lab", "deepseek-v4-flash"), 1);
  assert.equal(__test.requestUnits("/api/character-card", "deepseek-v4-pro"), 3);
  assert.equal(__test.requestUnits("/api/generate", "deepseek-v4-pro"), 6);
  const first = await __test.reserveDailyBudget(env, "/api/generate", "deepseek-v4-pro");
  assert.equal(first.usedUnits, 6);
  await assert.rejects(
    __test.reserveDailyBudget(env, "/api/generate", "deepseek-v4-pro"),
    (error) => error.code === "DAILY_BUDGET_EXCEEDED",
  );
  assert.equal(__test.providerCallUnits("deepseek-v4-flash"), 1);
  assert.equal(__test.providerCallUnits("deepseek-v4-pro"), 3);
  const released = await __test.releaseDailyBudget(env, first);
  assert.equal(released.usedUnits, 0);
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
  const mutable = { title: "写入时版本" };
  const write = store.set("snapshot", mutable);
  mutable.title = "写入后被修改";
  await write;
  assert.deepEqual(JSON.parse(values.get("snapshot")), { title: "写入时版本" });
});

test("archive sync migrates legacy arrays and blocks stale tab overwrites", async () => {
  let stored = [{ id: "legacy-project" }];
  const store = { get: async () => structuredClone(stored), set: async (_key, value) => { stored = structuredClone(value); } };
  const storageValues = new Map();
  const storage = { getItem: (key) => storageValues.get(key) || null, setItem: (key, value) => storageValues.set(key, value) };
  const first = archiveSyncModule.create({ store, storage, projectsKey: "projects" });
  const second = archiveSyncModule.create({ store, storage, projectsKey: "projects" });
  assert.deepEqual((await first.load()).projects, [{ id: "legacy-project" }]);
  await second.load();
  const saved = await first.save([{ id: "project-a" }], { cloud: false });
  assert.equal(saved.revision, 1);
  await assert.rejects(second.save([{ id: "project-b" }], { cloud: false }), (error) => error.code === "LOCAL_VERSION_CONFLICT");
  first.dispose();
  second.dispose();
});

test("AI operation coordinator rejects results after input changes", () => {
  const state = appStateModule.createState();
  state.currentProjectId = "project-1";
  let token = "input-a";
  const coordinator = aiOperationModule.create({
    state,
    newId: () => "operation-1",
    getProjectId: () => state.currentProjectId,
    getContextToken: () => token,
  });
  const operation = coordinator.begin("剧本生成");
  assert.equal(state.activeAiOperation.id, "operation-1");
  token = "input-b";
  assert.throws(() => coordinator.assertActive(operation), (error) => error.code === "STALE_AI_RESULT");
  coordinator.end(operation);
  assert.equal(state.activeAiOperation, null);
});

test("app state initializes independent model preferences", () => {
  const state = appStateModule.createState();
  state.aiModels.plan = "deepseek-v4-pro";
  assert.equal(state.aiModels.script, "deepseek-v4-flash");
  assert.equal(appStateModule.aiModelScopes.length, 12);
});

test("generation client resolves asynchronous provider jobs", async () => {
  const calls = [];
  const client = generationClientModule.create({
    apiClient: { request: async (path) => {
      calls.push(path);
      return calls.length === 1 ? { status: "pending" } : { status: "done", result: { title: "完成" }, model: "flash" };
    } },
    sleep: async () => {},
  });
  const result = await client.resolveJob({ async: true, jobId: "job-1", source: "deepseek" }, "剧本");
  assert.equal(result.result.title, "完成");
  assert.equal(calls.length, 2);
});

test("project schema migrates legacy episode inputs and rejects future versions", () => {
  const legacy = projectDomain.migrateProjectRecord({
    id: "legacy", name: "旧项目", episodes: [{ episodeNumber: 1, input: { theme: "旧主题" }, script: { title: "旧剧本" } }],
  });
  assert.equal(legacy.schemaVersion, projectDomain.PROJECT_SCHEMA_VERSION);
  assert.deepEqual(legacy.episodes[0].input.activeMemeIds, []);
  assert.deepEqual(legacy.episodes[0].input.activeCharacterIds, []);
  assert.deepEqual(legacy.creativeMixBatches, []);
  assert.deepEqual(legacy.beatSheetBatches, []);
  assert.deepEqual(legacy.seriesLedger.nextObligations, []);
  assert.deepEqual(legacy.canonSources, []);
  assert.throws(() => projectDomain.migrateProjectRecord({ schemaVersion: projectDomain.PROJECT_SCHEMA_VERSION + 1 }), /高于当前支持版本/);
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

test("episode versions preserve a complete script doctor result", () => {
  const project = projectDomain.createProjectRecord("医生留档");
  const doctorResult = { report: { score: 80 }, revisedScript: { title: "修订稿" }, createdAt: "2026-07-14" };
  const { episode, version } = projectDomain.upsertEpisodeVersion(project, {
    mode: "new",
    input: { episodeNumber: 1 },
    versionSnapshot: { script: { title: "原稿" }, doctorResult },
  });
  assert.equal(version.doctorResult.revisedScript.title, "修订稿");
  projectDomain.applyEpisodeVersion(episode, version.id);
  assert.equal(episode.doctorResult.report.score, 80);
});

test("import rekeying preserves content asset references and isolates archive ids", () => {
  const project = projectDomain.createProjectRecord("导入测试");
  project.characterCards = [{ id: "character-1", name: "阿洛" }];
  project.memes = [{ id: "meme-1", phrase: "嘴硬检测" }];
  const { episode, version } = projectDomain.upsertEpisodeVersion(project, {
    mode: "new",
    input: {
      episodeNumber: 1,
      activeCharacterIds: ["character-1"],
      activeMemeIds: ["meme-1"],
      beatSheet: [{ id: "BEAT-01", assetIds: ["character-1", "meme-1"] }],
    },
    versionSnapshot: { script: { title: "原剧本" }, historyId: "history-original" },
  });
  const oldProjectId = project.id;
  const oldEpisodeId = episode.id;
  const oldVersionId = version.id;
  projectDomain.rekeyImportedProject(project);
  assert.notEqual(project.id, oldProjectId);
  assert.notEqual(project.episodes[0].id, oldEpisodeId);
  assert.notEqual(project.episodes[0].versions[0].id, oldVersionId);
  assert.equal(project.episodes[0].versions[0].historyId, null);
  assert.deepEqual(project.episodes[0].input.activeCharacterIds, ["character-1"]);
  assert.deepEqual(project.episodes[0].input.activeMemeIds, ["meme-1"]);
  assert.deepEqual(project.episodes[0].input.beatSheet[0].assetIds, ["character-1", "meme-1"]);
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

  const storyboardHtml = uiTemplates.storyboard([{ shot: 1, timeRange: "00-08秒", seconds: 8, generationSeconds: 8, segmentGoal: "抛出异常", beatBreakdown: [{ range: "0-3秒", content: "徽章裂开" }], assetStatus: "待制作" }], true);
  assert.match(storyboardHtml, /data-shot-field="assetLinks"/);
  assert.match(storyboardHtml, /option value="待制作" selected/);
  assert.match(storyboardHtml, /第 1 段/);
  assert.match(storyboardHtml, /徽章裂开/);
  assert.match(storyboardHtml, /data-copy-storyboard-segment="0"/);
  assert.match(storyboardHtml, /生成 8 秒/);
});

test("page loads domain and template modules before app.js", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const domainIndex = html.indexOf("project-domain.js");
  const plannerIndex = html.indexOf("episode-planner.js");
  const templatesIndex = html.indexOf("ui-templates.js");
  const archiveIndex = html.indexOf("archive-sync.js");
  const stateIndex = html.indexOf("app-state.js");
  const operationIndex = html.indexOf("ai-operation.js");
  const generationIndex = html.indexOf("generation-client.js");
  const appIndex = html.indexOf("app.js");
  assert.ok(domainIndex > 0 && plannerIndex > domainIndex && templatesIndex > plannerIndex && archiveIndex > templatesIndex && stateIndex > archiveIndex && operationIndex > stateIndex && generationIndex > operationIndex && appIndex > generationIndex);
});
