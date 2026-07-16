const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 8765);
const appAccessCode = process.env.APP_ACCESS_CODE || "";
const localAccessCode = appAccessCode || "local-development";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
};
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

let cloudflareWorkerPromise;

function send(res, status, body, type = "application/json; charset=utf-8", headers = {}) {
  res.writeHead(status, { ...securityHeaders, "Content-Type": type, "Cache-Control": "no-store", ...headers });
  res.end(Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2_100_000) {
        req.destroy();
        reject(new Error("请求体超过本地服务限制"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handleSharedDeepSeekApi(req, res, url) {
  cloudflareWorkerPromise ||= import("./cloudflare/worker.mjs");
  const worker = await cloudflareWorkerPromise;
  const headers = new Headers();
  Object.entries(req.headers || {}).forEach(([name, value]) => {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(",") : String(value));
  });
  if (!appAccessCode) headers.set("x-roco-access-code", localAccessCode);
  const body = req.method === "POST" ? await readBody(req) : undefined;
  const request = new Request(`http://local.roco${url.pathname}${url.search}`, {
    method: req.method,
    headers,
    body,
  });
  const response = await worker.default.fetch(request, {
    APP_ACCESS_CODE: localAccessCode,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "",
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    DAILY_AI_UNIT_LIMIT: process.env.DAILY_AI_UNIT_LIMIT || "120",
  });
  const raw = Buffer.from(await response.arrayBuffer());
  const forwardedHeaders = {};
  for (const name of ["retry-after"]) {
    const value = response.headers.get(name);
    if (value) forwardedHeaders[name] = value;
  }
  send(res, response.status, raw, response.headers.get("content-type") || "application/json; charset=utf-8", forwardedHeaders);
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const resolved = path.resolve(root, `.${pathname}`);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }
  fs.readFile(resolved, (error, data) => {
    if (error) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    send(res, 200, data, mime[path.extname(resolved).toLowerCase()] || "application/octet-stream");
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleSharedDeepSeekApi(req, res, url);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    send(res, 500, { ok: false, error: error.message, code: error.code || "SERVER_ERROR" });
  }
});

if (require.main === module) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`Rock Kingdom Short Drama Studio: http://127.0.0.1:${port}`);
    console.log(`DeepSeek: ${process.env.DEEPSEEK_API_KEY ? "configured" : "not configured"}`);
  });
}

module.exports = { server, handleSharedDeepSeekApi, serveStatic };
