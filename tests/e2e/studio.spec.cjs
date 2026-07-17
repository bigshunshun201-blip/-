const { test, expect } = require("@playwright/test");
const projectDomain = require("../../project-domain.js");

function fixture() {
  const bible = {
    characters: "菲尔特谨慎但会保护伙伴；喵喵嘴硬心软。",
    abilities: "喵喵只能短暂感知徽章回声，使用后会疲惫。",
    relations: "两人已经建立初步信任。",
    antagonist: "暗影博士试图夺回旧徽章。",
    worldRules: "月牙镇的旧徽章会记录契约回声。",
    mainConflict: "菲尔特必须在真相和保护伙伴之间选择。",
    hookRules: "首段展示徽章异变，结尾留下可执行追查目标。",
  };
  const project = projectDomain.createProjectRecord("桌面端回归项目", bible);
  const script = {
    title: "旧徽章的双生主",
    synopsis: "菲尔特与喵喵发现旧徽章显示第二个主人，必须在暗影博士夺走徽章前确认契约真相。",
    characters: [{ name: "菲尔特", description: "学院新生" }, { name: "喵喵", description: "嘴硬心软的搭档" }],
    structure: [{ beat: "异常", beatIds: ["BEAT-01"], content: "徽章显示第二个名字" }],
    dialogue: [{ id: "LINE-01", beatIds: ["BEAT-01"], role: "菲尔特", line: "它为什么写着另一个主人？" }],
    rhythm: ["疑惑到紧张"], reversals: ["徽章主动回应"], innovationPoints: ["契约回声可视化"],
    comedyBeats: [], visualHighlights: [], assetIntegration: { characters: [], memes: [] }, canonDeltas: [], hooks: ["徽章指向地下入口"], tags: ["洛克王国世界"],
  };
  const input = { episodeNumber: 1, theme: "旧徽章异变", roles: "菲尔特、喵喵", scene: "月牙镇", duration: 15, clipMode: "smart", episodePlan: {} };
  const { episode, version } = projectDomain.upsertEpisodeVersion(project, {
    input,
    versionSnapshot: {
      input, script, generationBibleSnapshot: bible, episodeBibleSnapshot: bible,
      approvalStatus: "approved", approvalReview: { status: "legacy", checkedAt: new Date().toISOString(), summary: "E2E 固定夹具" },
    },
  });
  projectDomain.updateActiveStoryboard(episode, [{
    clipId: "CLIP-01", shot: 1, beatIds: ["BEAT-01"], dialogueIds: ["LINE-01"], timeRange: "00-08秒",
    seconds: 8, generationSeconds: 8, trimSeconds: 0, generationMode: "单场景连续镜头",
    segmentGoal: "展示徽章异常", continuityIn: "菲尔特左侧，喵喵右侧，徽章完整", continuityOut: "徽章出现裂纹",
    beatBreakdown: [{ range: "0-3秒", content: "徽章亮起" }, { range: "3-8秒", content: "第二个名字浮现" }],
    visual: "旧徽章在两人之间亮起", characters: "菲尔特、喵喵", scene: "月牙镇钟楼",
    action: "菲尔特抬起徽章，喵喵后退半步", line: "它为什么写着另一个主人？", scale: "中近景",
    movement: "缓慢推镜", sound: "金属共鸣", subtitle: "另一个主人？", visualPrompt: "9:16 单场景连续镜头",
    assetLinks: "", assetNote: "", assetStatus: "待制作",
  }], { source: "fixture", model: "fixture" });
  return {
    projects: { formatVersion: 1, revision: 1, writerId: "e2e", updatedAt: new Date().toISOString(), projects: [project] },
    draft: { currentProjectId: project.id, currentEpisodeId: episode.id, input, creationMode: "new", currentHistoryId: version.historyId || null },
  };
}

function emptyFixture() {
  const project = projectDomain.createProjectRecord("快速向导空项目");
  return {
    projects: { formatVersion: 1, revision: 1, writerId: "e2e-empty", updatedAt: new Date().toISOString(), projects: [project] },
    draft: {
      currentProjectId: project.id,
      currentEpisodeId: null,
      creationMode: "new",
      interfaceMode: "quick",
      quickFlow: { step: "idea", packageTab: "beats" },
      input: { theme: "", roles: "菲尔特：谨慎的新手洛克", scene: "月牙镇", direction: "轻喜剧整活", audience: "学生党与游戏短剧用户", duration: 60, episodeCount: 3, episodeNumber: 1, style: "搞笑、快节奏、反差梗", episodePlan: {} },
      topics: [{ title: "喵喵把月牙镇整成邪修实验室", sellingPoint: "草系精灵反差整活", audience: "年轻游戏用户", roles: "菲尔特、喵喵", world: "月牙镇", emotion: "爆笑", reversal: "邪修配方其实是治愈魔法", memeLine: "先别内耗", duration: 60, series: true, priority: "S" }],
    },
  };
}

