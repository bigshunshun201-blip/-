(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoQuickWorkflow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const steps = ["idea", "plan", "script", "refine", "storyboard", "review"];
  const stepMeta = {
    idea: { label: "创意", verb: "确定这一集讲什么" },
    plan: { label: "策划", verb: "选择冲突与反转结构" },
    script: { label: "剧本", verb: "生成完整可拍剧本" },
    refine: { label: "精修", verb: "修改并批准剧本版本" },
    storyboard: { label: "分镜", verb: "拆成可制作的视频段" },
    review: { label: "发布复盘", verb: "用真实数据改进下一集" },
  };
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

  function normalizeContext(context = {}) {
    return {
      ...context,
      step: normalizeStep(context.step),
      hasPlans: Boolean(context.hasPlans),
      planComplete: Boolean(context.planComplete),
      packageComplete: Boolean(context.packageComplete),
      packageConfirmed: Boolean(context.packageConfirmed),
      hasScript: Boolean(context.hasScript),
      scriptDirty: Boolean(context.scriptDirty),
      scriptApproved: Boolean(context.scriptApproved),
      hasStoryboard: Boolean(context.hasStoryboard),
      reviewHasData: Boolean(context.reviewHasData),
    };
  }

  function stepStates(context = {}) {
    const value = normalizeContext(context);
    const ideaDone = value.hasPlans || value.planComplete || value.packageComplete || value.hasScript;
    const planAvailable = value.hasPlans || value.planComplete || value.packageComplete || value.hasScript;
    const planDone = value.packageConfirmed || value.hasScript;
    const scriptAvailable = value.packageConfirmed || value.hasScript;
    const scriptDone = value.hasScript;
    const refineAvailable = value.hasScript;
    const refineDone = value.scriptApproved;
    const storyboardAvailable = value.scriptApproved || value.hasStoryboard;
    const storyboardDone = value.hasStoryboard;
    const reviewAvailable = value.hasStoryboard || value.reviewHasData;
    const reviewDone = value.reviewHasData;
    const definitions = {
      idea: { available: true, complete: ideaDone, missing: [] },
      plan: { available: planAvailable, complete: planDone, missing: planAvailable ? [] : ["先生成 3 个创意方向"] },
      script: { available: scriptAvailable, complete: scriptDone, missing: scriptAvailable ? [] : ["先采用一套策划", "生成并确认创作准备包"] },
      refine: { available: refineAvailable, complete: refineDone, missing: refineAvailable ? [] : ["先生成本集剧本"] },
      storyboard: { available: storyboardAvailable, complete: storyboardDone, missing: storyboardAvailable ? [] : ["先完成圣经复核并批准剧本"] },
      review: { available: reviewAvailable, complete: reviewDone, missing: reviewAvailable ? [] : ["先生成当前剧本对应的分镜"] },
    };
    return steps.map((id, index) => ({
      id,
      index,
      ...stepMeta[id],
      ...definitions[id],
      current: id === value.step,
      state: id === value.step ? "current" : definitions[id].complete ? "complete" : definitions[id].available ? "available" : "locked",
    }));
  }

  function resolveStep(requested, context = {}) {
    const target = normalizeStep(requested);
    const states = stepStates({ ...context, step: target });
    const requestedState = states.find((item) => item.id === target);
    if (requestedState?.available) return { step: target, allowed: true, missing: [] };
    const current = normalizeStep(context.step);
    const currentState = states.find((item) => item.id === current);
    if (currentState?.available) return { step: current, allowed: false, missing: requestedState?.missing || [] };
    const furthest = states.filter((item) => item.available).at(-1) || states[0];
    return { step: furthest.id, allowed: false, missing: requestedState?.missing || [] };
  }

  function assetLabel(step, context = {}) {
    if (step === "idea") return context.hasPlans ? `${Number(context.planCount || 3)} 个方向` : "等待开题";
    if (step === "plan") return context.packageConfirmed ? "准备包已确认" : context.planComplete ? "策划已采用" : "等待选择";
    if (step === "script") return context.hasScript ? `剧本 v${Number(context.scriptVersionNumber || 1)}` : "等待生成";
    if (step === "refine") return context.scriptApproved ? "已批准" : context.scriptDirty ? "工作稿未保存" : context.hasScript ? "待复核" : "等待剧本";
    if (step === "storyboard") return context.hasStoryboard ? `${Number(context.storyboardCount || 0)} 个视频段` : "等待批准";
    return context.reviewHasData ? "复盘已保存" : "等待发布数据";
  }

  function primaryAction(context = {}) {
    const step = normalizeStep(context.step);
    if (context.busy) return { id: "busy", label: "AI 正在处理…", disabled: true };
    if (step === "idea") return context.hasPlans
      ? { id: "go-plan", label: `查看 ${Number(context.planCount || 3)} 个方向`, disabled: false }
      : { id: "generate-plans", label: "生成 3 个不同方向", disabled: !String(context.theme || "").trim() };
    if (step === "plan") {
      if (!context.hasPlans && !context.planComplete) return { id: "go-idea", label: "先完成创意开题", disabled: false };
      if (!context.planComplete) return { id: "wait-plan", label: "先选择一套策划", disabled: true };
      if (!context.packageComplete || context.packageStatus === "stale") return { id: "generate-package", label: context.packageStatus === "stale" ? "重新生成创作准备包" : "生成创作准备包", disabled: false };
      if (!context.packageConfirmed) return { id: "confirm-package", label: "确认准备包并进入剧本", disabled: false };
      return { id: "go-script", label: "进入剧本创作", disabled: false };
    }
    if (step === "script") return context.hasScript
      ? { id: "go-refine", label: "进入剧本精修", disabled: false }
      : { id: "generate-script", label: context.creationMode === "continue" ? "生成续写剧本" : "生成新剧本", disabled: !context.packageConfirmed };
    if (step === "refine") {
      if (!context.hasScript) return { id: "go-script", label: "先生成剧本", disabled: false };
      if (context.scriptDirty) return { id: "save-script-version", label: "保存精修为新版本", disabled: false };
      if (!context.scriptApproved) return { id: "approve-script", label: "AI 圣经复核并批准", disabled: false };
      return { id: "go-storyboard", label: "进入分镜制作", disabled: false };
    }
    if (step === "storyboard") return context.hasStoryboard
      ? { id: "go-review", label: "进入发布复盘", disabled: false }
      : { id: "generate-storyboard", label: "基于已批准剧本生成分镜", disabled: !context.scriptApproved };
    return { id: "save-review", label: "保存复盘并生成下一集建议", disabled: !context.reviewEpisodeId };
  }

  return { steps, stepMeta, bibleFields, normalizeStep, normalizeContext, createPackage, isComplete, stepStates, resolveStep, assetLabel, primaryAction };
});
