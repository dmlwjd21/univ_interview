import Link from "next/link";
import { notFound } from "next/navigation";

import QuestionBrowser from "@/components/QuestionBrowser";
import ReviewSearch from "@/components/ReviewSearch";
import {
  getAdmissionResults,
  getQuestions,
  getReports,
  getReviews,
  getUniversity,
  listUniversities,
} from "@/lib/data";
import reportsRaw from "@/data/reports.json";
import type { Report } from "@/lib/types";

export function generateStaticParams() {
  return listUniversities().map((u) => ({ id: u.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const univ = getUniversity(decodeURIComponent(id));
  if (!univ) return { title: "찾을 수 없는 대학" };
  return {
    title: `${univ.name} 면접 기출 · 입결`,
    description: `${univ.name}의 최근 면접 기출문항과 전년도 입시결과를 출처와 함께 정리했습니다.`,
  };
}

export default async function UniversityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const univId = decodeURIComponent(id);
  const univ = getUniversity(univId);
  if (!univ) notFound();

  const questions = getQuestions(univId);
  const reports = getReports(univId);
  const results = getAdmissionResults(univId);
  const reviews = getReviews(univId);

  // 보고서를 못 찾은 연도는 학생이 직접 찾아갈 수 있게 검색 경로를 보여 준다.
  const notFoundYears = (reportsRaw as Report[])
    .filter((r) => r.univId === univId && !r.url)
    .sort((a, b) => b.year - a.year);

  return (
    <div className="wrap" style={{ paddingBlock: 28, display: "grid", gap: 28 }}>
      <nav style={{ fontSize: 13, color: "var(--ink-faint)" }}>
        <Link href="/">대학 찾기</Link> <span aria-hidden>›</span> {univ.name}
      </nav>

      <header style={{ display: "grid", gap: 10 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>{univ.name}</h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <span className="chip">{univ.type === "college" ? "전문대학" : "4년제"}</span>
          {univ.region && <span className="chip">{univ.region}</span>}
          <span className="chip chip-accent">기출 {questions.length.toLocaleString()}문항</span>
          {univ.homepage && (
            <a className="chip" href={univ.homepage} target="_blank" rel="noopener noreferrer">
              학교 홈페이지 ↗
            </a>
          )}
          <a
            className="chip"
            href={`https://www.google.com/search?q=${encodeURIComponent(`${univ.name} 입학처`)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            입학처 찾기 ↗
          </a>
        </div>
      </header>

      {/* ── 기출문항 ─────────────────────────────────────── */}
      <section style={{ display: "grid", gap: 14 }}>
        <h2 style={{ fontSize: 19, fontWeight: 800 }}>면접 기출문항</h2>
        {questions.length > 0 ? (
          <QuestionBrowser questions={questions} />
        ) : (
          <div className="notice">
            아직 이 학교의 기출문항이 수집되지 않았습니다. 아래 「보고서 직접 찾기」의 검색 링크로 학교가
            공개한 원문을 확인할 수 있습니다. 전문대학은 입학처 공지·자료실에 면접 문항을 따로 올리는 경우가
            많습니다.
          </div>
        )}
      </section>

      {/* ── 전년도 입결 ──────────────────────────────────── */}
      <section style={{ display: "grid", gap: 14 }}>
        <h2 style={{ fontSize: 19, fontWeight: 800 }}>전년도 입시결과</h2>
        {results.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>학년도</th>
                  <th>모집단위</th>
                  <th>전형</th>
                  <th>모집</th>
                  <th>경쟁률</th>
                  <th>50% 컷</th>
                  <th>70% 컷</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={`${r.univId}-${r.year}-${r.department}-${r.admissionType}-${i}`}>
                    <td>{r.year}</td>
                    <td style={{ whiteSpace: "normal" }}>{r.department}</td>
                    <td>{r.admissionType}</td>
                    <td>{r.quota ?? "—"}</td>
                    <td>{r.competitionRate != null ? `${r.competitionRate.toFixed(2)} : 1` : "—"}</td>
                    <td>{r.grade50 ?? "—"}</td>
                    <td>{r.grade70 ?? "—"}</td>
                    <td style={{ whiteSpace: "normal", color: "var(--ink-faint)" }}>{r.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="notice">
            입시결과는 대학마다 공개 시점과 형식이 달라 아직 이 학교 것은 모으지 못했습니다. 아래 링크에서
            학교가 공개한 원자료를 확인하세요. 입결은 <strong>학과·전형·연도</strong>가 모두 맞는 값만 의미가
            있으니 반드시 원문을 보고 확인하시기 바랍니다.
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <a
            className="btn"
            href={`https://www.adiga.kr/man/inf/mainView.do?menuId=PCMANINF1000`}
            target="_blank"
            rel="noopener noreferrer"
          >
            대입정보포털 어디가 ↗
          </a>
          <a
            className="btn"
            href={`https://www.google.com/search?q=${encodeURIComponent(`${univ.name} 입시결과 입학처`)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {univ.name} 입시결과 검색 ↗
          </a>
          <a className="btn" href="https://www.academyinfo.go.kr" target="_blank" rel="noopener noreferrer">
            대학알리미 ↗
          </a>
        </div>
      </section>

      {/* ── 면접 후기 ────────────────────────────────────── */}
      <section style={{ display: "grid", gap: 14 }}>
        <h2 style={{ fontSize: 19, fontWeight: 800 }}>면접 후기</h2>
        {reviews.length > 0 && (
          <div style={{ display: "grid", gap: 10 }}>
            {reviews.map((r) => (
              <article key={r.id} className="card" style={{ padding: 16, display: "grid", gap: 8 }}>
                <p style={{ fontSize: 14, lineHeight: 1.7 }}>{r.body}</p>
                <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                  {r.department && `${r.department} · `}
                  {r.sourceName}
                  {r.sourcePage ? ` p.${r.sourcePage}` : ""}
                </span>
              </article>
            ))}
          </div>
        )}
        <ReviewSearch univName={univ.name} />
      </section>

      {/* ── 출처 ─────────────────────────────────────────── */}
      <section style={{ display: "grid", gap: 14 }}>
        <h2 style={{ fontSize: 19, fontWeight: 800 }}>출처 원문</h2>
        {reports.length > 0 && (
          <ul style={{ display: "grid", gap: 8, listStyle: "none", padding: 0 }}>
            {reports.map((r) => (
              <li key={`${r.univId}-${r.year}`} className="card" style={{ padding: 14 }}>
                <a href={r.url!} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
                  {r.sourceName ?? `${r.univName} ${r.year}학년도 선행학습 영향평가 결과보고서`} ↗
                </a>
              </li>
            ))}
          </ul>
        )}

        {notFoundYears.length > 0 && (
          <details className="card" style={{ padding: 14 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
              보고서 직접 찾기 — 아직 못 찾은 {notFoundYears.length}개 학년도
            </summary>
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {notFoundYears.map((r) => (
                <div key={r.year} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <span className="chip">{r.year}학년도</span>
                  {r.search && (
                    <>
                      <a className="chip" href={r.search.naver} target="_blank" rel="noopener noreferrer">
                        네이버 검색 ↗
                      </a>
                      <a className="chip" href={r.search.google} target="_blank" rel="noopener noreferrer">
                        구글 PDF 검색 ↗
                      </a>
                    </>
                  )}
                </div>
              ))}
              <p style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                입학처 홈페이지 검색창에 <strong>선행학습</strong>만 넣으면 대체로 가장 빨리 찾습니다. 전년도
                보고서는 이듬해 상반기에 올라옵니다.
              </p>
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
