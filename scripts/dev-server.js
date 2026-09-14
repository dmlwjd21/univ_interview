"use strict";
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const handlers = {
  "/api/search-overview": require("../api/search-overview"),
  "/api/search-questions": require("../api/search-questions"),
  "/api/search-reviews": require("../api/search-reviews")
};
const root = path.resolve(__dirname, "..");
const routes = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/assets/app.js": ["assets/app.js", "text/javascript; charset=utf-8"],
  "/assets/style.css": ["assets/style.css", "text/css; charset=utf-8"]
};
http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (handlers[pathname]) return handlers[pathname](req, res);
  const route = routes[pathname];
  if (!route || !["GET", "HEAD"].includes(req.method)) { res.writeHead(404); return res.end("Not found"); }
  try {
    const data = await fs.readFile(path.join(root, route[0]));
    res.writeHead(200, { "Content-Type": route[1], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch { res.writeHead(500); res.end("Unable to read page"); }
}).listen(Number(process.env.PORT || 3000), "127.0.0.1", () => {
  console.log("Local app: http://localhost:" + (process.env.PORT || 3000));
});
