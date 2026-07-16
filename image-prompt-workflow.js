(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoImagePromptWorkflow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PROMPT_FIELDS = ["imagePromptMoment", "imagePromptAnchor", "imagePrompt"];
  const PRODUCTION_ONLY_FIELDS = new Set(["assetLinks", "assetNote", "assetStatus"]);

  function text(value) {
    return String(value || "").trim();
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function shouldInvalidateForField(field) {
    return !PROMPT_FIELDS.includes(field) && !PRODUCTION_ONLY_FIELDS.has(field);
  }

  function invalidateSegment(segment = {}) {
    return { ...clone(segment), imagePromptMoment: "", imagePromptAnchor: "", imagePrompt: "" };
  }

  function targetIndexes(storyboard = [], indexes = []) {
    return [...new Set(indexes.map(Number))].filter((index) => Number.isInteger(index) && index >= 0 && storyboard[index]);
  }

  function mergePrompts(storyboard = [], prompts = [], indexes = []) {
    const result = clone(storyboard) || [];
    const targets = new Set(targetIndexes(result, indexes));
    const appliedIndexes = [];
    (Array.isArray(prompts) ? prompts : []).forEach((item) => {
      const index = result.findIndex((segment) => text(segment?.clipId) === text(item?.clipId));
      if (index < 0 || !targets.has(index) || !text(item?.prompt)) return;
      result[index] = {
        ...result[index],
        imagePromptMoment: text(item.frameMoment),
        imagePromptAnchor: text(item.consistencyAnchor),
        imagePrompt: text(item.prompt),
      };
      appliedIndexes.push(index);
    });
    return { storyboard: result, appliedIndexes: [...new Set(appliedIndexes)] };
  }

  function promptText(segment = {}, options = {}) {
    const includeMeta = options.includeMeta !== false;
    if (!text(segment.imagePrompt)) return "";
    if (!includeMeta) return text(segment.imagePrompt);
    return [
      `${text(segment.clipId) || `CLIP-${String(segment.shot || 1).padStart(2, "0")}`}｜${text(segment.timeRange) || "关键帧"}`,
      `取帧时刻：${text(segment.imagePromptMoment)}`,
      `一致性锚点：${text(segment.imagePromptAnchor)}`,
      `图片提示词：${text(segment.imagePrompt)}`,
    ].join("\n");
  }

  function allPromptText(storyboard = []) {
    return storyboard.map((segment) => promptText(segment)).filter(Boolean).join("\n\n----------------\n\n");
  }

  return { PROMPT_FIELDS, shouldInvalidateForField, invalidateSegment, targetIndexes, mergePrompts, promptText, allPromptText };
});
