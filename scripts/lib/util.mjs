import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const DATA = path.join(ROOT, "data");
export const CACHE = path.join(ROOT, ".cache");

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
  console.log(`  ✓ ${path.relative(ROOT, file)} (${Array.isArray(value) ? value.length + " items" : Object.keys(value).length + " keys"})`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UA = "univ-interview-bot/1.0 (+https://github.com/dmlwjd21/univ_interview) educational-research";

/** Disk cache so re-runs don't re-hit upstream. Keyed by URL hash. */
function cachePath(url, ext) {
  const key = createHash("sha1").update(url).digest("hex").slice(0, 20);
  return path.join(CACHE, ext === "bin" ? "bin" : "txt", `${key}.${ext}`);
}

/**
 * Polite fetch: disk cache, retries with backoff, 429-aware, shared user-agent.
 * `cache: false` bypasses the disk cache; `raw: true` returns a Buffer.
 */
export async function get(url, { retries = 4, timeout = 30000, headers = {}, raw = false, cache = true } = {}) {
  const file = cachePath(url, raw ? "bin" : "txt");
  if (cache && fs.existsSync(file)) {
    return raw ? fs.readFileSync(file) : fs.readFileSync(file, "utf8");
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA, ...headers } });
      clearTimeout(timer);
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt);
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = raw ? Buffer.from(await res.arrayBuffer()) : await res.text();
      if (cache) {
        ensureDir(path.dirname(file));
        fs.writeFileSync(file, body);
      }
      return body;
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) {
        console.warn(`  ! ${url} — ${err.message}`);
        return null;
      }
      await sleep(400 * 2 ** attempt);
    }
  }
  return null;
}

/** Runs `worker` over `items` with bounded concurrency, preserving order. */
export async function mapLimit(items, limit, worker, { gap = 0 } = {}) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i], i);
      if (gap) await sleep(gap);
    }
  });
  await Promise.all(runners);
  return out;
}

export function slugify(name) {
  return name
    .replace(/\s+/g, "")
    .replace(/[()·・]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** 최근 N개 학년도. 선행학습 영향평가 보고서는 전형 실시 이듬해 3월경 공개된다. */
export function admissionYears(count = 5) {
  const now = new Date();
  const latest = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: count }, (_, i) => latest - i);
}
