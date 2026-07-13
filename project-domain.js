(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoProjectDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function newId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function createProjectRecord(name = "未命名短剧项目", defaultBible = {}) {
    const now = new Date().toISOString();
    return {
      id: newId("project"),
      name,
      logline: "",
      bible: { ...defaultBible },
      episodes: [],
      assets: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  function createEpisodeVersion(snapshot = {}) {
    return {
      id: snapshot.id || newId("version"),
      createdAt: snapshot.createdAt || new Date().toISOString(),
      input: { ...(snapshot.input || {}) },
      script: snapshot.script || null,
      storyboard: Array.isArray(snapshot.storyboard) ? snapshot.storyboard : [],
      creativePack: snapshot.creativePack || null,
      historyId: snapshot.historyId || null,
      source: snapshot.source || "",
      model: snapshot.model || "",
      consistency: snapshot.consistency || null,
    };
  }

  function activeEpisodeVersion(episode) {
    return (episode?.versions || []).find((version) => version.id === episode.activeVersionId)
      || episode?.versions?.at(-1)
      || null;
  }

  function applyEpisodeVersion(episode, versionId = episode?.activeVersionId) {
    if (!episode) return episode;
    const version = (episode.versions || []).find((item) => item.id === versionId) || activeEpisodeVersion(episode);
    if (!version) return episode;
    episode.activeVersionId = version.id;
    episode.input = { ...(version.input || {}) };
    episode.script = version.script || null;
    episode.storyboard = Array.isArray(version.storyboard) ? version.storyboard : [];
    episode.creativePack = version.creativePack || null;
    episode.historyId = version.historyId || null;
    episode.source = version.source || "";
    episode.model = version.model || "";
    episode.consistency = version.consistency || null;
    return episode;
  }

  function normalizeProjectEpisodes(project) {
    project.episodes = (project.episodes || []).map((episode) => {
      const versions = Array.isArray(episode.versions) && episode.versions.length
        ? episode.versions.map(createEpisodeVersion)
        : [createEpisodeVersion(episode)];
      const normalized = { ...episode, versions, activeVersionId: episode.activeVersionId || versions.at(-1).id };
      return applyEpisodeVersion(normalized);
    });
    return project;
  }

  function nextEpisodeNumber(project) {
    const numbers = (project?.episodes || []).map((episode) => Number(episode.episodeNumber) || 0);
    return Math.max(0, ...numbers) + 1;
  }

  function validateEpisodePlan(input) {
    const plan = input?.episodePlan || {};
    const labels = {
      openingHook: "开头钩子",
      conflict: "核心冲突",
      reversal: "反转信息",
      endingSuspense: "结尾悬念",
      targetEmotion: "目标情绪",
    };
    const missing = Object.entries(labels)
      .filter(([key]) => !String(plan[key] || "").trim())
      .map(([, label]) => label);
    if (missing.length) throw new Error(`请先完成本集策划：${missing.join("、")}`);
  }

  function deriveReviewInsights(review = {}) {
    const views = Number(review.views || 0);
    const completion = Number(review.completionRate || 0);
    const comments = Number(review.comments || 0);
    const shares = Number(review.shares || 0);
    const follows = Number(review.follows || 0);
    const interactionRate = views ? ((Number(review.likes || 0) + comments + shares) / views) * 100 : 0;
    const hook = completion && completion < 35
      ? "前 3 秒取消铺垫，直接给出倒计时、精灵异常或关系破裂的可见证据。"
      : comments && views && comments / views < 0.003
        ? "结尾改成二选一追问，让观众决定下一集先救谁、先查哪条线索。"
        : "沿用当前信息密度，下一集在前 3 秒先兑现上一集留下的一个问题。";
    const title = shares && views && shares / views > 0.01
      ? "标题沿用情绪共鸣结构，加入角色名和不可逆代价。"
      : "标题用“角色 + 异常问题”结构，避免解释世界观，例如“迪莫为什么不肯回月牙镇？”";
    const cover = follows && views && follows / views > 0.01
      ? "封面保留账号主角和系列标记，强化追更识别。"
      : "封面只保留一张角色表情、一处异常道具和 6-10 字冲突词。";
    return { hook, title, cover, interactionRate };
  }

  function upsertEpisodeVersion(project, options = {}) {
    const input = options.input || {};
    const episodeNumber = Math.max(1, Number(input.episodeNumber) || nextEpisodeNumber(project));
    let episode = (project?.episodes || []).find((item) => item.id === options.currentEpisodeId);
    if (!episode || (Number(episode.episodeNumber) !== episodeNumber && options.mode === "new")) {
      episode = project.episodes.find((item) => Number(item.episodeNumber) === episodeNumber) || null;
    }
    if (!episode) {
      episode = { id: newId("episode"), episodeNumber, review: { status: "draft" } };
      project.episodes.push(episode);
    }
    const version = createEpisodeVersion(options.versionSnapshot || {});
    episode.versions = Array.isArray(episode.versions) ? episode.versions : [];
    episode.versions.push(version);
    episode.episodeNumber = episodeNumber;
    episode.activeVersionId = version.id;
    applyEpisodeVersion(episode, version.id);
    episode.updatedAt = new Date().toISOString();
    project.updatedAt = episode.updatedAt;
    return { episode, version };
  }

  function updateActiveStoryboard(episode, storyboard, response = {}) {
    const version = activeEpisodeVersion(episode);
    if (!episode || !version) return null;
    version.storyboard = Array.isArray(storyboard) ? storyboard : [];
    version.source = response.source || version.source || "";
    version.model = response.model || version.model || "";
    applyEpisodeVersion(episode, version.id);
    episode.updatedAt = new Date().toISOString();
    return version;
  }

  return {
    newId,
    createProjectRecord,
    createEpisodeVersion,
    activeEpisodeVersion,
    applyEpisodeVersion,
    normalizeProjectEpisodes,
    nextEpisodeNumber,
    validateEpisodePlan,
    deriveReviewInsights,
    upsertEpisodeVersion,
    updateActiveStoryboard,
  };
});
