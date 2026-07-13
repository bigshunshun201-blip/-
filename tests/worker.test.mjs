import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { __test } from "../cloudflare/worker.mjs";

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
    }],
  });
  assert.equal(result.storyboard[0].assetStatus, "待制作");
  assert.equal(result.storyboard[0].assetLinks, "迪莫雨夜立绘");
  assert.equal(result.storyboard[0].characters, "阿洛、迪莫");
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

test("UI contains the production workflow controls", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["planOpeningHook", "checkContinuityBtn", "assetLibrary", "reviewCommentThemes", "exportProjectBtn"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
