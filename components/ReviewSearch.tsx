"use client";

import { useMemo, useState } from "react";
import { buildReviewLinks } from "@/lib/review-links";

interface ReviewItem {
  kind: string;
  title: string;
  link: string;
  summary: string;
  source: string;
  date: string;
}

export default function ReviewSearch({ univName }: { univName: string }) {
  const [department, setDepartment] = useState("");
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  // 링크는 키가 없어도 바로 만들 수 있다. 서버를 거치지 않으므로 입력과 동시에 갱신된다.
  const links = useMemo(() => buildReviewLinks(univName, department.trim()), [univName, department]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof links>();
    for (const link of links) {
      const list = map.get(link.group) ?? [];
      list.push(link);
      map.set(link.group, list);
    }
    return [...map.entries()];
  }, [links]);

  /** 네이버 API 키가 등록된 경우에만 후기 목록을 이 화면에 띄운다. */
  async function fetchInline() {
    setLoading(true);
    try {
      const url = `/api/reviews?univ=${encodeURIComponent(univName)}&department=${encodeURIComponent(department)}`;
      const res = await fetch(url);
      const data = await res.json();
      setItems(data.configured ? (data.items ?? []) : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16, display: "grid", gap: 14 }}>
      <div>
        <label className="label" htmlFor="review-dept">
          학과를 넣으면 검색이 정확해집니다
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            id="review-dept"
            className="field"
            style={{ flex: "1 1 200px" }}
            placeholder="예: 간호학과"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          />
          <button type="button" className="btn" onClick={fetchInline} disabled={loading}>
            {loading ? "확인 중…" : "여기서 바로 보기"}
          </button>
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 7 }}>
          아래 링크는 키 없이 바로 쓸 수 있습니다. 「여기서 바로 보기」는 네이버 검색 API 키가
          등록된 경우에만 목록을 이 화면에 띄웁니다.
        </p>
      </div>

      {items !== null && (
        <div style={{ display: "grid", gap: 10 }}>
          {items.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              이 화면에 띄울 결과가 없습니다. 아래 링크로 찾아보세요.
            </p>
          ) : (
            items.map((item) => (
              <a
                key={item.link}
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="card"
                style={{ padding: 12, display: "grid", gap: 5 }}
              >
                <span style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</span>
                <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>{item.summary}</span>
                <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                  {item.kind === "cafearticle" ? "카페" : "블로그"}
                  {item.source && ` · ${item.source}`}
                  {item.date && ` · ${item.date}`}
                </span>
              </a>
            ))
          )}
        </div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {groups.map(([group, list]) => {
          const hint = list.find((l) => l.hint)?.hint;
          return (
            <div key={group}>
              <span className="label">{group}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {list.map((link) => (
                  <a
                    key={link.url}
                    className="chip"
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={link.hint}
                  >
                    {link.label} ↗
                  </a>
                ))}
              </div>
              {hint && <p style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 5 }}>{hint}</p>}
            </div>
          );
        })}
      </div>

      <p className="notice">
        후기는 학생 개인의 기억이라 사실과 다를 수 있고, 같은 전형이라도 면접관과 조에 따라 질문이
        달라집니다. 기출문항과 대학이 밝힌 출제 의도를 먼저 보고, 후기는 분위기를 가늠하는 용도로
        쓰세요.
      </p>
    </div>
  );
}
