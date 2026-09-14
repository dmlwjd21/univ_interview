import { getTips } from "@/lib/data";

export const metadata = {
  title: "면접 준비 가이드",
  description: "시·도교육청과 진학지원센터가 펴낸 면접 지도 자료에서 정리한 준비 요령입니다.",
};

export default function TipsPage() {
  const tips = getTips();
  const groups = new Map<string, typeof tips>();
  for (const tip of tips) {
    const list = groups.get(tip.category) ?? [];
    list.push(tip);
    groups.set(tip.category, list);
  }

  return (
    <div className="wrap" style={{ paddingBlock: 32, display: "grid", gap: 24 }}>
      <header style={{ display: "grid", gap: 8 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>면접 준비 가이드</h1>
        <p style={{ color: "var(--ink-soft)", maxWidth: 640 }}>
          시·도교육청과 진학지원센터가 펴낸 면접 지도 자료에서 정리했습니다. 항목마다 어느 자료의 몇 쪽에서
          왔는지 표시했습니다.
        </p>
      </header>

      {tips.length === 0 ? (
        <p className="notice">
          아직 가이드가 수집되지 않았습니다. <code>npm run data:tips</code> 를 실행하면 자료집 PDF에서
          내용을 뽑아 채웁니다.
        </p>
      ) : (
        [...groups.entries()].map(([category, list]) => (
          <section key={category} style={{ display: "grid", gap: 10 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800 }}>{category}</h2>
            {list.map((tip) => (
              <article key={tip.id} className="card" style={{ padding: 16, display: "grid", gap: 7 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700 }}>{tip.title}</h3>
                <p style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                  {tip.body}
                </p>
                <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                  {tip.sourceName}
                  {tip.sourcePage ? ` p.${tip.sourcePage}` : ""}
                </span>
              </article>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
