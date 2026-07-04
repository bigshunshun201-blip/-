import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";

let corePromise;

const jobsStore = getStore({ name: "roco-ai-jobs", consistency: "strong" });

function jobKey(id) {
  return `job:${id}`;
}

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

function requestAccessCode(headers) {
  return headers.get("x-roco-access-code") || "";
}

async function createAiJob(req, core, kind, input) {
  const jobId = randomUUID();
  const createdAt = new Date().toISOString();
  await jobsStore.setJSON(jobKey(jobId), {
    id: jobId,
    kind,
    status: "queued",
    createdAt,
    updatedAt: createdAt,
  });

  const workerUrl = new URL("/api/run-job", req.url);
  const workerResponse = await fetch(workerUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-roco-access-code": requestAccessCode(req.headers),
    },
    body: JSON.stringify({ jobId, kind, input }),
  });

  if (!workerResponse.ok) {
    await jobsStore.setJSON(jobKey(jobId), {
      id: jobId,
      kind,
      status: "error",
      createdAt,
      updatedAt: new Date().toISOString(),
      error: `后台生成任务启动失败：${workerResponse.status}`,
      code: "JOB_START_FAILED",
    });
    return json({ ok: false, error: `后台生成任务启动失败：${workerResponse.status}`, code: "JOB_START_FAILED" }, 500);
  }

  return json({
    ok: true,
    async: true,
    jobId,
    status: "queued",
    source: core.provider,
    model: core.modelForRequest(input),
  }, 202);
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

    if (req.method === "GET" && url.pathname === "/api/job") {
      if (!core.hasApiAccess(req.headers)) {
        return json({ ok: false, error: "请输入访问码", code: "ACCESS_CODE_REQUIRED" }, 401);
      }
      const jobId = url.searchParams.get("id") || "";
      if (!jobId) return json({ ok: false, error: "缺少任务 ID", code: "JOB_ID_REQUIRED" }, 400);
      const job = await jobsStore.get(jobKey(jobId), { type: "json" });
      if (!job) return json({ ok: false, error: "没有找到生成任务", code: "JOB_NOT_FOUND" }, 404);
      return json({ ok: true, ...job });
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
      return createAiJob(req, core, "script", input);
    }

    if (req.method === "POST" && url.pathname === "/api/storyboard") {
      if (!core.hasApiAccess(req.headers)) {
        return json({ ok: false, error: "请输入访问码", code: "ACCESS_CODE_REQUIRED" }, 401);
      }
      const payload = await req.json().catch(() => ({}));
      const input = payload.input || payload;
      return createAiJob(req, core, "storyboard", input);
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
  path: ["/api/status", "/api/job", "/api/generate", "/api/script", "/api/storyboard", "/api/topics"],
};
