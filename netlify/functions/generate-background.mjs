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

async function updateJob(jobId, patch) {
  const existing = (await jobsStore.get(jobKey(jobId), { type: "json" })) || {};
  await jobsStore.setJSON(jobKey(jobId), {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

export default async (req) => {
  const core = await loadCore();
  let jobId = "";
  try {
    if (!core.hasApiAccess(req.headers)) return new Response(null, { status: 401 });
    const payload = await req.json().catch(() => ({}));
    jobId = String(payload.jobId || "");
    const kind = String(payload.kind || "");
    const input = payload.input || {};
    if (!jobId || !["script", "storyboard"].includes(kind)) return new Response(null, { status: 400 });

    await updateJob(jobId, { status: "running", kind, startedAt: new Date().toISOString() });
    const result =
      kind === "script"
        ? await core.generateScriptWithProvider(input)
        : await core.generateStoryboardWithProvider(input);

    await updateJob(jobId, {
      status: "done",
      completedAt: new Date().toISOString(),
      source: core.provider,
      model: core.modelForRequest(input),
      result,
    });
    return new Response(null, { status: 202 });
  } catch (error) {
    if (jobId) {
      await updateJob(jobId, {
        status: "error",
        error: error.message || "生成失败",
        code: error.code || "SERVER_ERROR",
      });
    }
    return new Response(null, { status: 202 });
  }
};

export const config = {
  path: "/api/run-job",
};
