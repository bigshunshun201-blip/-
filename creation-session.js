(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoCreationSession = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const BRIEF_FIELDS = [
    "requiredHook",
    "openQuestions",
    "characterState",
    "constraints",
    "mustPreserve",
    "direction",
    "newIdeas",
  ];

  function text(value) {
    return String(value || "").trim();
  }

  function normalizeMode(mode) {
    return mode === "continue" ? "continue" : "new";
  }

  function normalizeSourceRef(source = {}) {
    const ref = source?.ref || source?.sourceRef || source;
    if (!ref?.episodeId || !ref?.versionId) return null;
    return {
      projectId: text(ref.projectId),
      episodeId: text(ref.episodeId),
      versionId: text(ref.versionId),
      episodeNumber: Math.max(1, Number(ref.episodeNumber) || 1),
      versionNumber: Math.max(1, Number(ref.versionNumber) || 1),
      title: text(ref.title),
      createdAt: text(ref.createdAt),
    };
  }

  function normalizeBrief(brief = {}) {
    return Object.fromEntries(BRIEF_FIELDS.map((field) => [field, text(brief[field])]));
  }

  function deriveBrief(source = {}, ledger = {}) {
    const script = source.script || {};
    const hooks = Array.isArray(script.hooks) ? script.hooks.map(text).filter(Boolean) : [];
    const characters = Array.isArray(script.characters) ? script.characters : [];
    const characterState = characters
      .slice(0, 5)
      .map((item) => `${text(item.name)}：${text(item.description)}`)
      .filter((item) => item !== "：")
      .join("\n");
    const openQuestions = (Array.isArray(ledger.openQuestions) ? ledger.openQuestions : [])
      .map((item) => text(item?.question || item?.content || item))
      .filter(Boolean)
      .slice(-5)
      .join("\n");
    const states = [
      ...(Array.isArray(ledger.abilityStates) ? ledger.abilityStates : []),
      ...(Array.isArray(ledger.propStates) ? ledger.propStates : []),
    ].map((item) => text(item?.state || item?.content || item)).filter(Boolean).slice(-6).join("\n");
    const obligations = (Array.isArray(ledger.nextObligations) ? ledger.nextObligations : [])
      .map((item) => text(item?.content || item?.obligation || item))
      .filter(Boolean)
      .slice(-5)
      .join("\n");
    return normalizeBrief({
      requiredHook: hooks[0] || text(script.structure?.at?.(-1)?.content),
      openQuestions: openQuestions || hooks.slice(1).join("\n"),
      characterState,
      constraints: states,
      mustPreserve: obligations,
      direction: "先兑现上一集钩子，再升级冲突；不要复述上一集。",
      newIdeas: "",
    });
  }

  function hasSessionWork(session = {}) {
    const input = session.input || {};
    const plan = input.episodePlan || {};
    return Boolean(
      session.script
      || (session.storyboard || []).length
      || session.beatSheet?.length
      || session.planOptions?.length
      || Object.values(plan).some(text),
    );
  }

  function continuationContext(source, brief) {
    const sourceRef = normalizeSourceRef(source);
    if (!sourceRef || !source?.script) return null;
    return {
      sourceRef,
      brief: normalizeBrief(brief),
      sourceScript: source.script,
      sourceStoryboard: Array.isArray(source.storyboard) ? source.storyboard : [],
      sourceEpisodeBible: source.episodeBibleSnapshot || source.generationBibleSnapshot || null,
    };
  }

  return {
    BRIEF_FIELDS,
    normalizeMode,
    normalizeSourceRef,
    normalizeBrief,
    deriveBrief,
    hasSessionWork,
    continuationContext,
  };
});
