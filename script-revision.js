(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoScriptRevision = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const LIST_FIELDS = ["rhythm", "reversals", "innovationPoints", "hooks", "tags"];
  const COMPLEX_LIST_FIELDS = ["characters", "structure", "dialogue", "comedyBeats", "visualHighlights"];
  const DIFF_GROUPS = [
    ["title", "标题"], ["synopsis", "故事梗概"], ["characters", "人物设定"], ["structure", "剧情结构"],
    ["dialogue", "台词"], ["rhythm", "情绪节奏"], ["reversals", "反转点"],
    ["innovationPoints", "创新机制"], ["comedyBeats", "笑点设计"], ["visualHighlights", "视觉爆点"],
    ["hooks", "爆点与结尾钩子"], ["tags", "话题标签"],
  ];

  function clone(value) {
    if (value == null) return value;
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return String(value || "").trim();
  }

  function unique(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
  }

  function ensureDialogueIds(dialogue = []) {
    const used = new Set();
    let cursor = 1;
    return dialogue.map((item) => {
      let id = text(item?.id);
      if (!/^LINE-[A-Z0-9-]+$/i.test(id) || used.has(id)) {
        while (used.has(`LINE-${String(cursor).padStart(2, "0")}`)) cursor += 1;
        id = `LINE-${String(cursor).padStart(2, "0")}`;
      }
      used.add(id);
      cursor += 1;
      return { ...item, id };
    });
  }

  function normalizeScript(script = {}) {
    const source = script && typeof script === "object" ? script : {};
    return {
      ...clone(source),
      title: text(source.title),
      synopsis: text(source.synopsis),
      characters: (Array.isArray(source.characters) ? source.characters : []).map((item) => ({ name: text(item?.name), description: text(item?.description) })),
      structure: (Array.isArray(source.structure) ? source.structure : []).map((item) => ({ beat: text(item?.beat), beatIds: unique(item?.beatIds), content: text(item?.content) })),
      dialogue: ensureDialogueIds((Array.isArray(source.dialogue) ? source.dialogue : []).map((item) => ({
        id: text(item?.id), beatIds: unique(item?.beatIds), role: text(item?.role), line: text(item?.line),
        intention: text(item?.intention), subtext: text(item?.subtext),
      }))),
      rhythm: unique(source.rhythm),
      reversals: unique(source.reversals),
      innovationPoints: unique(source.innovationPoints),
      comedyBeats: (Array.isArray(source.comedyBeats) ? source.comedyBeats : []).map((item) => ({ setup: text(item?.setup), payoff: text(item?.payoff), visualAction: text(item?.visualAction) })),
      visualHighlights: (Array.isArray(source.visualHighlights) ? source.visualHighlights : []).map((item) => ({ moment: text(item?.moment), verticalComposition: text(item?.verticalComposition), effect: text(item?.effect) })),
      hooks: unique(source.hooks),
      tags: unique(source.tags),
      canonDeltas: Array.isArray(source.canonDeltas) ? clone(source.canonDeltas) : [],
      assetIntegration: source.assetIntegration && typeof source.assetIntegration === "object" ? clone(source.assetIntegration) : { characters: [], memes: [] },
    };
  }

  function validateScript(script = {}) {
    const value = normalizeScript(script);
    const issues = [];
    if (!value.title) issues.push("标题不能为空");
    if (value.synopsis.length < 30) issues.push("故事梗概至少需要30字");
    if (value.characters.length < 2 || value.characters.length > 5 || value.characters.some((item) => !item.name || !item.description)) issues.push("人物设定需要2-5个完整角色");
    if (value.structure.length !== 5 || value.structure.some((item) => !item.beat || !item.content || !item.beatIds.length)) issues.push("剧情结构需要5段，且每段必须关联节拍");
    if (value.dialogue.length < 6 || value.dialogue.length > 24 || value.dialogue.some((item) => !item.role || !item.line || !item.beatIds.length)) issues.push("台词需要6-24句，并填写角色、内容和关联节拍");
    if (value.rhythm.length < 1 || value.rhythm.length > 3) issues.push("情绪节奏需要1-3条");
    if (value.reversals.length < 1 || value.reversals.length > 3) issues.push("反转点需要1-3条");
    if (value.innovationPoints.length < 1 || value.innovationPoints.length > 3) issues.push("创新机制需要1-3条");
    if (value.comedyBeats.length < 1 || value.comedyBeats.length > 3 || value.comedyBeats.some((item) => !item.setup || !item.payoff || !item.visualAction)) issues.push("笑点设计需要1-3条完整内容");
    if (value.visualHighlights.length < 2 || value.visualHighlights.length > 4 || value.visualHighlights.some((item) => !item.moment || !item.verticalComposition || !item.effect)) issues.push("视觉爆点需要2-4条完整内容");
    if (value.hooks.length < 1 || value.hooks.length > 3) issues.push("结尾钩子需要1-3条");
    if (value.tags.length < 1 || value.tags.length > 3) issues.push("话题标签需要1-3条");
    return { valid: issues.length === 0, issues, script: value };
  }

  function createSession(value = {}) {
    return {
      baseVersionId: text(value.baseVersionId),
      workingScript: value.workingScript ? normalizeScript(value.workingScript) : null,
      dirty: Boolean(value.dirty),
      lockedBeatIds: unique(value.lockedBeatIds),
      rewriteInstructions: value.rewriteInstructions && typeof value.rewriteInstructions === "object" ? { ...value.rewriteInstructions } : {},
      rewriteCandidate: value.rewriteCandidate ? clone(value.rewriteCandidate) : null,
      canonReview: value.canonReview ? clone(value.canonReview) : null,
      revisionSource: ["manual", "ai-rewrite", "doctor", "recast"].includes(value.revisionSource) ? value.revisionSource : "manual",
      revisionNote: text(value.revisionNote),
      compareLeftId: text(value.compareLeftId),
      compareRightId: text(value.compareRightId),
      activeView: ["read", "edit", "versions"].includes(value.activeView) ? value.activeView : "read",
    };
  }

  function begin(script, baseVersionId = "") {
    return createSession({ baseVersionId, workingScript: script, dirty: false });
  }

  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key]) ]));
  }

  function same(left, right) {
    return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
  }

  function itemKey(field, item, index) {
    if (field === "characters") return text(item?.name) || `角色${index + 1}`;
    if (field === "structure") return unique(item?.beatIds).join("+") || `结构${index + 1}`;
    if (field === "dialogue") return text(item?.id) || `台词${index + 1}`;
    return String(index + 1);
  }

  function structuredDiff(leftScript, rightScript) {
    const left = normalizeScript(leftScript);
    const right = normalizeScript(rightScript);
    return DIFF_GROUPS.map(([field, label]) => {
      if (![...LIST_FIELDS, ...COMPLEX_LIST_FIELDS].includes(field)) {
        return { field, label, changes: same(left[field], right[field]) ? [] : [{ type: "modified", key: label, before: left[field], after: right[field] }] };
      }
      const leftItems = Array.isArray(left[field]) ? left[field] : [];
      const rightItems = Array.isArray(right[field]) ? right[field] : [];
      const leftMap = new Map(leftItems.map((item, index) => [itemKey(field, item, index), item]));
      const rightMap = new Map(rightItems.map((item, index) => [itemKey(field, item, index), item]));
      const keys = [...new Set([...leftMap.keys(), ...rightMap.keys()])];
      const changes = keys.flatMap((key) => {
        if (!leftMap.has(key)) return [{ type: "added", key, before: null, after: rightMap.get(key) }];
        if (!rightMap.has(key)) return [{ type: "removed", key, before: leftMap.get(key), after: null }];
        return same(leftMap.get(key), rightMap.get(key)) ? [] : [{ type: "modified", key, before: leftMap.get(key), after: rightMap.get(key) }];
      });
      return { field, label, changes };
    }).filter((group) => group.changes.length);
  }

  function diffCount(groups = []) {
    return (Array.isArray(groups) ? groups : []).reduce((total, group) => total + (Array.isArray(group?.changes) ? group.changes.length : 0), 0);
  }

  function linkedToTarget(item, targetBeatIds) {
    return unique(item?.beatIds).some((id) => targetBeatIds.includes(id));
  }

  function rewriteViolations(originalScript, candidateScript, targetBeatIds = []) {
    const original = normalizeScript(originalScript);
    const candidate = normalizeScript(candidateScript);
    const target = unique(targetBeatIds);
    const violations = [];
    const lockedFields = ["title", "synopsis", "characters", "rhythm", "reversals", "innovationPoints", "comedyBeats", "visualHighlights", "assetIntegration", "hooks", "tags"];
    lockedFields.forEach((field) => { if (!same(original[field], candidate[field])) violations.push(field); });
    const maxStructure = Math.max(original.structure.length, candidate.structure.length);
    for (let index = 0; index < maxStructure; index += 1) {
      const before = original.structure[index];
      const after = candidate.structure[index];
      if (!linkedToTarget(before || after, target) && !same(before, after)) violations.push(`structure:${index}`);
    }
    const originalDialogue = new Map(original.dialogue.map((item) => [item.id, item]));
    const candidateDialogue = new Map(candidate.dialogue.map((item) => [item.id, item]));
    [...new Set([...originalDialogue.keys(), ...candidateDialogue.keys()])].forEach((id) => {
      const before = originalDialogue.get(id);
      const after = candidateDialogue.get(id);
      if (!linkedToTarget(before || after, target) && !same(before, after)) violations.push(`dialogue:${id}`);
    });
    return [...new Set(violations)];
  }

  return {
    clone,
    normalizeScript,
    validateScript,
    createSession,
    begin,
    structuredDiff,
    diffCount,
    rewriteViolations,
    same,
  };
});
