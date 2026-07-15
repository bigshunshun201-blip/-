(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoEpisodeBible = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const FIELDS = ["characters", "abilities", "relations", "antagonist", "worldRules", "mainConflict", "hookRules"];
  const STATUSES = ["unprepared", "draft", "confirmed", "stale", "aligned"];

  function text(value) {
    return String(value || "").trim();
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function normalizeBible(value = {}, options = {}) {
    const bible = value?.bible && typeof value.bible === "object" ? value.bible : value;
    const normalized = Object.fromEntries(FIELDS.map((field) => [field, text(bible?.[field])]));
    if (options.requireComplete && FIELDS.some((field) => !normalized[field])) {
      throw new Error("本次创作圣经的七项设定需要全部填写。 ");
    }
    return normalized;
  }

  function isComplete(value) {
    const bible = normalizeBible(value);
    return FIELDS.every((field) => bible[field]);
  }

  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== "object") return typeof value === "string" ? value.trim() : value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }

  function hash(value) {
    const source = JSON.stringify(stable(value));
    let result = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      result ^= source.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return `bible-${(result >>> 0).toString(16).padStart(8, "0")}`;
  }

  function creationFingerprint(input = {}) {
    const plan = input.episodePlan || {};
    return hash({
      creationMode: input.creationMode === "continue" ? "continue" : "new",
      theme: text(input.theme), roles: text(input.roles), scene: text(input.scene), direction: text(input.direction),
      audience: text(input.audience), duration: Number(input.duration || 0), style: text(input.style),
      episodeNumber: Math.max(1, Number(input.episodeNumber || 1)),
      memeSeed: text(input.memeSeed), creativeMixBrief: text(input.creativeMixBrief),
      activeMemeIds: [...new Set(input.activeMemeIds || [])].map(text).sort(),
      activeCharacterIds: [...new Set(input.activeCharacterIds || [])].map(text).sort(),
      episodePlan: Object.fromEntries(Object.keys(plan).sort().map((key) => [key, text(plan[key])])),
      beatSheet: (input.beatSheet || []).map((beat) => ({
        id: text(beat.id), timeRange: text(beat.timeRange), dramaticTask: text(beat.dramaticTask),
        characterGoal: text(beat.characterGoal), action: text(beat.action), newInformation: text(beat.newInformation),
        emotion: text(beat.emotion), causalLink: text(beat.causalLink), assetIds: [...new Set(beat.assetIds || [])].map(text).sort(),
      })),
      sourceRef: input.continuationSourceRef ? {
        projectId: text(input.continuationSourceRef.projectId), episodeId: text(input.continuationSourceRef.episodeId),
        versionId: text(input.continuationSourceRef.versionId), episodeNumber: Number(input.continuationSourceRef.episodeNumber || 0),
      } : null,
      continuationBrief: input.creationMode === "continue" ? stable(input.continuationBrief || {}) : null,
    });
  }

  function bibleFingerprint(bible) {
    return hash(normalizeBible(bible));
  }

  function normalizeDelta(item = {}, index = 0) {
    const field = FIELDS.includes(item.field) ? item.field : "";
    const fact = text(item.fact || item.suggestedFact);
    const evidence = text(item.evidence);
    if (!field || !fact || !evidence) return null;
    return {
      id: text(item.id) || `CANON-${String(index + 1).padStart(2, "0")}`,
      field,
      fact,
      evidence,
      risk: text(item.risk) || "需确认是否会限制后续剧情。",
    };
  }

  function normalizeDeltas(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : []).map(normalizeDelta).filter((item) => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).slice(0, 8);
  }

  function createState(value = {}) {
    const draft = value.draft && typeof value.draft === "object" ? normalizeBible(value.draft) : null;
    return {
      draft,
      generationSnapshot: value.generationSnapshot && typeof value.generationSnapshot === "object" ? normalizeBible(value.generationSnapshot) : null,
      status: STATUSES.includes(value.status) ? value.status : "unprepared",
      confirmedFingerprint: text(value.confirmedFingerprint),
      generatedForFingerprint: text(value.generatedForFingerprint),
      canonDeltas: normalizeDeltas(value.canonDeltas),
      acceptedCanonDeltaIds: [...new Set(value.acceptedCanonDeltaIds || [])].map(text).filter(Boolean),
      scriptNeedsRegeneration: Boolean(value.scriptNeedsRegeneration),
      legacySnapshotMissing: Boolean(value.legacySnapshotMissing),
    };
  }

  function appendFact(current, fact) {
    const lines = text(current).split("\n").map(text).filter(Boolean);
    if (lines.some((line) => line === fact || line.includes(fact) || fact.includes(line))) return lines.join("\n");
    return [...lines, fact].join("\n");
  }

  function absorbDeltas(bible, deltas, selectedIds) {
    const next = normalizeBible(bible);
    const selected = new Set(selectedIds || []);
    normalizeDeltas(deltas).forEach((delta) => {
      if (selected.has(delta.id)) next[delta.field] = appendFact(next[delta.field], delta.fact);
    });
    return next;
  }

  return {
    FIELDS,
    STATUSES,
    clone,
    normalizeBible,
    isComplete,
    creationFingerprint,
    bibleFingerprint,
    normalizeDelta,
    normalizeDeltas,
    createState,
    absorbDeltas,
  };
});
