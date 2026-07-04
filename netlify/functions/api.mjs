let corePromise;

async function loadCore() {
  if (!corePromise) {
    for (const key of ["AI_PROVIDER", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL", "DEEPSEEK_BASE_URL", "APP_ACCESS_CODE"]) {
      const value = globalThis.Netlify?.env?.get?.(key);
      if (value) process.env[key] = value;
    }
    corePromise = import("../../server.js").then((module) => module.default || module);
  }
  return corePromise;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function errorStatus(error) {
  return ["NO_PROVIDER", "NO_API_KEY", "NO_DEEPSEEK_KEY"].includes(error?.code) ? 400 : 500;
}

export default async (req) => {
  try {
    const core = await loadCore();
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/api/status") {
      if (!core.hasApiAccess(req.headers)) {
        return json({ ok: false, error: "请输入访问码", code: "ACCESS_CODE_REQUIRED" }, 401);
      }
      const aiConnected = await core.providerHealth();
      return json({
        ok: true,
        aiConnected,
        provider: core.provider,
        model: core.activeModel(),
        availableModels: core.provider === "deepseek" ? ["deepseek-v4-flash", "deepseek-v4-pro"] : [core.activeModel()],
        message: aiConnected ? "AI connected" : "AI not connected",
      });
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      if (!core.hasApiAccess(req.headers)) {
        return json({ ok: false, error: "请输入访问码", code: "ACCESS_CODE_REQUIRED" }, 401);
      }
      const payload = await req.json().catch(() => ({}));
      const input = payload.input || payload;
      const result = await core.generateWithProvider(input);
      return json({ ok: true, source: core.provider, model: core.modelForRequest(input), result });
    }

    if (req.method === "POST" && url.pathname === "/api/script") {
      if (!core.hasApiAccess(req.headers)) {
        return json({ ok: false, error: "请输入访问码", code: "ACCESS_CODE_REQUIRED" }, 401);
      }
      const payload = await req.json().catch(() => ({}));
      const input = payload.input || payload;
      const result = await core.generateScriptWithProvider(input);
      return json({ ok: true, source: core.provider, model: core.modelForRequest(input), result });
    }

    if (req.method === "POST" && url.pathname === "/api/storyboard") {
      if (!core.hasApiAccess(req.headers)) {
        return json({ ok: false, error: "请输入访问码", code: "ACCESS_CODE_REQUIRED" }, 401);
      }
      const payload = await req.json().catch(() => ({}));
      const input = payload.input || payload;
      const result = await core.generateStoryboardWithProvider(input);
      return json({ ok: true, source: core.provider, model: core.modelForRequest(input), result });
    }

    if (req.method === "POST" && url.pathname === "/api/topics") {
      if (!core.hasApiAccess(req.headers)) {
        return json({ ok: false, error: "请输入访问码", code: "ACCESS_CODE_REQUIRED" }, 401);
      }
      const payload = await req.json().catch(() => ({}));
      const input = payload.input || payload;
      const result = await core.generateTopicsWithProvider(input);
      return json({ ok: true, source: core.provider, model: core.modelForRequest(input), result });
    }

    return json({ ok: false, error: "Not found" }, 404);
  } catch (error) {
    return json({ ok: false, error: error.message, code: error.code || "SERVER_ERROR" }, errorStatus(error));
  }
};

export const config = {
  path: ["/api/status", "/api/generate", "/api/script", "/api/storyboard", "/api/topics"],
};
