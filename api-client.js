(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoApiClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function create(options = {}) {
    const timeoutMs = Number(options.timeoutMs || 90_000);
    const accessCodeKey = options.accessCodeKey || "roco-shortdrama-access-code";
    const fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
    const storage = options.storage || globalThis.localStorage;
    const promptForAccess = options.promptForAccess || globalThis.prompt?.bind(globalThis);

    function accessHeaders(payload) {
      const headers = payload ? { "Content-Type": "application/json" } : {};
      const code = storage?.getItem(accessCodeKey);
      if (code) headers["X-Roco-Access-Code"] = code;
      return headers;
    }

    async function fetchApi(path, payload) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(path, {
          method: payload ? "POST" : "GET",
          headers: accessHeaders(payload),
          body: payload ? JSON.stringify(payload) : undefined,
          signal: controller.signal,
        });
      } catch (error) {
        if (error?.name === "AbortError") {
          const timeoutError = new Error(`AI 请求超过 ${Math.round(timeoutMs / 1000)} 秒，已自动取消。请缩短输入后重试。`);
          timeoutError.code = "REQUEST_TIMEOUT";
          throw timeoutError;
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }

      const raw = await response.text();
      let data;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (_) {
        const invalidError = new Error(`服务返回了无法解析的内容（${response.status}）`);
        invalidError.code = "INVALID_API_RESPONSE";
        throw invalidError;
      }
      if (!response.ok || data.ok === false) {
        const error = new Error(data.error || `请求失败：${response.status}`);
        error.code = data.code;
        error.retryAfter = data.retryAfter;
        throw error;
      }
      return data;
    }

    async function request(path, payload) {
      try {
        return await fetchApi(path, payload);
      } catch (error) {
        if (error.code !== "ACCESS_CODE_REQUIRED" || !promptForAccess) throw error;
        const code = promptForAccess("请输入访问码。这个工具会调用你的付费 AI API，请不要把访问码发给不需要使用的人。");
        if (!code) throw error;
        storage?.setItem(accessCodeKey, code.trim());
        return fetchApi(path, payload);
      }
    }

    return { request, fetchApi };
  }

  return { create };
});
