"use client";

import { useState } from "react";

interface ReviewItem {
  kind: string;
  title: string;
  link: string;
  summary: string;
  source: string;
  date: string;
}

interface Payload {
  configured: boolean;
  query: string;
  items?: ReviewItem[];
  links: { label: string; url: string }[];
}

export default function ReviewSearch({ univName }: { univName: string }) {
  const [department, setDepartment] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);

  async function search() {
    setLoading(true);
    try {
      const url = `/api/reviews?univ=${encodeURIComponent(univName)}&department=${encodeURIComponent(department)}`;
      const res = await fetch(url);
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
      <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>
        수만휘 등 입시 카페와 블로그에 올라온 후기를 찾아봅니다. 제목과 요약만 가져오고 본문은 원글로
        연결합니다.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="field"
          style={{ flex: "1 1 200px" }}
          placeholder="학과를 넣으면 더 정확합니다 (예: 간호학과)"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button type="button" className="btn btn-primary" onClick={search} disabled={loading}>
          {loading ? "찾는 중…" : "후기 찾기"}
        </button>
      </div>

      {data && (
        <div style={{ display: "grid", gap: 10 }}>
          {!data.configured && (
            <p className="notice">
              후기 검색 API 키가 설정되지 않아 검색 포털 링크만 안내합니다. 관리자가 환경변수{" "}
              <code>NAVER_CLIENT_ID</code>·<code>NAVER_CLIENT_SECRET</code>를 넣으면 결과가 여기에 바로
              표시됩니다.
            </p>
          )}

          {data.items?.map((item) => (
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
          ))}

          {data.items && data.items.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>검색 결과가 없습니다. 학과명을 빼고 다시 찾아보세요.</p>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {data.links.map((l) => (
              <a key={l.url} className="chip" href={l.url} target="_blank" rel="noopener noreferrer">
                {l.label} ↗
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
