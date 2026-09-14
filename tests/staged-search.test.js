"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { MemoryCache, RedisCache, CACHE_TTL_MS } = require("../lib/cache");
const { createSearchHandler, validateInput, cacheKey } = require("../lib/search-handler");
const { researchStage, normalizeStage, academicWindow, evidenceOf, instructions, schemas } = require("../lib/staged-research");
const { renderResearch, emptyResult } = require("../assets/app");

const input = { schoolType: "4년제", university: "서울대학교", major: "정치외교학부", admissionTrack: "일반전형" };
const now = new Date("2026-09-14T03:00:00Z");
const window = academicWindow(now);
const office = "https://admission.snu.ac.kr/undergraduate/early/guide";
const guide = "https://admission.snu.ac.kr/materials/guides/guides?bbsidx=170741&md=v";
const past = "https://admission.snu.ac.kr/materials/downloads/samples?bbsidx=167141&md=v";
const results = "https://admission.snu.ac.kr/materials/stats/result";
const bad = "https://fabricated.example.edu/results";
const sources = [
  { title: "2027 수시모집 안내", url: guide, sourceType: "A", year: 2027 },
  { title: "2026 면접 및 구술고사 문항", url: past, sourceType: "A", year: 2026 },
  { title: "전형결과", url: results, sourceType: "A", year: 2026 },
  { title: "허위 출처", url: bad, sourceType: "A", year: 2026 }
];
const admission = { year: 2026, status: "found", ...Object.fromEntries(["capacity", "applicants", "competitionRate", "additionalAdmits", "additionalRank", "registeredAverage", "cut50", "cut70", "studentRecordGrade", "convertedScore", "calculationBasis"].map((name) => [name, null])), sourceName: "전형결과", sourceUrl: results, sourceType: "A", notes: "" };
function overview() { return { officialOffice: { title: "서울대학교 입학본부", url: office }, guide: { title: "2027 수시모집 안내", url: guide, year: 2027 }, interviewOverview: { summary: "제시문 기반 면접", interviewType: "구술고사", sourceUrls: [guide], notes: [] }, latestQuestions: [{ question: "공식 PDF에서 확인한 질문", interviewType: "구술", questionCategory: "교과개념", sourceType: "A", sourceName: "면접 및 구술고사 문항", sourceUrl: past }, { question: "허위 질문", interviewType: null, questionCategory: "시사", sourceType: "A", sourceName: "허위", sourceUrl: bad }], admissionResults: { ...admission, capacity: "10명", applicants: "50명" }, sources }; }
function provider(raw, urls = [office, guide, past, results]) { return { status: "completed", output: [{ type: "web_search_call", status: "completed", action: { type: "search", sources: urls.map((url) => ({ url })) } }, { type: "message", content: [{ type: "output_text", text: JSON.stringify(raw), annotations: [] }] }] }; }
function mockRes() { return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(text = "") { this.body = text; } }; }
async function request(handler, changes = {}) { const req = { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: input, ...changes }; const res = mockRes(); await handler(req, res); return res; }

