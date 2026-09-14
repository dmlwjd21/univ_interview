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

module.exports = { MemoryCache, CACHE_TTL_MS };
