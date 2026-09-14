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
function renderResearch(data, cacheStatus, expiresAt) {
  const sources = [...data.sources].sort((a, b) => a.sourceType.localeCompare(b.sourceType));
  const overview = data.interviewOverview;
  const cached = cacheStatus === "HIT" || cacheStatus === "COALESCED";
  let html = box('<strong>' + (cached ? "저장된 조사 결과" : "새로 조사한 결과") + '</strong> · 조사일 ' + esc(dateLabel(data.searchedAt)) +
    '<div class="meta">' + (expiresAt ? '캐시 유효기간: ' + esc(dateLabel(expiresAt)) + '. ' : '') +
    'AI가 정리한 자료입니다. 지원 전 원문과 해당 학년도 모집요강을 확인하세요.</div>', "section notice");
  html += section("1. 면접 개요", box('<div class="intro"><div><h3>' + esc(data.university) + ' · ' + esc(data.major) + '</h3><p>' +
    esc(data.admissionTrack) + ' · ' + esc(overview.admissionYear) + '학년도 준비</p></div></div><p>' + esc(overview.summary) + '</p>' +
    (overview.interviewType ? '<p>면접 유형: ' + esc(overview.interviewType) + '</p>' : '') +
    (overview.notes.length ? list([...new Set(overview.notes)]) : '') +
    (overview.sourceUrls.length ? '<div class="source">' + sourceLinks(overview.sourceUrls, sources) + '</div>' : '')));
  html += section("2. 최근 5개년 기출", '<div class="stack">' + data.questions.map((group) => box(
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
  html += section("4. 면접 후기·준비 팁", reviews || tips ? '<div class="stack">' + reviews + tips + '</div>' : box("확인된 공개 후기와 준비 팁이 없습니다.", "empty"));
  const admission = data.admissionResults;
  const fields = { capacity:"모집인원", applicants:"지원인원", competitionRate:"경쟁률", additionalAdmits:"충원합격 인원",
    additionalRank:"충원순위", registeredAverage:"최종등록자 평균", cut50:"50%컷", cut70:"70%컷",
    studentRecordGrade:"학생부 등급", convertedScore:"환산점수", calculationBasis:"환산점수·등급 산출 기준" };
  html += section('5. 전년도 입결 · ' + esc(admission.year) + '학년도', admission.status === "found" ? box(
    '<p>' + esc(data.university) + ' · ' + esc(data.major) + ' · ' + esc(data.admissionTrack) + '</p><div class="facts">' +
    Object.entries(fields).filter(([key]) => admission[key] !== null).map(([key, title]) =>
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

function init() {
  const $ = (id) => document.getElementById(id);
  let schoolType = "4년제";
  let controller;
  let requestNumber = 0;
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
  $("search-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!$("search-form").reportValidity()) return;
    const input = { schoolType, university: $("university").value.trim(), major: $("major").value.trim(), admissionTrack: $("track").value.trim() };
    if (Object.values(input).some((value) => !value)) return;
    const current = ++requestNumber;
    controller?.abort();
    controller = new AbortController();
    const activeController = controller;
    const timer = setTimeout(() => activeController.abort(), 225000);
    setBusy(true);
    $("data-status").textContent = "공식 입학처 → 공공자료 → 공개 후기";
    $("results").innerHTML = box('<span class="spinner" aria-hidden="true"></span><strong>대학 입학처와 공개 자료를 조사하고 있습니다...</strong><p class="muted">자료를 찾고 출처를 확인하는 데 몇 분이 걸릴 수 있습니다.</p>', "section loading card");
    try {
      const response = await fetch("/api/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input), signal: activeController.signal
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) throw new Error("실시간 검색 서버에 연결하지 못했습니다. Vercel 배포 주소 또는 Node 개발 서버에서 실행해 주세요.");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "검색에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      if (current !== requestNumber) return;
      $("results").innerHTML = renderResearch(data, response.headers.get("x-search-cache"), response.headers.get("x-cache-expires"));
      $("data-status").textContent = "조사일 " + dateLabel(data.searchedAt);
    } catch (error) {
      if (current !== requestNumber) return;
      const message = error.name === "AbortError" ? "검색 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요." : error.message;
      $("results").innerHTML = box('<div role="alert"><strong class="error">검색을 완료하지 못했습니다</strong><p>' + esc(message) + '</p></div>', "section card");
      $("data-status").textContent = "검색 실패";
    } finally {
      clearTimeout(timer);
      if (current === requestNumber) setBusy(false);
    }
  });
}
if (typeof document !== "undefined") init();
if (typeof module !== "undefined") module.exports = { renderResearch, safeUrl, esc };

