"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { MemoryCache, CACHE_TTL_MS } = require("../lib/cache");
const { createSearchHandler, validateInput, cacheKey } = require("../lib/search-handler");
const { researchWeb, validateResearch, academicWindow } = require("../lib/research");
const { schema, assertSchema, metricFields } = require("../lib/research-schema");
const { renderResearch, safeUrl } = require("../assets/app");

const input = { schoolType: "4년제", university: "테스트대학교", major: "간호학과", admissionTrack: "학생부종합 일반전형" };
const date = new Date("2026-09-14T03:00:00Z");
const window = academicWindow(date);
const url = "https://admission.example.edu/results";
function fixture() {
  return {
    university: input.university, major: input.major, admissionTrack: input.admissionTrack, searchedAt: date.toISOString(),
    interviewOverview: { admissionYear: window.admissionYear, status: "unknown", summary: "자료 확인 중", interviewType: null, sourceUrls: [], notes: [] },
    questions: window.years.map((year) => ({ year, note: "자료 없음", items: [] })),
    trends: [], reviews: [], tips: [],
    admissionResults: {
      year: window.resultsYear, status: "not_found", ...Object.fromEntries(metricFields.map((key) => [key, null])),
      sourceName: null, sourceUrl: null, sourceType: null, notes: "공개 수치를 찾지 못함"
    },
    sources: []
  };
}
function provider(result, urls = []) {
  return {
    status: "completed",
    output: [
      { type: "web_search_call", status: "completed", action: { type: "search", sources: urls.map((url) => ({ type: "url", url })) } },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(result), annotations: [] }] }
    ]
  };
}
function addQuestion(result, year = window.years[0]) {
  result.sources = [{ title: "공식 면접 자료", url, sourceType: "A", year }];
  result.questions.find((group) => group.year === year).items.push({
    question: "탐구 활동에서 배운 점은 무엇인가요?", interviewType: "서류 기반",
    questionCategory: "학생부 활동", sourceType: "A", sourceName: "공식 면접 자료", sourceUrl: url
  });
}
function responseMock() {
  return { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(text = "") { this.body = text; } };
}
async function request(handler, changes = {}) {
  const req = { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: input, ...changes };
  const res = responseMock();
  await handler(req, res);
  return res;
}

