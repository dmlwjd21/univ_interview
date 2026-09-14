"use strict";

const { createHash } = require("node:crypto");
const { createCache, CACHE_TTL_MS } = require("./cache");
const { researchStage, academicWindow, VERSION } = require("./staged-research");

function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function validateInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw httpError(400, "검색 조건은 JSON 객체로 보내 주세요.");
  const keys = ["schoolType", "university", "major", "admissionTrack"];
  if (Object.keys(body).some((key) => !keys.includes(key))) throw httpError(400, "지원하지 않는 검색 항목이 있습니다.");
  const input = {};
  for (const key of keys) {
    if (typeof body[key] !== "string" || /[\u0000-\u001f\u007f<>]/.test(body[key])) throw httpError(400, "대학·학과·전형을 올바르게 입력해 주세요.");
    input[key] = body[key].normalize("NFKC").replace(/\s+/g, " ").trim();
    if (!input[key] || input[key].length > 120) throw httpError(400, "각 검색 항목은 1~120자로 입력해 주세요.");
  }
  if (!["4년제", "전문대"].includes(input.schoolType)) throw httpError(400, "학교 유형은 4년제 또는 전문대여야 합니다.");
  return input;
}

async function readBody(req) {
  if (Number(req.headers["content-length"] || 0) > 4096) throw httpError(413, "검색 요청이 너무 큽니다.");
  let raw = req.body;
  if (raw === undefined) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 4096) throw httpError(413, "검색 요청이 너무 큽니다.");
      chunks.push(bytes);
    }
    raw = Buffer.concat(chunks).toString("utf8");
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString("utf8");
  if (Buffer.byteLength(typeof raw === "string" ? raw : JSON.stringify(raw) || "", "utf8") > 4096) throw httpError(413, "검색 요청이 너무 큽니다.");
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { throw httpError(400, "JSON 형식이 올바르지 않습니다."); }
  }
  return raw;
}

function applyCors(req, res) {
  res.setHeader("Vary", "Origin");
  const origin = req.headers.origin;
  if (!origin) return; // Non-browser clients are supported; CORS is not authentication.
  const protocol = (req.headers["x-forwarded-proto"] || (req.socket?.encrypted ? "https" : "http")).split(",")[0].trim();
  const sameOrigin = `${protocol}://${req.headers.host}`;
  const allowed = new Set((process.env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean));
  allowed.add(sameOrigin);
  if (!allowed.has(origin)) throw httpError(403, "허용되지 않은 출처의 요청입니다.");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "X-Search-Cache, X-Cache-Expires");
}

function cacheKey(input, model, now, stage = "overview") {
  return createHash("sha256").update(JSON.stringify([
    VERSION, stage, model, academicWindow(new Date(now)).admissionYear,
    ...["schoolType", "university", "major", "admissionTrack"].map((key) => input[key].toLocaleLowerCase("ko"))
  ])).digest("hex");
}

function createSearchHandler(stage, { research = researchStage, now = Date.now, cache = createCache({ namespace: stage, now }) } = {}) {
  if (!["overview", "questions", "reviews"].includes(stage)) throw new Error("UNKNOWN_SEARCH_STAGE");
  const pending = new Map();
  const rateLimits = new Map();
  function limit(req) {
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0];
    const time = now();
    for (const [key, entry] of rateLimits) if (entry.expiresAt <= time) rateLimits.delete(key);
    const entry = rateLimits.get(ip) || { count: 0, expiresAt: time + 3600000 };
    if (entry.count >= 10 || pending.size >= 4) throw httpError(429, "검색 요청이 많습니다. 잠시 후 다시 시도해 주세요.");
    if (rateLimits.size >= 2000 && !rateLimits.has(ip)) throw httpError(429, "검색 요청이 많습니다. 잠시 후 다시 시도해 주세요.");
    entry.count++;
    rateLimits.set(ip, entry);
  }
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      applyCors(req, res);
      if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST, OPTIONS");
        throw httpError(405, "POST 요청만 사용할 수 있습니다.");
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) throw httpError(415, "Content-Type을 application/json으로 보내 주세요.");
      const input = validateInput(await readBody(req));
      const model = stage === "reviews" ? process.env.OPENAI_MODEL_ANALYSIS || "gpt-5.6-terra" : process.env.OPENAI_MODEL_FAST || "gpt-5.6-luna";
      const key = cacheKey(input, model, now(), stage);
      let entry = await cache.get(key);
      let cacheStatus = "HIT";
      if (!entry) {
        cacheStatus = pending.has(key) ? "COALESCED" : "MISS";
        if (!pending.has(key)) {
          limit(req);
          const promise = (async () => {
            const value = await research(stage, input, { model, now: new Date(now()) });
            await cache.set(key, value, CACHE_TTL_MS);
            return { value, expiresAt: now() + CACHE_TTL_MS };
          })();
          pending.set(key, promise);
          // Handle rejection without leaving a rejected cleanup promise.
          promise.then(() => pending.delete(key), () => pending.delete(key));
        }
        entry = await pending.get(key);
      }
      res.setHeader("X-Search-Cache", cacheStatus);
      res.setHeader("X-Cache-Expires", new Date(entry.expiresAt).toISOString());
      res.statusCode = 200;
      res.end(JSON.stringify(entry.value));
    } catch (error) {
      let status = error.status || 502;
      let message = error.status ? error.message : "조사 결과를 확인하지 못했습니다. 잠시 후 다시 검색해 주세요.";
      if (error.message === "MISSING_API_KEY") { status = 503; message = "실시간 검색 서버의 API 키가 설정되지 않았습니다. 관리자에게 문의해 주세요."; }
      if (error.message === "UPSTREAM_CONFIGURATION") { status = 503; message = "검색 모델 또는 API 접근 설정을 확인해야 합니다. 관리자에게 문의해 주세요."; }
      if (error.message === "UPSTREAM_RATE_LIMIT") { status = 429; message = "검색 서비스의 사용량 한도에 도달했습니다. 잠시 후 다시 시도해 주세요."; }
      if (["TimeoutError", "AbortError"].includes(error.name)) { status = 504; message = "조사 시간이 초과되었습니다. 잠시 후 다시 검색해 주세요."; }
      if (status === 429) res.setHeader("Retry-After", "60");
      res.statusCode = status;
      res.end(JSON.stringify({ error: { message } }));
    }
  };
}

module.exports = { createSearchHandler, validateInput, cacheKey };