test("quick guide locks future steps and topic selection only fills the opening idea", async ({ page }) => {
  const seeded = emptyFixture();
  await page.addInitScript((value) => {
    Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
    localStorage.setItem("roco-shortdrama-studio-projects", JSON.stringify(value.projects));
    localStorage.setItem("roco-shortdrama-studio-draft", JSON.stringify(value.draft));
    localStorage.removeItem("roco-shortdrama-access-code");
  }, seeded);
  await page.goto("/");

  const planStep = page.locator('#quickStepRail [data-quick-step="plan"]');
  await expect(planStep).toHaveAttribute("data-state", "locked");
  await planStep.click();
  await expect(page.locator("body")).toHaveAttribute("data-quick-step", "idea");
  await expect(page.locator("#quickInlineNotice")).toContainText("先生成 3 个创意方向");
  await expect(page.locator("#quickPrimaryAction")).toBeDisabled();

  await page.locator('#quickStageContent [data-quick-drawer="topics"]').click();
  await expect(page.locator("#quickDrawerLayer")).toBeVisible();
  await expect(page.locator("#quickDrawerTitle")).toHaveCSS("color", "rgb(20, 33, 25)");
  await expect(page.locator(".quick-topic-drawer article").first()).toHaveCSS("color", "rgb(20, 33, 25)");
  await expect(page.locator(".quick-topic-drawer article p").first()).toHaveCSS("color", "rgb(70, 88, 78)");
  await page.locator('[data-quick-topic-select="0"]').click();
  await expect(page.locator("#quickDrawerLayer")).toBeHidden();
  await expect(page.locator("#quickIdeaInput")).toHaveValue("喵喵把月牙镇整成邪修实验室");
  await expect(page.locator("body")).toHaveAttribute("data-quick-step", "idea");
  await expect(page.locator("#quickPrimaryAction")).toBeEnabled();
  await expect(page.locator(".quick-primary-action:visible")).toHaveCount(1);
});

test("desktop production workspace is stable and model scopes remain independent", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const seeded = fixture();
  await page.addInitScript((value) => {
    Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
    localStorage.setItem("roco-shortdrama-studio-projects", JSON.stringify(value.projects));
    localStorage.setItem("roco-shortdrama-studio-draft", JSON.stringify(value.draft));
    localStorage.removeItem("roco-shortdrama-access-code");
  }, seeded);

  const response = await page.goto("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await expect(page.locator("#quickStudio")).toBeVisible();
  await expect(page.locator("#quickStepRail [data-quick-step]")).toHaveCount(6);
  await expect(page.locator("#quickPrimaryAction")).toBeVisible();
  await expect(page.locator(".quick-action-dock")).toBeInViewport();
  await expect(page.locator("body")).toHaveAttribute("data-quick-step", "idea");
  await expect(page.getByRole("heading", { name: "先说这集想讲什么" })).toBeVisible();
  await expect(page.locator("#quickIdeaInput")).toBeVisible();
  await expect(page.locator("#appShell")).toBeHidden();
  await page.locator("#quickModelDrawer > summary").click();
  await page.locator('[data-quick-model-scope="creationPackage"]').selectOption("deepseek-v4-pro");
  await expect(page.locator('[data-quick-model-scope="creationPackage"]')).toHaveValue("deepseek-v4-pro");
  await expect(page.locator('[data-quick-model-scope="plan"]')).toHaveValue("deepseek-v4-flash");
  await page.locator('#quickStepRail [data-quick-step="script"]').click();
  await expect(page.locator("body")).toHaveAttribute("data-quick-step", "script");
  await expect(page.locator("#quickStageContent").getByRole("heading", { name: "旧徽章的双生主" })).toBeVisible();
  await page.locator("#proModeBtn").click();
  await expect(page.locator("#quickStudio")).toBeHidden();
  await expect(page.locator("#appShell")).toBeVisible();
  await expect(page.getByRole("heading", { name: "旧徽章的双生主" })).toBeVisible();

  await page.locator('[data-tab="storyboard"]').click();
  await expect(page.locator("#imagePromptToolbar")).toBeVisible();
  await expect(page.locator(".storyboard-image-prompt-block")).toContainText("尚未生成");
  await expect(page.locator('[data-copy-image-prompt="0"]')).toBeDisabled();

  await page.locator('[data-ai-model-scope="imagePrompt"][data-ai-model-value="deepseek-v4-pro"]').click();
  await expect(page.locator('[data-ai-model-scope="imagePrompt"][data-ai-model-value="deepseek-v4-pro"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-ai-model-scope="storyboard"][data-ai-model-value="deepseek-v4-flash"]')).toHaveAttribute("aria-pressed", "true");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});
