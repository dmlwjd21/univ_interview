import { stats } from "@/lib/data";

export const metadata = { title: "출처와 수집 방법" };

const SOURCES = [
  {
    name: "선행학습 영향평가 결과보고서 (각 대학)",
    role: "면접 기출문항 · 출제 의도 · 교육과정 연계",
    detail:
      "「공교육 정상화 촉진 및 선행교육 규제에 관한 특별법」 제10조에 따라 대학별고사를 치른 대학이 매년 스스로 공개하는 법정 자료입니다. 이 사이트 기출문항의 유일한 근거이며, 문항마다 원문 PDF의 쪽 번호를 함께 표시합니다.",
    url: "https://www.academyinfo.go.kr",
  },
  {
    name: "대학알리미",
    role: "대학 공시 정보",
    detail: "입학처 홈페이지에서 보고서를 찾지 못했을 때 확인할 수 있는 통합 공시 창구입니다.",
    url: "https://www.academyinfo.go.kr",
  },
  {
    name: "대입정보포털 어디가",
    role: "입시결과 · 전형 정보",
    detail: "한국대학교육협의회가 운영하는 공식 대입 포털입니다. 입시결과는 학과·전형·연도가 모두 맞는 값만 의미가 있습니다.",
    url: "https://www.adiga.kr",
  },
  {
    name: "네이버 검색 오픈 API (카페 · 블로그)",
    role: "면접 후기",
    detail:
      "수만휘를 비롯한 입시 카페와 블로그 글을 공식 API로 검색해 제목·요약·링크만 보여 줍니다. 카페 본문을 직접 수집하지 않습니다.",
    url: "https://developers.naver.com/docs/serviceapi/search/blog/blog.md",
  },
  {
    name: "위키백과 대학 목록 · 시·도별 분류",
    role: "전국 대학 · 전문대학 명단",
    detail: "학교 목록과 소재지, 홈페이지 주소의 출처입니다. 잘못된 항목은 저장소의 보정 파일에서 고칩니다.",
    url: "https://ko.wikipedia.org/wiki/대한민국의_대학_목록",
  },
];

export default function SourcesPage() {
  const summary = stats();
  return (
    <div className="wrap" style={{ paddingBlock: 32, display: "grid", gap: 24 }}>
      <header style={{ display: "grid", gap: 8 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>출처와 수집 방법</h1>
        <p style={{ color: "var(--ink-soft)", maxWidth: 640 }}>
          어떤 자료를 어떻게 모았는지 그대로 밝힙니다. 자동 수집이라 빠지거나 잘못 붙은 값이 있을 수 있으니,
          지원 판단은 반드시 원문과 해당 연도 모집요강으로 하세요.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <span className="chip chip-accent">기출 {summary.questions.toLocaleString()}문항</span>
          <span className="chip">{summary.universitiesWithQuestions}개교</span>
          <span className="chip">보고서 {summary.reports}건</span>
          <span className="chip">입결 {summary.admissionResults}건</span>
        </div>
      </header>

      <section style={{ display: "grid", gap: 10 }}>
        {SOURCES.map((s) => (
          <article key={s.name} className="card" style={{ padding: 16, display: "grid", gap: 7 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>{s.name}</h2>
            <span className="chip" style={{ justifySelf: "start" }}>{s.role}</span>
            <p style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.7 }}>{s.detail}</p>
            <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "var(--accent)" }}>
              {s.url} ↗
            </a>
          </article>
        ))}
      </section>

      <section className="notice">
        데이터는 저장소의 수집 스크립트로 매년 다시 만듭니다. 선행학습 영향평가 보고서는 전형을 치른 이듬해
        3월 무렵 공개되므로, 자동 갱신도 그 시점에 맞춰 돌아갑니다.
      </section>
    </div>
  );
}
