(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoProjectDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PROJECT_SCHEMA_VERSION = 5;

  function emptySeriesLedger() {
    return {
      openQuestions: [], resolvedQuestions: [], characterStates: [], abilityStates: [], propStates: [],
      antagonistProgress: "", recurringGags: [], nextObligations: [], updatedAt: null,
      throughEpisode: 0,
    };
  }

  function newId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function createProjectRecord(name = "未命名短剧项目", defaultBible = {}) {
    const now = new Date().toISOString();
    return {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: newId("project"),
      name,
      logline: "",
      bible: { ...defaultBible },
      planBatches: [],
      creativeMixBatches: [],
      beatSheetBatches: [],
      seriesLedger: emptySeriesLedger(),
      ledgerVersions: [],
      canonSources: [],
      episodes: [],
      assets: [],
      memes: [],
      characterCards: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  function createStoryboardVersion(snapshot = {}) {
    return {
      id: snapshot.id || newId("storyboard-version"),
      createdAt: snapshot.createdAt || new Date().toISOString(),
      storyboard: Array.isArray(snapshot.storyboard) ? snapshot.storyboard : [],
      scriptVersionId: snapshot.scriptVersionId || "",
      source: snapshot.source || "",
      model: snapshot.model || "",
    };
  }

  function createEpisodeVersion(snapshot = {}) {
    const id = snapshot.id || newId("version");
    const legacyStoryboard = Array.isArray(snapshot.storyboard) ? snapshot.storyboard : [];
    const storyboardVersions = Array.isArray(snapshot.storyboardVersions) && snapshot.storyboardVersions.length
      ? snapshot.storyboardVersions.map((item) => createStoryboardVersion({ ...item, scriptVersionId: item.scriptVersionId || id }))
      : legacyStoryboard.length
        ? [createStoryboardVersion({
          storyboard: legacyStoryboard,
          source: snapshot.source,
          model: snapshot.model,
          scriptVersionId: id,
          createdAt: snapshot.storyboardCreatedAt || snapshot.createdAt,
        })]
        : [];
    const activeStoryboardVersionId = storyboardVersions.some((item) => item.id === snapshot.activeStoryboardVersionId)
      ? snapshot.activeStoryboardVersionId
      : storyboardVersions.at(-1)?.id || null;
    const activeStoryboard = storyboardVersions.find((item) => item.id === activeStoryboardVersionId);
    const doctorResult = snapshot.doctorResult && typeof snapshot.doctorResult === "object"
      ? snapshot.doctorResult
      : snapshot.doctorReport
        ? { report: snapshot.doctorReport, revisedScript: null, createdAt: snapshot.createdAt || new Date().toISOString() }
        : null;
    return {
      id,
      createdAt: snapshot.createdAt || new Date().toISOString(),
      input: { ...(snapshot.input || {}) },
      script: snapshot.script || null,
      storyboard: activeStoryboard?.storyboard || legacyStoryboard,
      storyboardVersions,
      activeStoryboardVersionId,
      creativePack: snapshot.creativePack || null,
      historyId: snapshot.historyId || null,
      source: snapshot.source || "",
      model: snapshot.model || "",
      consistency: snapshot.consistency || null,
      doctorResult,
      doctorReport: doctorResult?.report || snapshot.doctorReport || null,
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
    episode.storyboardVersions = Array.isArray(version.storyboardVersions) ? version.storyboardVersions : [];
    episode.activeStoryboardVersionId = version.activeStoryboardVersionId || null;
    episode.creativePack = version.creativePack || null;
    episode.historyId = version.historyId || null;
    episode.source = version.source || "";
    episode.model = version.model || "";
    episode.consistency = version.consistency || null;
    episode.doctorResult = version.doctorResult || null;
    episode.doctorReport = version.doctorReport || null;
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

  function normalizeIdList(value) {
    return [...new Set((Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean))];
  }

  function rekeyImportedProject(project) {
    project.id = newId("project");
    project.episodes = (project.episodes || []).map((episode) => {
      const versionIdMap = new Map();
      const versions = (episode.versions || []).map((sourceVersion) => {
        const oldVersionId = sourceVersion.id;
        const versionId = newId("version");
        versionIdMap.set(oldVersionId, versionId);
        const storyboardIdMap = new Map();
        const storyboardVersions = (sourceVersion.storyboardVersions || []).map((sourceStoryboard) => {
          const storyboard = {
            ...sourceStoryboard,
            id: newId("storyboard-version"),
            scriptVersionId: versionId,
          };
          storyboardIdMap.set(sourceStoryboard.id, storyboard.id);
          return storyboard;
        });
        return createEpisodeVersion({
          ...sourceVersion,
          id: versionId,
          historyId: null,
          storyboardVersions,
          activeStoryboardVersionId: storyboardIdMap.get(sourceVersion.activeStoryboardVersionId)
            || storyboardVersions.at(-1)?.id
            || null,
        });
      });
      const normalized = {
        ...episode,
        id: newId("episode"),
        historyId: null,
        versions,
        activeVersionId: versionIdMap.get(episode.activeVersionId) || versions.at(-1)?.id || null,
      };
      return applyEpisodeVersion(normalized, normalized.activeVersionId);
    });
    project.createdAt = new Date().toISOString();
    project.updatedAt = project.createdAt;
    return project;
  }

  function migrateProjectRecord(source = {}, defaultBible = {}) {
    const incomingVersion = Math.max(1, Number(source.schemaVersion || 1));
    if (incomingVersion > PROJECT_SCHEMA_VERSION) {
      throw new Error(`项目数据版本 ${incomingVersion} 高于当前支持版本 ${PROJECT_SCHEMA_VERSION}，请先升级应用。`);
    }

    const project = {
      ...source,
      schemaVersion: incomingVersion,
      bible: { ...defaultBible, ...(source.bible || {}) },
      episodes: Array.isArray(source.episodes) ? source.episodes : [],
      assets: Array.isArray(source.assets) ? source.assets : [],
      memes: Array.isArray(source.memes) ? source.memes : [],
      characterCards: Array.isArray(source.characterCards) ? source.characterCards : [],
      planBatches: Array.isArray(source.planBatches) ? source.planBatches : [],
      creativeMixBatches: Array.isArray(source.creativeMixBatches) ? source.creativeMixBatches : [],
      beatSheetBatches: Array.isArray(source.beatSheetBatches) ? source.beatSheetBatches : [],
      seriesLedger: { ...emptySeriesLedger(), ...(source.seriesLedger || {}) },
      ledgerVersions: Array.isArray(source.ledgerVersions) ? source.ledgerVersions : [],
      canonSources: Array.isArray(source.canonSources) ? source.canonSources : [],
    };

    if (project.schemaVersion < 2) {
      project.episodes = project.episodes.map((episode) => ({
        ...episode,
        input: {
          ...(episode.input || {}),
          activeMemeIds: normalizeIdList(episode.input?.activeMemeIds),
          activeCharacterIds: normalizeIdList(episode.input?.activeCharacterIds),
        },
        versions: Array.isArray(episode.versions)
          ? episode.versions.map((version) => ({
            ...version,
            input: {
              ...(version.input || {}),
              activeMemeIds: normalizeIdList(version.input?.activeMemeIds),
              activeCharacterIds: normalizeIdList(version.input?.activeCharacterIds),
            },
          }))
          : episode.versions,
      }));
      project.schemaVersion = 2;
    }

    if (project.schemaVersion < 3) {
      project.creativeMixBatches = [];
      project.beatSheetBatches = [];
      project.schemaVersion = 3;
    }

    if (project.schemaVersion < 4) {
      project.seriesLedger = emptySeriesLedger();
      project.ledgerVersions = [];
      project.canonSources = [];
      project.schemaVersion = 4;
    }

    if (project.schemaVersion < 5) {
      project.episodes = project.episodes.map((episode) => ({
        ...episode,
        versions: Array.isArray(episode.versions)
          ? episode.versions.map((version) => ({
            ...version,
            doctorResult: version.doctorResult || (version.doctorReport
              ? { report: version.doctorReport, revisedScript: null, createdAt: version.createdAt || null }
              : null),
          }))
          : episode.versions,
      }));
      project.schemaVersion = 5;
    }

    project.schemaVersion = PROJECT_SCHEMA_VERSION;
    return normalizeProjectEpisodes(project);
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
      protagonistGoal: "主角目标",
      stakes: "失败代价",
      forcedChoice: "被迫选择",
      reversal: "反转信息",
      relationshipShift: "关系变化",
      endingSuspense: "结尾悬念",
      targetEmotion: "目标情绪",
    };
    const missing = Object.entries(labels)
      .filter(([key]) => !String(plan[key] || "").trim())
      .map(([, label]) => label);
    if (missing.length) throw new Error(`请先完成本集策划：${missing.join("、")}。没有思路时可点击“快速填充（免费）”。`);
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
    const version = createEpisodeVersion({
      ...(options.versionSnapshot || {}),
      input: options.versionSnapshot?.input || input,
    });
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
    const storyboardVersion = createStoryboardVersion({
      storyboard,
      scriptVersionId: version.id,
      source: response.source,
      model: response.model,
    });
    version.storyboardVersions = Array.isArray(version.storyboardVersions) ? version.storyboardVersions : [];
    version.storyboardVersions.push(storyboardVersion);
    version.activeStoryboardVersionId = storyboardVersion.id;
    version.storyboard = storyboardVersion.storyboard;
    version.source = response.source || version.source || "";
    version.model = response.model || version.model || "";
    applyEpisodeVersion(episode, version.id);
    episode.updatedAt = new Date().toISOString();
    return storyboardVersion;
  }

  function applyStoryboardVersion(episode, storyboardVersionId) {
    const version = activeEpisodeVersion(episode);
    if (!episode || !version) return null;
    const storyboardVersion = (version.storyboardVersions || []).find((item) => item.id === storyboardVersionId);
    if (!storyboardVersion || (storyboardVersion.scriptVersionId && storyboardVersion.scriptVersionId !== version.id)) return null;
    version.activeStoryboardVersionId = storyboardVersion.id;
    version.storyboard = storyboardVersion.storyboard;
    applyEpisodeVersion(episode, version.id);
    episode.updatedAt = new Date().toISOString();
    return storyboardVersion;
  }

  return {
    PROJECT_SCHEMA_VERSION,
    emptySeriesLedger,
    newId,
    createProjectRecord,
    createStoryboardVersion,
    createEpisodeVersion,
    activeEpisodeVersion,
    applyEpisodeVersion,
    normalizeProjectEpisodes,
    rekeyImportedProject,
    migrateProjectRecord,
    nextEpisodeNumber,
    validateEpisodePlan,
    deriveReviewInsights,
    upsertEpisodeVersion,
    updateActiveStoryboard,
    applyStoryboardVersion,
  };
});
