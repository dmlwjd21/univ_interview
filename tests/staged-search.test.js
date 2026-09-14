"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { MemoryCache, RedisCache, CACHE_TTL_MS } = require("../lib/cache");
const { createSearchHandler, validateInput, cacheKey } = require("../lib/search-handler");
const { researchStage, normalizeStage, academicWindow, evidenceOf, instructions, schemas } = require("../lib/staged-research");
const { resolveSearch, normalizeResolution, prompt: resolvePrompt, similarity } = require("../lib/resolve-search");
const { renderResearch, renderResolution, emptyResult } = require("../assets/app");

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
function resolutionRaw({ tracks = ["일반전형", "지역균형전형"], majors = ["컴퓨터공학부"], university = "서울대학교", schoolType = "4년제" } = {}) {
  return {
    officialOffice: { name: university, url: office, schoolType }, guide: { title: "2027학년도 수시모집 안내", url: guide, year: 2027 }, trackCoverageComplete: true,
    universityCandidates: [{ name: university, sourceUrl: guide, semanticScore: 0.98, schoolType, campus: null, aliases: [] }],
    majorCandidates: majors.map((name, index) => ({ name, sourceUrl: guide, semanticScore: index ? 0.74 : 0.97, aliases: [] })),
    trackCandidates: tracks.map((name, index) => ({ name, sourceUrl: guide, semanticScore: index ? 0.90 : 0.92, appliesToMajor: true, interview: "yes", category: "학생부종합", aliases: [] })),
    sources: [{ title: "2027학년도 수시모집 안내", url: guide, sourceType: "A", year: 2027 }]
  };
}
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
test("official resolution preserves input, handles SNU abbreviations and leaves broad tracks for selection", () => {
  const raw = resolutionRaw();
  const cases = [
    [{ university: "서울대", major: "컴공", admissionTrack: "학종" }, "서울대학교", "컴퓨터공학부", null],
    [{ university: "서울대학교", major: "컴퓨터공학", admissionTrack: "일반" }, "서울대학교", "컴퓨터공학부", "일반전형"],
    [{ university: "서울대학교", major: "컴퓨터공학부", admissionTrack: "일반전형" }, "서울대학교", "컴퓨터공학부", "일반전형"]
  ];
  for (const [changes, university, major, track] of cases) {
    const submitted = { ...input, ...changes };
    const result = normalizeResolution(raw, evidenceOf(provider(raw)), submitted, now);
    assert.equal(result.original.major, changes.major);
    assert.equal(result.resolved.university, university);
    assert.equal(result.resolved.major, major);
    assert.equal(result.resolved.admissionTrack, track);
    assert.equal(result.guide.url, guide);
    assert.equal(result.candidates.tracks.length, 2);
  }
  assert.ok(similarity("컴퓨터공학", "컴퓨터공학부") > similarity("화학", "컴퓨터공학부"));
});
test("resolution keeps campus ambiguity and corrects school type only when configured", () => {
  const raw = resolutionRaw({ university: "한양대학교" });
  raw.universityCandidates.push({ name: "한양대학교 ERICA", sourceUrl: guide, semanticScore: 0.97, schoolType: "4년제", campus: "ERICA", aliases: [] });
  const result = normalizeResolution(raw, evidenceOf(provider(raw)), { ...input, university: "한양대" }, now);
  assert.equal(result.resolved.university, null);
  assert.equal(result.candidates.universities.length, 2);
  const duplicateNames = resolutionRaw({ university: "한양대학교" });
  duplicateNames.universityCandidates[0].campus = "서울캠퍼스";
  duplicateNames.universityCandidates.push({ name: "한양대학교", sourceUrl: guide, semanticScore: 0.97, schoolType: "4년제", campus: "ERICA", aliases: [] });
  const separate = normalizeResolution(duplicateNames, evidenceOf(provider(duplicateNames)), { ...input, university: "한양대" }, now);
  assert.equal(separate.candidates.universities.length, 2);
  assert.equal(separate.resolved.university, null);
  const college = resolutionRaw({ university: "동양미래대학교", schoolType: "전문대", tracks: ["면접전형"] });
  const corrected = normalizeResolution(college, evidenceOf(provider(college)), { ...input, university: "동양미래대학교", schoolType: "4년제", admissionTrack: "면접전형" }, now);
  assert.equal(corrected.resolved.schoolType, "전문대");
  assert.ok(corrected.notes.some((note) => note.includes("학교 유형")));
  const prior = process.env.RESOLVE_SCHOOL_TYPE_AUTO_CORRECT;
  process.env.RESOLVE_SCHOOL_TYPE_AUTO_CORRECT = "false";
  try {
    const fixed = normalizeResolution(college, evidenceOf(provider(college)), { ...input, university: "동양미래대학교", schoolType: "4년제", admissionTrack: "면접전형" }, now);
    assert.equal(fixed.resolved.schoolType, "4년제");
    assert.ok(fixed.notes.some((note) => note.includes("자동 보정하지")));
  } finally { if (prior === undefined) delete process.env.RESOLVE_SCHOOL_TYPE_AUTO_CORRECT; else process.env.RESOLVE_SCHOOL_TYPE_AUTO_CORRECT = prior; }
});
test("generic resolver handles abbreviation examples without a university-specific dictionary", () => {
  const cases = [
    ["연대", "연세대학교", "컴퓨터과학과", "활동우수형", "4년제"],
    ["이대", "이화여자대학교", "인공지능학과", "미래인재전형", "4년제"],
    ["부산대", "부산대학교", "화학과", "학생부종합전형", "4년제"],
    ["동양미래대", "동양미래대학교", "컴퓨터소프트웨어공학과", "면접전형", "전문대"],
    ["인하공전", "인하공업전문대학", "항공운항과", "면접전형", "전문대"]
  ];
  for (const [short, official, major, track, schoolType] of cases) {
    const raw = resolutionRaw({ university: official, schoolType, majors: [major], tracks: [track] });
    const submitted = { schoolType, university: short, major, admissionTrack: track };
    const data = normalizeResolution(raw, evidenceOf(provider(raw)), submitted, now);
    assert.equal(data.resolved.university, official, short);
    assert.equal(data.resolved.major, major, short);
    assert.equal(data.resolved.admissionTrack, track, short);
  }
});
test("typos can resolve when official evidence is strong; low confidence remains a choice", () => {
  const raw = resolutionRaw({ tracks: ["일반전형"] });
  const typo = normalizeResolution(raw, evidenceOf(provider(raw)), { ...input, university: "서울대학교교" }, now);
  assert.equal(typo.resolved.university, "서울대학교");
  raw.majorCandidates[0].semanticScore = 0.2;
  const uncertain = normalizeResolution(raw, evidenceOf(provider(raw)), { ...input, major: "AI" }, now);
  assert.equal(uncertain.resolved.major, null);
  assert.equal(uncertain.candidates.majors[0].name, "컴퓨터공학부");
});
test("broad track stays unresolved when the official track list was not fully checked", () => {
  const raw = resolutionRaw({ tracks: ["일반전형"] });
  raw.trackCoverageComplete = false;
  const result = normalizeResolution(raw, evidenceOf(provider(raw)), { ...input, admissionTrack: "학종" }, now);
  assert.equal(result.resolved.admissionTrack, null);
  assert.equal(result.candidates.tracks[0].name, "일반전형");
});
test("verified official guide still resolves candidates when office homepage URL is missing", () => {
  const raw = resolutionRaw({ tracks: ["일반전형"] });
  raw.officialOffice.url = "https://unseen.snu.ac.kr/";
  const data = normalizeResolution(raw, evidenceOf(provider(raw)), { ...input, major: "컴공" }, now);
  assert.equal(data.officialOffice, null);
  assert.equal(data.guide.url, guide);
  assert.equal(data.resolved.major, "컴퓨터공학부");
});
test("unverified candidate is excluded; verified historic names pass into questions prompt", () => {
  const raw = resolutionRaw({ tracks: ["일반전형"] });
  raw.majorCandidates[0].aliases = [{ name: "컴퓨터공학과", sourceUrl: guide }, { name: "가짜과", sourceUrl: bad }];
  raw.universityCandidates[0].aliases = [{ name: "옛 대학명", sourceUrl: guide }];
  raw.trackCandidates[0].aliases = [{ name: "옛 전형명", sourceUrl: guide }];
  raw.trackCandidates.push({ name: "다른 학과 전형", sourceUrl: guide, semanticScore: 1, appliesToMajor: false, interview: "yes", category: "학생부종합", aliases: [] });
  raw.majorCandidates.push({ name: "가짜학과", sourceUrl: bad, semanticScore: 1, aliases: [] });
  const result = normalizeResolution(raw, evidenceOf(provider(raw)), { ...input, major: "컴공" }, now);
  assert.deepEqual(result.aliases.major, ["컴퓨터공학과"]);
  assert.deepEqual(result.aliases.university, ["옛 대학명"]);
  assert.deepEqual(result.aliases.admissionTrack, ["옛 전형명"]);
  assert.ok(!result.candidates.majors.some((candidate) => candidate.name === "가짜학과"));
  assert.ok(!result.candidates.tracks.some((candidate) => candidate.name === "다른 학과 전형"));
  const prompt = instructions("questions", { ...result.resolved, aliases: result.aliases }, window, now, "admission.snu.ac.kr");
  for (const value of ["컴퓨터공학과", "옛 전형명", "옛 대학명", "선행학습 영향평가", "면접 및 구술고사 문항"]) assert.ok(prompt.includes(value));
});
test("resolution API calls Responses Web Search and stage cache uses resolved names", async () => {
  const prior = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-only";
  try {
    let payload;
    const raw = resolutionRaw({ tracks: ["일반전형"] });
    const submitted = { ...input, university: "서울대", major: "컴공", admissionTrack: "일반" };
    const result = await resolveSearch("resolve", submitted, { now, fetchImpl: async (endpoint, options) => {
      assert.equal(endpoint, "https://api.openai.com/v1/responses");
      assert.equal(options.headers.Authorization, "Bearer test-only");
      payload = JSON.parse(options.body);
      return { ok: true, json: async () => provider(raw) };
    } });
    assert.equal(payload.tools[0].type, "web_search");
    assert.equal(payload.tool_choice, "required");
    assert.ok(payload.instructions.includes("최신 수시 모집요강"));
    assert.ok(payload.instructions.includes("서울대"));
    assert.equal(result.resolved.major, "컴퓨터공학부");
    const canonical = { ...result.resolved };
    assert.equal(cacheKey(canonical, "fast", now.getTime(), "questions"), cacheKey({ ...canonical, aliases: { major: ["컴퓨터공학과"] } }, "fast", now.getTime(), "questions"));
    assert.deepEqual(validateInput({ ...canonical, aliases: { major: ["컴퓨터공학과"] } }).aliases.major, ["컴퓨터공학과"]);
  } finally { if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior; }
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
    const sent = JSON.parse(options.body);
    for (const key of ["schoolType", "university", "major", "admissionTrack"]) assert.equal(sent[key], input[key]);
    if (route === "/api/resolve-search") return { ok: true, headers: { get: (key) => key === "content-type" ? "application/json" : null }, json: async () => ({
      original: input, resolved: input, candidates: { universities: [], majors: [], tracks: [] }, notes: [], aliases: { university: [], major: [], admissionTrack: [] }, guide: { title: "2027 수시모집 안내", url: guide }
    }) };
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
test("frontend offers track candidates before overview and preserves original terms", () => {
  const original = { schoolType: "4년제", university: "서울대", major: "컴공", admissionTrack: "학종" };
  const raw = resolutionRaw();
  const resolved = normalizeResolution(raw, evidenceOf(provider(raw)), original, now);
  const html = renderResolution(resolved, original);
  assert.ok(html.includes("서울대 / 컴공 / 학종"));
  assert.ok(html.includes("서울대학교 / 컴퓨터공학부 / 전형 선택 필요"));
  assert.ok(html.includes("일반전형")); assert.ok(html.includes("지역균형전형"));
  assert.ok(html.includes("공식 명칭으로 자동 보정됨"));
});
for (const [group, field, selectedName] of [
  ["universities", "university", "서울대학교"],
  ["majors", "major", "컴퓨터공학부"],
  ["tracks", "admissionTrack", "일반전형"]
]) test(`${group} candidate button resumes canonical search and renders overview`, async () => {
  const original = { schoolType: "4년제", university: "서울대", major: "컴공", admissionTrack: "학종" };
  const canonical = { schoolType: "4년제", university: "서울대학교", major: "컴퓨터공학부", admissionTrack: "일반전형" };
  const elements = new Map();
  const element = (id) => { if (!elements.has(id)) elements.set(id, { value: "", innerHTML: "", listeners: {}, setAttribute() {}, reportValidity: () => true, addEventListener(name, fn) { this.listeners[name] = fn; } }); return elements.get(id); };
  element("university").value = original.university; element("major").value = original.major; element("track").value = original.admissionTrack;
  const firstResolution = {
    original, resolved: { ...canonical, [field]: null },
    candidates: { universities: [], majors: [], tracks: [], [group]: [{ name: selectedName }, ...(group === "tracks" ? [{ name: "지역균형전형" }] : [])] },
    notes: [], aliases: { university: [], major: [], admissionTrack: [] }, guide: { title: "2027 수시모집 안내", url: guide }
  };
  const routes = [], requests = [];
  let finishSecondResolve;
  const response = (data) => ({ ok: true, headers: { get: (name) => name === "content-type" ? "application/json" : null }, json: async () => data });
  const fetchMock = (route, options) => {
    routes.push(route);
    requests.push(JSON.parse(options.body));
    if (route === "/api/resolve-search") return routes.filter((item) => item === route).length === 1 ?
      Promise.resolve(response(firstResolution)) : new Promise((resolve) => { finishSecondResolve = () => resolve(response({ ...firstResolution, resolved: canonical })); });
    if (route === "/api/search-overview") {
      const raw = overview();
      return Promise.resolve(response(normalizeStage("overview", raw, evidenceOf(provider(raw)), canonical, window, now, "admission.snu.ac.kr")));
    }
    if (route === "/api/search-questions") return Promise.resolve(response({ questions: [], trends: [], sources: [] }));
    if (route === "/api/search-reviews") return Promise.resolve(response({ reviews: [], tips: [], sources: [] }));
    throw new Error("unexpected route");
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assets/app.js"), "utf8"), { document: { getElementById: element, querySelectorAll: () => [] }, fetch: fetchMock, AbortController, AbortSignal, URL, setTimeout, clearTimeout });
  await element("search-form").listeners.submit({ preventDefault() {} });
  assert.deepEqual(routes, ["/api/resolve-search"]);
  const html = element("results").innerHTML;
  assert.ok(html.includes("서울대 / 컴공 / 학종"));
  if (group === "tracks") assert.ok(html.includes("지역균형전형"));
  const buttonMarkup = [...html.matchAll(/<button\b[^>]*class="[^"]*resolve-choice[^"]*"[^>]*>[^<]*<\/button>/g)]
    .map((match) => match[0]).find((markup) => markup.includes(`data-value="${selectedName}"`));
  assert.ok(buttonMarkup, `rendered ${group} candidate button missing`);
  const attribute = (name) => new RegExp(`${name}="([^"]*)"`).exec(buttonMarkup)?.[1];
  assert.equal(attribute("data-group"), group);
  assert.equal(attribute("data-field"), field);
  assert.equal(attribute("aria-pressed"), "false");
  element("results").listeners.click({ target: { closest: () => ({ dataset: { group, field, value: "확인되지 않은 후보" } }) } });
  assert.deepEqual(routes, ["/api/resolve-search"]);
  const button = { dataset: { group: attribute("data-group"), field: attribute("data-field"), value: attribute("data-value") } };
  element("results").listeners.click({ target: { closest: () => button } });
  assert.deepEqual(routes, ["/api/resolve-search", "/api/resolve-search"]);
  assert.deepEqual(requests[1], canonical);
  assert.ok(element("results").innerHTML.includes("resolve-choice active"));
  assert.ok(element("results").innerHTML.includes('aria-pressed="true"'));
  assert.ok(element("results").innerHTML.includes(`✓ ${selectedName}을(를) 선택했습니다`));
  assert.ok(element("results").innerHTML.includes("조사 진행 상황"));
  finishSecondResolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(routes, ["/api/resolve-search", "/api/resolve-search", "/api/search-overview", "/api/search-questions", "/api/search-reviews"]);
  assert.deepEqual(requests[2], { ...canonical, aliases: firstResolution.aliases });
  assert.ok(element("results").innerHTML.includes("1. 면접 개요"));
  assert.ok(element("results").innerHTML.includes("제시문 기반 면접"));
  assert.ok(element("results").innerHTML.includes("서울대 / 컴공 / 학종"));
  assert.ok(element("results").innerHTML.includes("서울대학교 / 컴퓨터공학부 / 일반전형"));
});
test("renderer escapes source content", () => {
  const state = emptyResult(input); state.interviewOverview.summary = '<img src=x onerror=alert(1)>';
  const html = renderResearch(state, null, null, {});
  assert.ok(html.includes("&lt;img")); assert.ok(!html.includes("<img src"));
});
