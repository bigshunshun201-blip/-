(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoAppState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const aiModelScopes = ["meme", "mix", "plan", "beat", "script", "scriptRewrite", "scriptCanonReview", "storyboard", "bible", "episodeBible", "character", "continuity", "topics", "ledger", "doctor", "recast"];
  const defaultAiModels = Object.fromEntries(aiModelScopes.map((scope) => [scope, "deepseek-v4-flash"]));
  const aiModelScopeLabels = {
    meme: "热梗提炼", mix: "角色与梗搭配", plan: "单集策划", beat: "剧情节拍表",
    script: "剧本", scriptRewrite: "局部改写", scriptCanonReview: "圣经复核", storyboard: "分镜", bible: "系列总圣经", episodeBible: "本次创作圣经", character: "角色卡",
    continuity: "一致性检查", topics: "选题", ledger: "连载台账", doctor: "剧本医生", recast: "智能换角",
  };

  function createState() {
    return {
      script: null,
      storyboard: [],
      competitors: [],
      analysis: null,
      topics: [],
      selectedTopic: null,
      creativePack: null,
      calendar: [],
      history: [],
      currentHistoryId: null,
      projects: [],
      currentProjectId: null,
      currentEpisodeId: null,
      reviewEpisodeId: null,
      topicBatch: 0,
      planOptions: [],
      selectedPlanOptionId: null,
      activePlanBatchId: null,
      memeIdeas: [],
      activeMemeIds: [],
      activeCharacterIds: [],
      creativeMixOptions: [],
      selectedCreativeMixId: null,
      activeCreativeMixBatchId: null,
      beatSheet: [],
      beatSheetApproved: false,
      activeBeatSheetBatchId: null,
      creationMode: "new",
      creationSessions: { new: null, continue: null },
      continuationSource: null,
      continuationBrief: {},
      episodeBible: {
        draft: null, generationSnapshot: null, status: "unprepared", confirmedFingerprint: "", generatedForFingerprint: "",
        canonDeltas: [], acceptedCanonDeltaIds: [], scriptNeedsRegeneration: false, legacySnapshotMissing: false,
      },
      activeAiOperation: null,
      aiModels: { ...defaultAiModels },
      scriptDoctor: null,
      scriptRevisionSession: null,
      editingCharacterId: null,
      cloudArchive: { message: "本地档案已启用，等待首次云端备份。", state: "idle", versions: [] },
    };
  }

  return { aiModelScopes, defaultAiModels, aiModelScopeLabels, createState };
});
