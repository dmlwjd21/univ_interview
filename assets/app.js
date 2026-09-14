"use strict";

const EMPTY = "현재 수집된 자료가 없습니다. 실제 면접 실시 여부는 해당 대학 입학처 모집요강을 확인하세요.";
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
function link(url, text = "원문 보기") {
  const safe = safeUrl(url);
  return safe ? '<a href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + ' ↗</a>' : "";
}
function badge(type) {
  return '<span class="badge ' + esc(String(type || "").toLowerCase()) + '">' + esc({A:"A · 대학 공식",B:"B · 공공자료",C:"C · 응시후기"}[type] || "미확인") + '</span>';
}
const box = (content, cls = "card") => '<div class="' + cls + '">' + content + '</div>';
const section = (title, content) => '<section class="section"><h2>' + title + '</h2>' + content + '</section>';
const list = (items) => '<ul>' + items.map((item) => '<li>' + esc(item) + '</li>').join("") + '</ul>';
function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "확인일 미상" : date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}
function sourceLinks(urls, sources) {
  return urls.map((url) => link(url, sources.find((s) => s.url === url)?.title || "근거 자료")).join(" · ");
}
function progressList(progress) {
  const rows = [
    ["official", "대학 공식 입학처 확인"], ["guide", "최신 모집요강 확인"], ["admission", "전년도 입결 확인"],
    ["questions", "최근 5개년 기출 조사"], ["reviews", "공개 면접후기 조사"]
  ];
  return '<div class="progress card" role="status" aria-live="polite"><strong>조사 진행 상황</strong><ul>' + rows.map(([key, label]) => {
    const status = progress[key] || "waiting";
    const symbol = status === "done" ? "✓" : status === "loading" ? "●" : status === "failed" ? "!" : "○";
    return '<li class="progress-' + esc(status) + '"><span aria-hidden="true">' + symbol + '</span> ' + label +
      (status === "loading" ? " 중" : status === "failed" ? " 실패" : status === "waiting" ? " 예정" : "") + '</li>';
  }).join("") + '</ul></div>';
}
function renderResearch(data, cacheStatus, expiresAt, progress = {}) {
  const sources = [...data.sources].sort((a, b) => a.sourceType.localeCompare(b.sourceType));
  const overview = data.interviewOverview;
  const cached = cacheStatus === "HIT" || cacheStatus === "COALESCED";
  let html = progressList(progress) + box('<strong>' + (cached ? "저장된 조사 결과" : "새로 조사한 결과") + '</strong> · 조사일 ' + esc(dateLabel(data.searchedAt)) +
    '<div class="meta">' + (expiresAt ? '캐시 유효기간: ' + esc(dateLabel(expiresAt)) + '. ' : '') +
    'AI가 정리한 자료입니다. 지원 전 원문과 해당 학년도 모집요강을 확인하세요.</div>', "section notice");
  html += section("1. 면접 개요", box('<div class="intro"><div><h3>' + esc(data.university) + ' · ' + esc(data.major) + '</h3><p>' +
    esc(data.admissionTrack) + ' · ' + esc(overview.admissionYear) + '학년도 준비</p></div></div><p>' + esc(overview.summary) + '</p>' +
    (overview.interviewType ? '<p>면접 유형: ' + esc(overview.interviewType) + '</p>' : '') +
    (overview.notes.length ? list([...new Set(overview.notes)]) : '') +
    (data.officialOffice?.url ? '<p>공식 입학처: ' + link(data.officialOffice.url, data.officialOffice.title || "입학처") + '</p>' : '') +
    (data.guide?.url ? '<p>최신 모집요강: ' + link(data.guide.url, data.guide.title || "모집요강") + '</p>' : '') +
    (overview.sourceUrls.length ? '<div class="source">' + sourceLinks(overview.sourceUrls, sources) + '</div>' : '')));
  html += section("2. 최근 5개년 기출", (progress.questions === "failed" ? box("최근 5개년 기출을 추가로 확인하지 못했습니다. 기본 검색에서 확인한 최신 질문은 아래에 유지됩니다.", "empty") :
    progress.questions === "loading" ? box("최근 5개년 기출을 조사하고 있습니다. 기본 검색에서 확인한 최신 질문을 먼저 보여드립니다.", "empty") : "") + '<div class="stack">' + data.questions.map((group) => box(
    '<h3>' + esc(group.year) + '학년도</h3>' +
    (group.items.length ? group.items.map((item) => '<article class="question"><div class="badges">' + badge(item.sourceType) +
      '<span class="badge">' + esc(item.questionCategory) + '</span></div><p><strong>Q.</strong> ' + esc(item.question) + '</p>' +
      (item.interviewType ? '<p class="meta">면접 유형: ' + esc(item.interviewType) + '</p>' : '') +
      '<div class="source">' + link(item.sourceUrl, item.sourceName) + '</div></article>').join("") :
      '<p class="muted">' + EMPTY + '</p>') +
    (group.items.length && group.note ? '<p class="muted">' + esc(group.note) + '</p>' : ''), "card item")).join("") + '</div>');
  html += section("3. 반복 출제 경향", data.trends.length ? '<div class="stack">' + data.trends.map((trend) => box(
    '<strong>' + esc(trend.topic) + '</strong><p>' + esc(trend.summary) + '</p><p class="meta">' + trend.years.map(esc).join(" · ") +
    '학년도</p><div class="source">' + sourceLinks(trend.sourceUrls, sources) + '</div>')).join("") + '</div>' :
    box("여러 학년도에서 반복된 주제를 판단할 자료가 아직 충분하지 않습니다.", "empty"));
  const reviews = data.reviews.map((review) => {
    const fields = { atmosphere:"면접 분위기", interviewerCount:"면접관 수", duration:"면접 시간", questionFeatures:"질문 특징", followUpFeatures:"꼬리질문 특징" };
    return box('<h3>' + (review.year === null ? '학년도 미확인' : esc(review.year) + '학년도') + ' 후기 요약</h3>' +
      Object.entries(fields).map(([key, title]) => review[key] !== null ? '<p><strong>' + title + '</strong> · ' + esc(review[key]) + '</p>' : '').join("") +
      (review.preparationTips.length ? '<strong>준비 팁</strong>' + list(review.preparationTips) : '') +
      '<div class="source">' + badge(review.sourceType) + ' ' + link(review.sourceUrl, review.sourceName) + '</div>', "card item");
  }).join("");
  const tips = data.tips.map((tip) => box('<p>' + esc(tip.text) + '</p><div class="source">' + sourceLinks(tip.sourceUrls, sources) + '</div>')).join("");
  html += section("4. 면접 후기·준비 팁", progress.reviews === "failed" ? box("공개 면접후기를 추가로 확인하지 못했습니다.", "empty") :
    progress.reviews === "loading" ? box("공개 면접후기를 조사하고 있습니다.", "empty") : reviews || tips ? '<div class="stack">' + reviews + tips + '</div>' : box("확인된 공개 후기와 준비 팁이 없습니다.", "empty"));
  const admission = data.admissionResults;
  const fields = { capacity:"모집인원", applicants:"지원인원", competitionRate:"경쟁률", additionalAdmits:"충원합격 인원",
    additionalRank:"충원순위", registeredAverage:"최종등록자 평균", cut50:"50%컷", cut70:"70%컷",
    studentRecordGrade:"학생부 등급", convertedScore:"환산점수", calculationBasis:"환산점수·등급 산출 기준" };
  html += section('5. 전년도 입결 · ' + esc(admission.year) + '학년도', admission.status === "found" ? box(
    '<p>' + esc(data.university) + ' · ' + esc(data.major) + ' · ' + esc(data.admissionTrack) + '</p><div class="facts">' +
    Object.entries(fields).filter(([key]) => admission[key] != null).map(([key, title]) =>
      '<div class="fact"><span>' + title + '</span><strong>' + esc(admission[key]) + '</strong></div>').join("") +
    '</div><p class="muted">' + esc(admission.notes) + '</p><div class="source">' + badge(admission.sourceType) + ' ' +
    link(admission.sourceUrl, admission.sourceName) + '</div>') :
    box('해당 학년도·학과·전형의 입결을 확인하지 못했습니다. 공개되지 않은 수치는 추정하지 않습니다.' +
      (admission.notes ? '<p>' + esc(admission.notes) + '</p>' : ''), "empty"));
  html += section("6. 출처", sources.length ? box('<ol class="source-list">' + sources.map((source) =>
    '<li>' + badge(source.sourceType) + ' ' + link(source.url, source.title) + ' ' +
    (source.year !== null ? '<span class="meta">' + esc(source.year) + '학년도</span>' : '') + '</li>').join("") +
    '</ol>') : box("검색에서 사용할 수 있는 원문 출처를 찾지 못했습니다.", "empty"));
  return html;
}

