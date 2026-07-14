(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoGenerationClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function create(options = {}) {
    const apiClient = options.apiClient;
    const sleep = options.sleep || ((ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)));

    function request(path, payload) {
      return apiClient.request(path, payload);
    }

    async function resolveJob(response, label) {
      if (!response?.async || !response.jobId) return response;
      const startedAt = Date.now();
      for (let attempt = 0; attempt < 180; attempt += 1) {
        await sleep(attempt < 2 ? 1200 : 2000);
        const job = await request(`/api/job?id=${encodeURIComponent(response.jobId)}`);
        if (job.status === "done") {
          return { ok: true, source: job.source || response.source, model: job.model || response.model, result: job.result };
        }
        if (job.status === "error") {
          const error = new Error(job.error || `${label}生成失败`);
          error.code = job.code || "JOB_ERROR";
          throw error;
        }
        options.onProgress?.({ label, seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)) });
      }
      const error = new Error(`${label}仍在生成中，请稍后重试或缩短输入。`);
      error.code = "JOB_TIMEOUT";
      throw error;
    }

    return { request, resolveJob };
  }

  return { create };
});
