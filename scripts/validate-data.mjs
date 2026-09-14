/**
 * 데이터 파일이 앱이 기대하는 모양인지 확인한다.
 * 수집 스크립트가 조용히 망가진 채로 배포되는 것을 막는 마지막 관문이라
 * 문제가 있으면 0이 아닌 코드로 끝낸다.
 */
import path from "node:path";
import { DATA, readJson } from "./lib/util.mjs";

const problems = [];
const warn = [];

function required(value, label) {
  if (!value) problems.push(label);
}

const universities = readJson(path.join(DATA, "universities.json"), []);
const questions = readJson(path.join(DATA, "questions.json"), []);
const reports = readJson(path.join(DATA, "reports.json"), []);
const results = readJson(path.join(DATA, "admission-results.json"), []);
const tips = readJson(path.join(DATA, "tips.json"), []);

required(universities.length > 100, `universities.json 이 너무 적습니다 (${universities.length}건)`);
required(questions.length > 0, "questions.json 이 비어 있습니다");

const ids = new Set(universities.map((u) => u.id));

for (const [name, rows] of [["questions", questions], ["admission-results", results]]) {
  const orphans = rows.filter((r) => !ids.has(r.univId));
  if (orphans.length) {
    problems.push(`${name}.json — 대학 목록에 없는 univId ${orphans.length}건 (예: ${orphans[0].univId})`);
  }
}

const noSource = questions.filter((q) => !q.sourceUrl);
if (noSource.length) problems.push(`출처 없는 문항 ${noSource.length}건 — 출처 없는 문항은 내보내지 않습니다`);

const tooShort = questions.filter((q) => (q.question ?? "").trim().length < 10);
if (tooShort.length) warn.push(`너무 짧은 문항 ${tooShort.length}건 — 추출이 잘렸을 수 있습니다`);

const withQuestions = new Set(questions.map((q) => q.univId));
const foundReports = reports.filter((r) => r.url);

console.log(`  · 대학 ${universities.length}개교 (4년제 ${universities.filter((u) => u.type === "university").length}, 전문대 ${universities.filter((u) => u.type === "college").length})`);
console.log(`  · 기출 ${questions.length}문항 / ${withQuestions.size}개교`);
console.log(`  · 보고서 ${foundReports.length}건, 입결 ${results.length}건, 준비 가이드 ${tips.length}꼭지`);

for (const w of warn) console.log(`  ⚠ ${w}`);

if (problems.length) {
  console.error("\n  ✗ 데이터 검증 실패");
  for (const p of problems) console.error(`    - ${p}`);
  process.exit(1);
}
console.log("\n  ✓ 데이터 검증 통과");
