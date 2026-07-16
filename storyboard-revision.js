(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoStoryboardRevision = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const LIST_FIELDS = new Set(["beatIds", "dialogueIds"]);
  const NUMBER_FIELDS = new Set(["seconds", "generationSeconds", "trimSeconds"]);

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return String(value || "").trim();
  }

  function unique(value) {
    return [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))];
  }

  function normalizeSegment(value = {}, index = 0) {
    return {
      ...clone(value),
      clipId: text(value.clipId) || `CLIP-${String(index + 1).padStart(2, "0")}`,
      shot: Math.max(1, Number(value.shot || index + 1)),
      beatIds: unique(value.beatIds),
      dialogueIds: unique(value.dialogueIds),
      timeRange: text(value.timeRange),
      seconds: Math.max(1, Number(value.seconds || 1)),
      generationSeconds: Math.max(1, Number(value.generationSeconds || value.seconds || 1)),
      trimSeconds: Math.max(0, Number(value.trimSeconds || 0)),
      generationMode: text(value.generationMode) || "单场景连续镜头",
      segmentGoal: text(value.segmentGoal),
      continuityIn: text(value.continuityIn),
      continuityOut: text(value.continuityOut),
      beatBreakdown: (Array.isArray(value.beatBreakdown) ? value.beatBreakdown : []).map((item) => ({ range: text(item?.range), content: text(item?.content) })).filter((item) => item.range || item.content),
      visual: text(value.visual), characters: text(value.characters), scene: text(value.scene), action: text(value.action),
      line: text(value.line), scale: text(value.scale), movement: text(value.movement), sound: text(value.sound),
      subtitle: text(value.subtitle), visualPrompt: text(value.visualPrompt), assetLinks: text(value.assetLinks),
      assetNote: text(value.assetNote), assetStatus: text(value.assetStatus) || "待制作",
    };
  }

  function normalizeStoryboard(value = []) {
    return (Array.isArray(value) ? value : []).map(normalizeSegment);
  }

  function same(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function createSession(value = {}) {
    return {
      baseStoryboardVersionId: text(value.baseStoryboardVersionId),
      workingStoryboard: normalizeStoryboard(value.workingStoryboard),
      dirty: Boolean(value.dirty),
      instructionByClipId: value.instructionByClipId && typeof value.instructionByClipId === "object" ? { ...value.instructionByClipId } : {},
      candidate: value.candidate ? clone(value.candidate) : null,
      revisionNote: text(value.revisionNote),
    };
  }

  function begin(storyboard, baseStoryboardVersionId = "") {
    return createSession({ baseStoryboardVersionId, workingStoryboard: storyboard, dirty: false });
  }

  function updateField(session, index, field, rawValue) {
    if (!session?.workingStoryboard?.[index]) return session;
    let value = rawValue;
    if (LIST_FIELDS.has(field)) value = String(rawValue || "").split(/[,，、\s]+/).map(text).filter(Boolean);
    if (NUMBER_FIELDS.has(field)) value = Math.max(field === "trimSeconds" ? 0 : 1, Number(rawValue || 0));
    if (field === "beatBreakdown") {
      value = String(rawValue || "").split(/\r?\n/).map((line) => {
        const [range, ...content] = line.split(/[|｜]/);
        return { range: text(range), content: text(content.join("｜")) };
      }).filter((item) => item.range || item.content);
    }
    session.workingStoryboard[index] = normalizeSegment({ ...session.workingStoryboard[index], [field]: value }, index);
    return session;
  }

  function lockCandidateBoundaries(storyboard, index, candidate) {
    const source = storyboard[index];
    if (!source) return null;
    const previous = storyboard[index - 1];
    const next = storyboard[index + 1];
    return normalizeSegment({
      ...candidate,
      shot: source.shot,
      clipId: source.clipId,
      timeRange: source.timeRange,
      seconds: source.seconds,
      generationSeconds: source.generationSeconds,
      trimSeconds: source.trimSeconds,
      generationMode: source.generationMode,
      continuityIn: previous?.continuityOut || source.continuityIn,
      continuityOut: next?.continuityIn || source.continuityOut,
    }, index);
  }

  function segmentDiff(before = {}, after = {}) {
    const labels = {
      segmentGoal: "本段任务", beatBreakdown: "段内节拍", visual: "画面", characters: "角色", scene: "场景",
      action: "动作", line: "台词", subtitle: "字幕", scale: "景别", movement: "镜头运动", sound: "声音",
      continuityIn: "承接入点", continuityOut: "承接出点", visualPrompt: "视频提示词", beatIds: "节拍ID", dialogueIds: "台词ID",
    };
    return Object.entries(labels).flatMap(([field, label]) => same(before[field], after[field]) ? [] : [{ field, label, before: clone(before[field]), after: clone(after[field]) }]);
  }

  function adoptCandidate(session) {
    const candidate = session?.candidate;
    if (!candidate || !session.workingStoryboard[candidate.index]) return false;
    session.workingStoryboard[candidate.index] = lockCandidateBoundaries(session.workingStoryboard, candidate.index, candidate.segment);
    session.candidate = null;
    session.dirty = true;
    return true;
  }

  return { clone, normalizeSegment, normalizeStoryboard, createSession, begin, updateField, lockCandidateBoundaries, segmentDiff, adoptCandidate, same };
});