test("SNU regression query targets official admissions, latest guide, questions and results", () => {
  const prompt = instructions("overview", input, window, now, null);
  for (const value of ["서울대학교", "정치외교학부", "일반전형", "2027", "2026", "입학처", "모집요강", "구술", "전형결과"]) assert.ok(prompt.includes(value));
  assert.ok(instructions("questions", input, window, now, "admission.snu.ac.kr").includes("site:admission.snu.ac.kr"));
  assert.deepEqual(window.years, [2026, 2025, 2024, 2023, 2022]);
});
test("each Responses request uses web search, stage model and 53s deadline", async () => {
  const prior = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-only";
  try {
    for (const stage of ["overview", "questions", "reviews"]) {
      let payload;
      const raw = stage === "overview" ? overview() : stage === "questions" ? { groups: [], sources: [] } : { reviews: [], tips: [], sources: [] };
      await researchStage(stage, input, { now, getDomain: async () => null, fetchImpl: async (endpoint, options) => {
        assert.equal(endpoint, "https://api.openai.com/v1/responses");
        assert.equal(options.headers.Authorization, "Bearer test-only");
        assert.equal(options.signal.aborted, false);
        payload = JSON.parse(options.body);
        return { ok: true, json: async () => provider(raw) };
      } });
      assert.equal(payload.model, stage === "reviews" ? "gpt-5.6-terra" : "gpt-5.6-luna");
      assert.equal(payload.tools[0].type, "web_search"); assert.equal(payload.tool_choice, "required");
      assert.equal(payload.text.format.strict, true); assert.equal(payload.store, false);
      assert.ok(payload.include.includes("web_search_call.action.sources"));
    }
  } finally { if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior; }
});
test("one unverified URL drops only that source and question", () => {
  const data = normalizeStage("overview", overview(), evidenceOf(provider(overview())), input, window, now, null);
  assert.equal(data.officialOffice.domain, "admission.snu.ac.kr");
  assert.equal(data.guide.url, guide);
  assert.equal(data.latestQuestions.length, 1);
  assert.equal(data.admissionResults.capacity, "10명");
  assert.equal(data.admissionResults.cut70, null);
  assert.ok(!data.sources.some((source) => source.url === bad));
});
test("unverified admission source removes metrics, preserves interview overview", () => {
  const raw = overview(); raw.admissionResults.sourceUrl = bad;
  const data = normalizeStage("overview", raw, evidenceOf(provider(raw)), input, window, now, null);
  assert.equal(data.admissionResults.status, "not_found"); assert.equal(data.admissionResults.capacity, null);
  assert.equal(data.interviewOverview.interviewType, "구술고사");
});
test("question years stay separate and repeated trends require two years", () => {
  const q = overview().latestQuestions[0];
  const raw = { groups: [{ year: 2026, items: [q] }, { year: 2025, items: [{ ...q, sourceUrl: "https://admission.snu.ac.kr/2025" }] }], sources: [sources[1], { ...sources[1], url: "https://admission.snu.ac.kr/2025", year: 2025 }] };
  const data = normalizeStage("questions", raw, evidenceOf(provider(raw, [past, "https://admission.snu.ac.kr/2025"])), input, window, now, "admission.snu.ac.kr");
  assert.equal(data.questions[0].items.length, 1); assert.equal(data.questions[1].items.length, 1);
  assert.equal(data.trends.length, 1);
});
test("input, CORS, stage identity and 30-day cache", async () => {
  assert.equal(validateInput(input).university, "서울대학교");
  assert.throws(() => validateInput({ ...input, major: "<script>" }));
  assert.notEqual(cacheKey(input, "model", now.getTime(), "overview"), cacheKey(input, "model", now.getTime(), "questions"));
  let ticks = 0; const cache = new MemoryCache({ now: () => ticks }); await cache.set("key", { found: true });
  ticks = CACHE_TTL_MS; assert.equal(await cache.get("key"), null);
  let count = 0;
  const handler = createSearchHandler("overview", { research: async () => { count++; return { ok: true }; }, now: () => now.getTime() });
  const a = await request(handler), b = await request(handler);
  assert.equal(a.statusCode, 200); assert.equal(b.headers["x-search-cache"], "HIT"); assert.equal(count, 1);
  assert.equal((await request(handler, { method: "GET" })).statusCode, 405);
  assert.equal((await request(handler, { headers: { host: "localhost:3000", origin: "https://other.example", "content-type": "application/json" } })).statusCode, 403);
});
test("shared Redis cache keeps stage results across instances and tolerates outages", async () => {
  const records = new Map();
  const fetchImpl = async (_, options) => {
    const [verb, key, value] = JSON.parse(options.body);
    if (verb === "GET") return { ok: true, json: async () => ({ result: records.get(key) || null }) };
    if (verb === "SET") { records.set(key, value); return { ok: true, json: async () => ({ result: "OK" }) }; }
    if (verb === "DEL") { records.delete(key); return { ok: true, json: async () => ({ result: 1 }) }; }
    throw new Error("unknown command");
  };
  const options = { url: "https://redis.example", token: "unit-only", namespace: "questions", now: () => 1000, fetchImpl };
  const first = new RedisCache(options), second = new RedisCache(options);
  await first.set("snu", { count: 5 });
  assert.deepEqual((await second.get("snu")).value, { count: 5 });
  await second.delete("snu");
  assert.equal(await first.get("missing"), null);
  const broken = new RedisCache({ ...options, fetchImpl: async () => { throw new Error("offline"); } });
  await broken.set("key", { ok: true });
  assert.deepEqual((await broken.get("key")).value, { ok: true });
});
test("frontend renders overview before parallel extras and retains it after reviews failure", async () => {
  const elements = new Map();
  const element = (id) => { if (!elements.has(id)) elements.set(id, { value: "", innerHTML: "", listeners: {}, setAttribute() {}, reportValidity: () => true, addEventListener(name, fn) { this.listeners[name] = fn; } }); return elements.get(id); };
  element("university").value = input.university; element("major").value = input.major; element("track").value = input.admissionTrack;
  const results = normalizeStage("overview", overview(), evidenceOf(provider(overview())), input, window, now, null);
  let releaseQuestions, rejectReviews;
  const fetchMock = async (route, options) => {
    assert.deepEqual(JSON.parse(options.body), input);
    if (route === "/api/search-overview") return { ok: true, headers: { get: (key) => key === "content-type" ? "application/json" : null }, json: async () => results };
    if (route === "/api/search-questions") return new Promise((resolve) => { releaseQuestions = resolve; });
    if (route === "/api/search-reviews") return new Promise((_, reject) => { rejectReviews = reject; });
    throw new Error("unexpected route");
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assets/app.js"), "utf8"), { document: { getElementById: element, querySelectorAll: () => [] }, fetch: fetchMock, AbortController, AbortSignal, URL, setTimeout, clearTimeout });
  const pending = element("search-form").listeners.submit({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(element("results").innerHTML.includes("2027 수시모집 안내"));
  assert.ok(element("results").innerHTML.includes("10명"));
  assert.ok(element("results").innerHTML.includes("최근 5개년 기출 조사 중"));
  rejectReviews(new Error("reviews unavailable"));
  releaseQuestions({ ok: true, headers: { get: (key) => key === "content-type" ? "application/json" : null }, json: async () => ({ questions: results.latestQuestions.length ? [{ year: 2026, note: "", items: results.latestQuestions }] : [], trends: [], sources: [] }) });
  await pending;
  assert.ok(element("results").innerHTML.includes("10명"));
  assert.ok(element("results").innerHTML.includes("공개 면접후기를 추가로 확인하지 못했습니다."));
});
test("renderer escapes source content", () => {
  const state = emptyResult(input); state.interviewOverview.summary = '<img src=x onerror=alert(1)>';
  const html = renderResearch(state, null, null, {});
  assert.ok(html.includes("&lt;img")); assert.ok(!html.includes("<img src"));
});
