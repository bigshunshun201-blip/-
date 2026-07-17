(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoComedyMechanism = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const requiredFields = ["phrase", "mechanismType", "setup", "misdirection", "payoff", "visualAction", "plotEffect", "fitBeat", "fitTraits", "risk", "forbidden"];
  function list(value, limit = 8) { return [...new Set((Array.isArray(value) ? value : String(value || "").split(/[,，、\n]/)).map((item) => String(item || "").trim()).filter(Boolean))].slice(0, limit); }
  function normalize(value = {}) {
    const source = value && typeof value === "object" ? value : {};
    const setup = String(source.setup || "").trim();
    const misdirection = String(source.misdirection || "").trim();
    const payoff = String(source.payoff || "").trim();
    return {
      ...source,
      phrase: String(source.phrase || source.name || "").trim(),
      sourceType: String(source.sourceType || "手动录入").trim(),
      sourceNote: String(source.sourceNote || "").trim(),
      mechanismType: String(source.mechanismType || "").trim(),
      mechanism: String(source.mechanism || "").trim(),
      setup, misdirection, payoff,
      comedy: String(source.comedy || [setup, misdirection, payoff].filter(Boolean).join(" -> ")).trim(),
      visualAction: String(source.visualAction || "").trim(),
      plotEffect: String(source.plotEffect || "").trim(),
      fitBeat: String(source.fitBeat || source.fit || "").trim(),
      fitTraits: String(source.fitTraits || "").trim(),
      risk: String(source.risk || "").trim(),
      forbidden: String(source.forbidden || "").trim(),
      tags: list(source.tags),
      useCount: Math.max(0, Number(source.useCount || 0)),
    };
  }
  function isComplete(value = {}) { const item = normalize(value); return requiredFields.every((field) => item[field]); }
  function withStatus(value = {}) { const item = normalize(value); return { ...item, needsEnrichment: !isComplete(item) }; }
  return { requiredFields, normalize, isComplete, withStatus };
});
