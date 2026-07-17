import { cp, copyFile, mkdir, rm } from "node:fs/promises";

const files = [
  "index.html",
  "_headers",
  "styles.css",
  "app.js",
  "generator.js",
  "workflow-core.js",
  "script-revision.js",
  "storyboard-revision.js",
  "image-prompt-workflow.js",
  "quick-workflow.js",
  "quick-mode-ui.js",
  "creative-quality.js",
  "comedy-mechanism.js",
  "performance-learning.js",
  "project-domain.js",
  "episode-bible.js",
  "episode-planner.js",
  "ui-templates.js",
  "api-client.js",
  "data-store.js",
  "archive-sync.js",
  "app-state.js",
  "creation-session.js",
  "ai-operation.js",
  "generation-client.js",
];

await rm("public", { recursive: true, force: true });
await mkdir("public", { recursive: true });

await Promise.all(files.map((file) => copyFile(file, `public/${file}`)));
await cp("assets", "public/assets", { recursive: true });
await cp("vendor", "public/vendor", { recursive: true });
