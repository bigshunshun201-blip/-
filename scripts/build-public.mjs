import { cp, copyFile, mkdir, rm } from "node:fs/promises";

const files = [
  "index.html",
  "styles.css",
  "app.js",
  "generator.js",
  "workflow-core.js",
  "project-domain.js",
  "episode-planner.js",
  "ui-templates.js",
  "api-client.js",
  "data-store.js",
  "archive-sync.js",
  "app-state.js",
  "ai-operation.js",
  "generation-client.js",
];

await rm("public", { recursive: true, force: true });
await mkdir("public", { recursive: true });

await Promise.all(files.map((file) => copyFile(file, `public/${file}`)));
await cp("assets", "public/assets", { recursive: true });
