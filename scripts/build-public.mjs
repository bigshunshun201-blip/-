import { copyFile, mkdir, rm } from "node:fs/promises";

const files = ["index.html", "styles.css", "app.js", "generator.js"];

await rm("public", { recursive: true, force: true });
await mkdir("public", { recursive: true });

await Promise.all(files.map((file) => copyFile(file, `public/${file}`)));
