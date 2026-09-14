"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "public");
if (path.dirname(output) !== root || path.basename(output) !== "public") throw new Error("Invalid build path");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(path.join(root, "index.html"), path.join(output, "index.html"));
fs.mkdirSync(path.join(output, "assets"));
for (const name of ["app.js", "style.css"]) {
  fs.copyFileSync(path.join(root, "assets", name), path.join(output, "assets", name));
}
console.log("Built public/: index.html, assets/app.js, assets/style.css only");
