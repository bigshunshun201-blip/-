(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoPerformanceLearning = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const dimensions = ["hook", "freshness", "comedy", "visual", "characterFit", "reversal", "serialValue"];
  const baseWeights = { hook: 0.18, freshness: 0.18, comedy: 0.14, visual: 0.15, characterFit: 0.13, reversal: 0.12, serialValue: 0.10 };
  const outcomeWeights = { completion: 0.40, follow: 0.30, share: 0.15, comment: 0.10, favorite: 0.05 };
  function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, Number(value) || 0)); }
  function resultScore(review = {}) {
    const views = Math.max(0, Number(review.views || 0));
    if (!views) return null;
    const completion = clamp(Number(review.completionRate || 0) / 100);
    const follow = clamp((Number(review.follows || 0) / views) / 0.03);
    const share = clamp((Number(review.shares || 0) / views) / 0.05);
    const comment = clamp((Number(review.comments || 0) / views) / 0.05);
    const favorite = clamp((Number(review.favorites || 0) / views) / 0.10);
    return Math.round((completion * outcomeWeights.completion + follow * outcomeWeights.follow + share * outcomeWeights.share + comment * outcomeWeights.comment + favorite * outcomeWeights.favorite) * 1000) / 10;
  }
  function correlation(xs, ys) {
    if (xs.length < 2 || xs.length !== ys.length) return 0;
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let top = 0; let dx = 0; let dy = 0;
    xs.forEach((value, index) => { const x = value - mx; const y = ys[index] - my; top += x * y; dx += x * x; dy += y * y; });
    return dx && dy ? top / Math.sqrt(dx * dy) : 0;
  }
  function samplesFor(project = {}) {
    return (project.episodes || []).map((episode) => {
      const review = episode.review || {};
      const version = (episode.versions || []).find((item) => item.id === review.scriptVersionId) || (episode.versions || []).find((item) => item.id === episode.activeVersionId) || episode.versions?.at(-1);
      const scores = version?.creativeSourceRef?.scoreSnapshot?.scores;
      const outcome = resultScore(review);
      return scores && outcome != null ? { episodeNumber: episode.episodeNumber, scores, outcome } : null;
    }).filter(Boolean);
  }
  function learn(project = {}, previous = {}) {
    const samples = samplesFor(project);
    if (samples.length < 10) return { sampleCount: samples.length, confidence: 0, currentWeights: { ...(previous.currentWeights || baseWeights) }, correlations: {}, reasons: ["至少完成10集带创意来源的发布复盘后才会调整权重"], updatedAt: new Date().toISOString(), status: "collecting" };
    const outcomes = samples.map((item) => item.outcome);
    const correlations = Object.fromEntries(dimensions.map((key) => [key, Math.round(correlation(samples.map((item) => Number(item.scores[key] || 0)), outcomes) * 1000) / 1000]));
    const positive = Object.fromEntries(dimensions.map((key) => [key, Math.max(0.05, correlations[key] + 0.15)]));
    const totalPositive = Object.values(positive).reduce((sum, value) => sum + value, 0);
    const learned = Object.fromEntries(dimensions.map((key) => [key, positive[key] / totalPositive]));
    const confidence = clamp((samples.length - 9) / 11);
    const blend = Math.min(0.8, confidence * 0.8);
    const raw = Object.fromEntries(dimensions.map((key) => [key, baseWeights[key] * (1 - blend) + learned[key] * blend]));
    const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
    const currentWeights = Object.fromEntries(dimensions.map((key) => [key, Math.round((raw[key] / total) * 10000) / 10000]));
    const ordered = dimensions.slice().sort((a, b) => correlations[b] - correlations[a]);
    return {
      sampleCount: samples.length, confidence: Math.round(confidence * 100) / 100, currentWeights, correlations,
      reasons: [`${ordered[0]}与追更结果相关性最高（${correlations[ordered[0]]}）`, `权重仅融合${Math.round(blend * 100)}%真实数据，保留${Math.round((1 - blend) * 100)}%基础判断`],
      updatedAt: new Date().toISOString(), status: "learned",
    };
  }
  function update(project = {}) {
    const previous = project.creativeLearning || {};
    const next = learn(project, previous);
    const changed = JSON.stringify(previous.currentWeights || {}) !== JSON.stringify(next.currentWeights || {});
    const versions = Array.isArray(previous.versions) ? previous.versions : [];
    return { ...next, versions: changed ? [...versions, { ...next, versions: undefined, version: versions.length + 1 }].slice(-30) : versions };
  }
  return { dimensions, baseWeights, outcomeWeights, resultScore, correlation, samplesFor, learn, update };
});
