"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const skip = new Set([".git", ".vercel", "node_modules", "public", "__pycache__"]);
let js = 0, json = 0;
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.name.startsWith(".env")) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith(".js")) { execFileSync(process.execPath, ["--check", file]); js++; }
    else if (entry.name.endsWith(".json")) { JSON.parse(fs.readFileSync(file, "utf8")); json++; }
  }
}
walk(root);
console.log("Syntax OK: " + js + " JavaScript files; JSON OK: " + json + " files");
