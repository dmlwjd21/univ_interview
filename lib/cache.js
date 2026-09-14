"use strict";

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Adapter contract: async get(key) -> { value, expiresAt } | null;
// async set(key, value, ttlMs); async delete(key). Replace this class with a
// durable provider without changing the research or HTTP handler.
class MemoryCache {
  constructor({ now = Date.now, maxEntries = 100 } = {}) {
    this.now = now;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }
  async get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry);
  }
  async set(key, value, ttlMs = CACHE_TTL_MS) {
    this.entries.delete(key);
    for (const [oldKey, entry] of this.entries) {
      if (entry.expiresAt <= this.now()) this.entries.delete(oldKey);
    }
    while (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
    this.entries.set(key, { value: structuredClone(value), expiresAt: this.now() + ttlMs });
  }
  async delete(key) { this.entries.delete(key); }
}

// Optional shared cache for Vercel instances. Upstash's REST API accepts Redis
// commands as JSON arrays; failures fall back to the in-process cache.
class RedisCache {
  constructor({ url, token, namespace, now = Date.now, maxEntries = 100, fetchImpl = fetch } = {}) {
    this.url = url.replace(/\/$/, "");
    this.token = token;
    this.namespace = namespace;
    this.now = now;
    this.fetchImpl = fetchImpl;
    this.memory = new MemoryCache({ now, maxEntries });
  }
  async command(parts) {
    const response = await this.fetchImpl(this.url, { method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }, body: JSON.stringify(parts), signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error("CACHE_UNAVAILABLE");
    const body = await response.json();
    if (body.error) throw new Error("CACHE_UNAVAILABLE");
    return body.result;
  }
  key(key) { return `univ-interview:${this.namespace}:${key}`; }
  async get(key) {
    const local = await this.memory.get(key);
    if (local) return local;
    try {
      const raw = await this.command(["GET", this.key(key)]);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry || entry.expiresAt <= this.now()) return null;
      await this.memory.set(key, entry.value, entry.expiresAt - this.now());
      return structuredClone(entry);
    } catch { return null; }
  }
  async set(key, value, ttlMs = CACHE_TTL_MS) {
    await this.memory.set(key, value, ttlMs);
    const entry = { value, expiresAt: this.now() + ttlMs };
    try { await this.command(["SET", this.key(key), JSON.stringify(entry), "EX", Math.ceil(ttlMs / 1000)]); }
    catch { /* A remote cache outage must not fail an otherwise valid search. */ }
  }
  async delete(key) {
    await this.memory.delete(key);
    try { await this.command(["DEL", this.key(key)]); } catch {}
  }
}
function createCache({ namespace, now = Date.now, maxEntries = 100 } = {}) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? new RedisCache({ url, token, namespace, now, maxEntries }) : new MemoryCache({ now, maxEntries });
}

module.exports = { MemoryCache, RedisCache, createCache, CACHE_TTL_MS };
