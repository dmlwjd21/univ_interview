import UniversityPicker from "@/components/UniversityPicker";
import { listUniversities, stats } from "@/lib/data";
import questions from "@/data/questions.json";

export default function HomePage() {
  const universities = listUniversities();
  const summary = stats();
  const withData = [...new Set((questions as { univId: string }[]).map((q) => q.univId))];

  return (
    <div className="wrap" style={{ paddingBlock: 36, display: "grid", gap: 28 }}>
      <section style={{ display: "grid", gap: 10 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.3 }}>
          지원할 대학의 면접, 무엇을 물었는지부터
        </h1>
        <p style={{ color: "var(--ink-soft)", maxWidth: 620 }}>
          대학이 해마다 공개하는 <strong>선행학습 영향평가 결과보고서</strong>에서 실제 면접 문항을 모았습니다.
          문항마다 원문 PDF와 쪽 번호가 함께 붙습니다.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          <span className="chip chip-accent">기출 {summary.questions.toLocaleString()}문항</span>
          <span className="chip">{summary.universitiesWithQuestions}개교 수집 완료</span>
          <span className="chip">보고서 {summary.reports}건</span>
          <span className="chip">
            {summary.years.length > 0 ? `${Math.min(...summary.years)}~${Math.max(...summary.years)}학년도` : "수집 전"}
          </span>
          <span className="chip">전체 {summary.universities + summary.colleges}개교 등록</span>
        </div>
      </section>

      <section className="card" style={{ padding: 20 }}>
        <UniversityPicker universities={universities} withData={withData} />
      </section>

      <section className="notice">
        아직 모든 학교의 기출이 모인 것은 아닙니다. 「기출 있음」 표시가 없는 학교도 페이지에 들어가면 그
        학교의 보고서를 찾을 수 있는 검색 경로와 입학처 링크를 안내합니다.
      </section>
    </div>
  );
}