test("schema is strict and missing or unexpected fields are rejected", () => {
  assertSchema(fixture());
  const result = fixture();
  delete result.admissionResults.cut50;
  assert.throws(() => assertSchema(result), /Missing/);
  const strict = (spec) => {
    if (spec.type === "object") {
      assert.equal(spec.additionalProperties, false);
      assert.deepEqual(spec.required, Object.keys(spec.properties));
      Object.values(spec.properties).forEach(strict);
    }
    if (spec.type === "array") strict(spec.items);
  };
  strict(schema);
});
test("input accepts arbitrary university, normalizes whitespace and rejects invalid values", () => {
  assert.equal(validateInput({ ...input, university: "  또다른대학교  " }).university, "또다른대학교");
  for (const body of [null, [], { ...input, schoolType: "기타" }, { ...input, major: " " },
    { ...input, university: "<script>" }, { ...input, admissionTrack: "a".repeat(121) }, { ...input, model: "x" }]) {
    assert.throws(() => validateInput(body));
  }
});
test("academic window explicitly targets previous admissions year across March rollover", () => {
  assert.equal(academicWindow(new Date("2026-02-01T00:00:00Z")).resultsYear, 2025);
  assert.deepEqual(window.years, [2026, 2025, 2024, 2023, 2022]);
});
test("OpenAI call uses Responses, requested model default, mandatory live web search and strict JSON", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = "unit-test-only";
  delete process.env.OPENAI_MODEL;
  try {
    let sent;
    await researchWeb(input, { now: date, fetchImpl: async (endpoint, options) => {
      sent = JSON.parse(options.body);
      assert.equal(endpoint, "https://api.openai.com/v1/responses");
      assert.equal(options.headers.Authorization, "Bearer unit-test-only");
      return { ok: true, json: async () => provider(fixture()) };
    } });
    assert.equal(sent.model, "gpt-5.6-terra");
    assert.deepEqual(sent.tools, [{ type: "web_search", external_web_access: true }]);
    assert.equal(sent.tool_choice, "required");
    assert.equal(sent.text.format.strict, true);
    assert.equal(sent.text.format.type, "json_schema");
    assert.equal(sent.store, false);
    assert.ok(sent.include.includes("web_search_call.action.sources"));
    assert.ok(sent.instructions.includes("전년도 입시결과"));
    process.env.OPENAI_MODEL = "configured-model";
    await researchWeb(input, { now: date, fetchImpl: async (_, options) => {
      assert.equal(JSON.parse(options.body).model, "configured-model");
      return { ok: true, json: async () => provider(fixture()) };
    } });
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = originalModel;
  }
});
test("no web call, incomplete output, malformed JSON and fabricated sources are rejected", () => {
  const result = fixture();
  addQuestion(result);
  assert.throws(() => validateResearch(provider(result), input, window, date), /UNGROUNDED/);
  assert.throws(() => validateResearch({ ...provider(result, [url]), status: "incomplete" }, input, window, date), /INCOMPLETE/);
  assert.throws(() => validateResearch({ status: "completed", output: [] }, input, window, date), /WEB_SEARCH/);
  const broken = provider(result, [url]);
  broken.output[1].content[0].text = "not JSON";
  assert.throws(() => validateResearch(broken, input, window, date));
});
test("question references, years and official absence claims are checked", () => {
  const result = fixture();
  addQuestion(result);
  result.questions[0].items[0].sourceUrl = "https://unseen.example.edu/";
  assert.throws(() => validateResearch(provider(result, [url]), input, window, date), /MISSING_SOURCE/);
  const noInterview = fixture();
  noInterview.interviewOverview.status = "not_required_official";
  assert.throws(() => validateResearch(provider(noInterview), input, window, date), /UNSOURCED/);
  const wrong = fixture();
  wrong.admissionResults.year--;
  assert.throws(() => validateResearch(provider(wrong), input, window, date), /WRONG_RESULTS_YEAR/);
});
test("unknown admission values stay null; trends require multiple actual years", () => {
  const result = fixture();
  addQuestion(result);
  result.admissionResults.capacity = "999"; // not_found cannot retain an invented metric.
  result.trends = [{ topic: "시사", years: [2026, 2025], summary: "Unsupported", sourceUrls: [url] }];
  const one = validateResearch(provider(result, [url]), input, window, date);
  assert.equal(one.admissionResults.capacity, null);
  assert.equal(one.trends.length, 0);
  addQuestion(result, 2025);
  const two = validateResearch(provider(result, [url]), input, window, date);
  assert.equal(two.trends.length, 1);
  assert.deepEqual(two.trends[0].years, [2026, 2025]);
});
test("published zero admission value and basis survive with official source", () => {
  const result = fixture();
  result.sources = [{ title: "입결", url, sourceType: "A", year: 2026 }];
  Object.assign(result.admissionResults, { status: "found", additionalAdmits: "0명",
    calculationBasis: "최종등록자 기준", sourceName: "입결", sourceUrl: url, sourceType: "A" });
  const data = validateResearch(provider(result, [url]), input, window, date);
  assert.equal(data.admissionResults.additionalAdmits, "0명");
  assert.equal(data.admissionResults.cut70, null);
});
test("30-day cache expires exactly and clones stored values", async () => {
  let time = 1000;
  const cache = new MemoryCache({ now: () => time, maxEntries: 2 });
  await cache.set("a", { count: 1 });
  (await cache.get("a")).value.count = 4;
  assert.equal((await cache.get("a")).value.count, 1);
  time += CACHE_TTL_MS - 1;
  assert.ok(await cache.get("a"));
  time++;
  assert.equal(await cache.get("a"), null);
  await cache.set("b", {});
  await cache.set("c", {});
  await cache.set("d", {});
  assert.equal(await cache.get("b"), null);
});
test("cache identity separates model, school type and academic year", () => {
  const key = cacheKey(input, "model1", date.getTime());
  assert.notEqual(key, cacheKey(input, "model2", date.getTime()));
  assert.notEqual(key, cacheKey({ ...input, schoolType: "전문대" }, "model1", date.getTime()));
  assert.notEqual(key, cacheKey(input, "model1", new Date("2027-09-14").getTime()));
});
test("HTTP cache hit and concurrent requests make only one research call", async () => {
  let count = 0;
  let release;
  const handler = createSearchHandler({ now: () => date.getTime(), research: async () => {
    count++;
    await new Promise((resolve) => { release = resolve; });
    return fixture();
  } });
  const first = request(handler);
  const second = request(handler);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(count, 1);
  assert.equal(a.statusCode, 200);
  assert.equal(b.headers["x-search-cache"], "COALESCED");
  const cached = await request(handler);
  assert.equal(cached.headers["x-search-cache"], "HIT");
  assert.equal(count, 1);
  assert.equal(JSON.parse(cached.body).searchedAt, date.toISOString());
});
test("failed research is not cached and provider details are not returned", async () => {
  let count = 0;
  const handler = createSearchHandler({ research: async () => { count++; throw new Error("PRIVATE_PROVIDER_DETAIL"); } });
  for (let i = 0; i < 2; i++) {
    const res = await request(handler);
    assert.equal(res.statusCode, 502);
    assert.ok(!res.body.includes("PRIVATE_PROVIDER_DETAIL"));
  }
  assert.equal(count, 2);
});
test("HTTP method, malformed JSON, size, content type and CORS checks happen before billing", async () => {
  let count = 0;
  const handler = createSearchHandler({ research: async () => { count++; return fixture(); } });
  assert.equal((await request(handler, { method: "GET" })).statusCode, 405);
  assert.equal((await request(handler, { body: "broken{" })).statusCode, 400);
  assert.equal((await request(handler, { body: "x".repeat(4097) })).statusCode, 413);
  assert.equal((await request(handler, { headers: { host: "localhost:3000", "content-type": "text/plain" } })).statusCode, 415);
  assert.equal((await request(handler, { headers: { host: "localhost:3000", origin: "https://untrusted.example" } })).statusCode, 403);
  const options = await request(handler, { method: "OPTIONS", headers: { host: "localhost:3000", origin: "http://localhost:3000" } });
  assert.equal(options.statusCode, 204);
  assert.equal(options.headers["access-control-allow-origin"], "http://localhost:3000");
  assert.equal(count, 0);
});
test("uncached requests are bounded per instance", async () => {
  const handler = createSearchHandler({ research: async () => fixture() });
  for (let i = 0; i < 10; i++) assert.equal((await request(handler, { body: { ...input, major: "학과" + i } })).statusCode, 200);
  const res = await request(handler, { body: { ...input, major: "학과10" } });
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers["retry-after"], "60");
});
test("renderer escapes model HTML, labels cached results and omits unpublished numbers", () => {
  const result = fixture();
  result.interviewOverview.summary = '<img src=x onerror="alert(1)">';
  const html = renderResearch(result, "HIT", date.toISOString());
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes("저장된 조사 결과"));
  assert.ok(html.includes("공개되지 않은 수치는 추정하지 않습니다"));
  assert.equal(safeUrl("javascript:alert(1)"), "");
});
test("form shows loading, sends all conditions, and renders request errors", async () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { value: "", innerHTML: "", listeners: {}, setAttribute() {},
      reportValidity: () => true, addEventListener(name, fn) { this.listeners[name] = fn; } });
    return elements.get(id);
  };
  element("university").value = "다른대학교";
  element("major").value = "다른학과";
  element("track").value = "일반전형";
  let rejectFetch;
  const context = {
    document: { getElementById: element, querySelectorAll: () => [] },
    URL, AbortController, setTimeout, clearTimeout,
    fetch: async (route, options) => {
      assert.equal(route, "/api/search");
      assert.deepEqual(JSON.parse(options.body), { schoolType: "4년제", university: "다른대학교", major: "다른학과", admissionTrack: "일반전형" });
      return new Promise((_, reject) => { rejectFetch = reject; });
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assets/app.js"), "utf8"), context);
  const pending = element("search-form").listeners.submit({ preventDefault() {} });
  assert.ok(element("results").innerHTML.includes("대학 입학처와 공개 자료를 조사하고 있습니다..."));
  rejectFetch(new Error("연결 실패"));
  await pending;
  assert.ok(element("results").innerHTML.includes("연결 실패"));
  assert.equal(element("search-fields").disabled, false);
});

