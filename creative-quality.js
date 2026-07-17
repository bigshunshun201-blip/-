(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoCreativeQuality = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const dimensions = ["hook", "freshness", "comedy", "visual", "characterFit", "reversal", "serialValue"];
  const labels = { hook: "开头抓力", freshness: "新鲜度", comedy: "喜剧机制", visual: "画面表现力", characterFit: "角色适配", reversal: "反转质量", serialValue: "连载价值" };
  const baseWeights = { hook: 0.18, freshness: 0.18, comedy: 0.14, visual: 0.15, characterFit: 0.13, reversal: 0.12, serialValue: 0.10 };

  function clean(value) { return String(value || "").replace(/\s+/g, "").toLowerCase(); }
  function textOfPlan(option = {}) { return [option.angle, option.title, option.why, option.innovation, option.memeMechanic, option.visualSetpiece, ...Object.values(option.plan || {})].join("|"); }
  function bigrams(value, ignore = []) {
    let source = clean(value);
    ignore.map(clean).filter(Boolean).sort((a, b) => b.length - a.length).forEach((term) => { source = source.split(term).join(""); });
    const chars = [...source].filter((char) => /[\p{Script=Han}a-z0-9]/u.test(char));
    const grams = new Set();
    for (let index = 0; index < chars.length - 1; index += 1) grams.add(chars[index] + chars[index + 1]);
    return grams;
  }
  function jaccard(left, right) {
    const a = left instanceof Set ? left : bigrams(left);
    const b = right instanceof Set ? right : bigrams(right);
    if (!a.size && !b.size) return 0;
    let overlap = 0;
    a.forEach((item) => { if (b.has(item)) overlap += 1; });
    return overlap / (a.size + b.size - overlap || 1);
  }
  function clamp(value) { return Math.max(0, Math.min(10, Math.round(value * 10) / 10)); }
  function hits(text, terms) { return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0); }
  function scoreOption(option = {}, context = {}) {
    const text = textOfPlan(option);
    const plan = option.plan || {};
    const history = Array.isArray(context.history) ? context.history.slice(0, 40) : [];
    const ignore = context.creationMode === "continue" ? [...(context.roleNames || []), context.sourceHook || ""] : [];
    const sourceGrams = bigrams(text, ignore);
    let nearest = { similarity: 0, title: "" };
    history.forEach((item) => {
      const similarity = jaccard(sourceGrams, bigrams(item.text || item.summary || item.title || "", ignore));
      if (similarity > nearest.similarity) nearest = { similarity, title: String(item.title || "历史内容") };
    });
    const opening = String(plan.openingHook || "");
    const visual = String(option.visualSetpiece || "");
    const comedy = String(option.memeMechanic || "");
    const reversal = String(plan.reversal || "");
    const relation = String(plan.relationshipShift || "");
    const hook = String(plan.endingSuspense || "");
    const scores = {
      hook: clamp(4 + Math.min(3, opening.length / 28) + hits(opening, ["突然", "只剩", "当场", "却", "消失", "倒计时", "裂开"]) * 0.6),
      freshness: clamp(9 - nearest.similarity * 7 + Math.min(1.5, String(option.innovation || "").length / 35)),
      comedy: clamp(2.5 + Math.min(3, comedy.length / 30) + hits(comedy, ["铺垫", "误导", "回扣", "动作", "道具", "规则", "反差"]) * 0.55),
      visual: clamp(3 + Math.min(3, visual.length / 30) + hits(visual, ["前景", "中景", "后景", "竖屏", "同时", "变", "炸", "裂", "倒"]) * 0.45),
      characterFit: clamp(3.5 + Math.min(2.5, relation.length / 32) + hits(text, context.roleNames || []) * 0.7 + hits(text, ["欲望", "弱点", "底线", "选择"]) * 0.5),
      reversal: clamp(3 + Math.min(3, reversal.length / 32) + hits(reversal, ["其实", "真正", "原来", "并非", "不是", "才是", "因为"]) * 0.55),
      serialValue: clamp(3.5 + Math.min(3, hook.length / 28) + hits(hook, ["下一集", "必须", "追查", "到底", "谁", "为何", "坐标"]) * 0.45),
    };
    const weights = { ...baseWeights, ...(context.weights || {}) };
    const total = Math.round(dimensions.reduce((sum, key) => sum + scores[key] * (weights[key] || 0), 0) * 10);
    const duplicateLevel = nearest.similarity >= 0.72 ? "high" : nearest.similarity >= 0.55 ? "similar" : "clear";
    return { scores, weights, total, nearest: { ...nearest, similarity: Math.round(nearest.similarity * 100) / 100 }, duplicateLevel, scoredAt: new Date().toISOString() };
  }
  function scorePlans(plans = [], context = {}) { return plans.map((option) => ({ ...option, quality: scoreOption(option, context), qualityStatus: "scored" })); }
  return { dimensions, labels, baseWeights, bigrams, jaccard, textOfPlan, scoreOption, scorePlans };
});
