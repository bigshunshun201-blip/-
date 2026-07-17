(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoQuickWorkflow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const steps = ["idea", "plan", "script", "refine", "storyboard", "review"];
  const bibleFields = ["characters", "abilities", "relations", "antagonist", "worldRules", "mainConflict", "hookRules"];

  function normalizeStep(value) {
    return steps.includes(value) ? value : "idea";
  }

  function createPackage(value = {}) {
    const bibleSource = value.bible && typeof value.bible === "object" ? value.bible : {};
    return {
      id: String(value.id || value.packageId || ""),
      summary: String(value.summary || "").trim(),
      risks: (Array.isArray(value.risks) ? value.risks : []).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6),
      beats: Array.isArray(value.beats) ? value.beats.map((item) => ({ ...item, assetIds: [...(item?.assetIds || [])] })) : [],
      bible: Object.fromEntries(bibleFields.map((field) => [field, String(bibleSource[field] || "").trim()])),
      status: ["draft", "confirmed", "stale"].includes(value.status) ? value.status : "draft",
      fingerprint: String(value.fingerprint || ""),
      createdAt: String(value.createdAt || ""),
    };
  }

  function isComplete(value = {}) {
    const item = createPackage(value);
    return item.beats.length === 8
      && item.beats.every((beat) => beat && beat.id && beat.action && beat.causalLink)
      && bibleFields.every((field) => item.bible[field]);
  }

  function primaryAction(context = {}) {
    const step = normalizeStep(context.step);
    if (context.busy) return { id: "busy", label: "AI 正在处理…", disabled: true };
    if (step === "idea") return context.hasPlans
      ? { id: "go-plan", label: "查看 3 套策划", disabled: false }
      : { id: "generate-plans", label: "生成 3 套策划", disabled: false };
    if (step === "plan") {
      if (!context.planComplete) return { id: "generate-plans", label: "先生成并采用一套策划", disabled: false };
      if (!context.packageComplete || context.packageStatus === "stale") return { id: "generate-package", label: "生成创作准备包", disabled: false };
      if (!context.packageConfirmed) return { id: "confirm-package", label: "确认节拍与本次圣经", disabled: false };
      return { id: "go-script", label: "进入剧本创作", disabled: false };
    }
    if (step === "script") return context.hasScript
      ? { id: "go-refine", label: "进入剧本精修", disabled: false }
      : { id: "generate-script", label: context.creationMode === "continue" ? "生成续写剧本" : "生成新剧本", disabled: !context.packageConfirmed };
    if (step === "refine") {
      if (!context.hasScript) return { id: "go-script", label: "先生成剧本", disabled: false };
      if (context.scriptDirty) return { id: "save-script-version", label: "保存精修为新版本", disabled: false };
      if (!context.scriptApproved) return { id: "approve-script", label: "批准本版剧本", disabled: false };
      return { id: "go-storyboard", label: "进入分镜制作", disabled: false };
    }
    if (step === "storyboard") return context.hasStoryboard
      ? { id: "go-review", label: "进入发布复盘", disabled: false }
      : { id: "generate-storyboard", label: "生成本版 AI 视频分镜", disabled: !context.scriptApproved };
    return { id: "save-review", label: "保存本集复盘", disabled: !context.reviewEpisodeId };
  }

  return { steps, bibleFields, normalizeStep, createPackage, isComplete, primaryAction };
});