function emptyResult(input) {
  const year = new Date().getFullYear() + 1;
  return { university: input.university, major: input.major, admissionTrack: input.admissionTrack, searchedAt: new Date().toISOString(),
    officialOffice: null, guide: null, interviewOverview: { admissionYear: year, summary: EMPTY, interviewType: null, sourceUrls: [], notes: [] },
    questions: [], trends: [], reviews: [], tips: [], admissionResults: { year: year - 1, status: "not_found", notes: "", sourceType: null }, sources: [] };
}
function mergeSources(current, incoming) {
  return [...new Map([...current, ...incoming].map((source) => [source.url, source])).values()];
}
function renderResolution(data, original) {
  const resolved = data.resolved || {};
  const changed = ["university", "major", "admissionTrack"].some((key) => resolved[key] && resolved[key] !== original[key]) ||
    resolved.schoolType !== original.schoolType;
  const labels = { universities: "대학·캠퍼스", majors: "모집단위", tracks: "전형" };
  const fields = { universities: "university", majors: "major", tracks: "admissionTrack" };
  let choices = "";
  for (const [kind, title] of Object.entries(labels)) {
    if (resolved[fields[kind]]) continue;
    const list = data.candidates?.[kind] || [];
    choices += '<div class="resolve-options"><strong>' + title + ' 후보를 선택해 주세요</strong>' +
      (list.length ? '<div class="choice-list">' + list.map((item) => '<button type="button" class="resolve-choice" data-kind="' + kind +
        '" data-value="' + esc(item.name) + '">' + esc(item.name) +
        (item.campus && !item.name.includes(item.campus) ? ' · ' + esc(item.campus) : '') + (item.interview === "yes" ? ' · 면접 실시' : '') + '</button>').join("") + '</div>' :
        '<p class="muted">확인 가능한 자료를 찾지 못했습니다. 공식 모집요강을 확인하거나 검색어를 바꿔 주세요.</p>') + '</div>';
  }
  return box('<h2>공식 명칭 확인</h2><div class="resolve-comparison"><div><span class="meta">입력 조건</span><p>' +
    esc(original.university) + ' / ' + esc(original.major) + ' / ' + esc(original.admissionTrack) + '</p></div><div><span class="meta">공식 기준</span><p>' +
    esc(resolved.university || "대학 선택 필요") + ' / ' + esc(resolved.major || "모집단위 선택 필요") + ' / ' +
    esc(resolved.admissionTrack || "전형 선택 필요") + '</p></div></div>' +
    (changed ? '<p class="resolve-notice">공식 명칭으로 자동 보정됨</p>' : '') +
    (data.notes?.length ? listUnique(data.notes) : '') + choices +
    (data.guide?.url ? '<div class="source">명칭 확인 근거: ' + link(data.guide.url, data.guide.title || "최신 모집요강") + '</div>' : ''), "section card resolution");
}
function listUnique(items) { return list([...new Set(items)]); }
async function fetchStage(stage, input, parentSignal) {
  const route = stage === "resolve" ? "/api/resolve-search" : "/api/search-" + stage;
  const response = await fetch(route, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input), signal: AbortSignal.any([parentSignal, AbortSignal.timeout(58000)]) });
  if (!(response.headers.get("content-type") || "").includes("application/json")) throw new Error("실시간 검색 서버에 연결하지 못했습니다. Vercel 배포 주소에서 실행해 주세요.");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "검색에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  return { data, cacheStatus: response.headers.get("x-search-cache"), expiresAt: response.headers.get("x-cache-expires") };
}
function init() {
  const $ = (id) => document.getElementById(id);
  let schoolType = "4년제";
  let controller;
  let requestNumber = 0;
  let pendingSelection = null;
  const setBusy = (busy) => {
    $("search-fields").disabled = busy;
    $("search-button").textContent = busy ? "조사 중…" : "면접·입결 조사하기";
    $("cancel-button").hidden = !busy;
    $("results").setAttribute("aria-busy", String(busy));
  };
  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => {
    schoolType = button.dataset.type;
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab === button);
      tab.setAttribute("aria-pressed", String(tab === button));
    });
  }));
  $("cancel-button").addEventListener("click", () => {
    requestNumber++;
    controller?.abort();
    setBusy(false);
    $("data-status").textContent = "검색 조건을 다시 입력할 수 있습니다";
    $("results").innerHTML = box("검색 결과 대기를 중단했습니다. 서버에서 이미 시작한 조사는 완료될 수 있습니다.", "section notice");
  });
  $("results").addEventListener("click", (event) => {
    const button = event.target.closest?.(".resolve-choice");
    if (!button || !pendingSelection) return;
    const kind = button.dataset.kind, name = button.dataset.value;
    const group = { university: "universities", major: "majors", admissionTrack: "tracks" }[kind];
    if (!group || !pendingSelection.data.candidates[group].some((item) => item.name === name)) return;
    const { original, query } = pendingSelection;
    pendingSelection = null;
    startSearch(original, { ...query, [kind]: name });
  });
  async function startSearch(original, query) {
    let input = query;
    if (Object.values(input).some((value) => !value)) return;
    const current = ++requestNumber;
    pendingSelection = null;
    controller?.abort();
    controller = new AbortController();
    const activeController = controller;
    setBusy(true);
    const progress = { official: "loading", guide: "waiting", admission: "waiting", questions: "waiting", reviews: "waiting" };
    let state = emptyResult(input);
    let cacheStatus = null, expiresAt = null;
    let resolutionMarkup = "";
    const render = () => { if (current === requestNumber) $("results").innerHTML = resolutionMarkup + renderResearch(state, cacheStatus, expiresAt, progress); };
    $("data-status").textContent = "공식 대학·모집단위·전형명 확인 중";
    $("results").innerHTML = box('<span class="spinner" aria-hidden="true"></span><strong>최신 공식 모집요강에서 명칭을 확인하고 있습니다...</strong>', "section loading card");
    try {
      try {
        const response = await fetchStage("resolve", input, activeController.signal);
        if (current !== requestNumber) return;
        const resolution = response.data;
        resolutionMarkup = renderResolution(resolution, original);
        if (!["schoolType", "university", "major", "admissionTrack"].every((key) => resolution.resolved?.[key])) {
          pendingSelection = { original, query, data: resolution };
          $("results").innerHTML = resolutionMarkup;
          $("data-status").textContent = "공식 명칭 후보 선택 필요";
          return;
        }
        input = { ...resolution.resolved, aliases: resolution.aliases };
        state = emptyResult(input);
        $("results").innerHTML = resolutionMarkup + progressList(progress) + box('<span class="spinner" aria-hidden="true"></span><strong>대학 입학처와 공개 자료를 조사하고 있습니다...</strong><p class="muted">기본 결과가 도착하면 먼저 표시합니다.</p>', "section loading card");
      } catch (error) {
        if (current !== requestNumber || activeController.signal.aborted) return;
        $("results").innerHTML = box('<div role="alert"><strong class="error">공식 명칭을 확인하지 못했습니다</strong><p>' + esc(error.name === "TimeoutError" ? "명칭 확인 시간이 초과되었습니다." : error.message) + '</p></div>', "section card");
        $("data-status").textContent = "명칭 확인 실패";
        return;
      }
      try {
        const overview = await fetchStage("overview", input, activeController.signal);
        if (current !== requestNumber) return;
        const data = overview.data;
        state = { ...state, ...data, sources: mergeSources(state.sources, data.sources),
          questions: data.latestQuestions.length ? [{ year: data.admissionResults.year, note: "", items: data.latestQuestions }] : [] };
        cacheStatus = overview.cacheStatus; expiresAt = overview.expiresAt;
        progress.official = data.officialOffice?.url ? "done" : "failed";
        progress.guide = data.guide?.url ? "done" : "failed";
        progress.admission = data.admissionResults.status === "found" ? "done" : "failed";
      } catch (error) {
        if (current !== requestNumber || activeController.signal.aborted) return;
        progress.official = progress.guide = progress.admission = "failed";
        state.interviewOverview.notes = [error.name === "TimeoutError" ? "기본 검색 시간이 초과되었습니다." : "기본 검색을 완료하지 못했습니다. 추가 자료를 계속 조사합니다."];
      }
      if (current !== requestNumber) return;
      progress.questions = progress.reviews = "loading";
      render();
      $("data-status").textContent = "기본 검색 결과 표시 · 기출과 후기 조사 중";
      const jobs = [
        fetchStage("questions", input, activeController.signal).then(({ data }) => {
          if (current !== requestNumber) return;
          if (data.questions.some((group) => group.items.length)) {
            const latest = state.questions.flatMap((group) => group.items.map((item) => ({ year: group.year, item })));
            state.questions = data.questions.map((group) => {
              const items = [...group.items];
              for (const prior of latest.filter((entry) => entry.year === group.year))
                if (!items.some((item) => item.question === prior.item.question && item.sourceUrl === prior.item.sourceUrl)) items.push(prior.item);
              return { ...group, items, note: items.length ? "" : group.note };
            });
          }
          state.trends = data.trends; state.sources = mergeSources(state.sources, data.sources);
          progress.questions = "done"; render();
        }).catch(() => { if (current === requestNumber) { progress.questions = "failed"; render(); } }),
        fetchStage("reviews", input, activeController.signal).then(({ data }) => {
          if (current !== requestNumber) return;
          state.reviews = data.reviews; state.tips = data.tips; state.sources = mergeSources(state.sources, data.sources);
          progress.reviews = "done"; render();
        }).catch(() => { if (current === requestNumber) { progress.reviews = "failed"; render(); } })
      ];
      await Promise.allSettled(jobs);
      if (current === requestNumber) $("data-status").textContent = "조사 완료 · " + dateLabel(state.searchedAt);
    } finally {
      if (current === requestNumber) setBusy(false);
    }
  }
  $("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!$("search-form").reportValidity()) return;
    const original = { schoolType, university: $("university").value.trim(), major: $("major").value.trim(), admissionTrack: $("track").value.trim() };
    return startSearch(original, original);
  });
}
if (typeof document !== "undefined") init();
if (typeof module !== "undefined") module.exports = { renderResearch, renderResolution, safeUrl, esc, emptyResult, progressList };
