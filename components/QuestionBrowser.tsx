"use client";

import { useMemo, useState } from "react";
import type { Question } from "@/lib/types";

interface Props {
  questions: Question[];
}

const ALL = "전체";

export default function QuestionBrowser({ questions }: Props) {
  const years = useMemo(
    () => [ALL, ...[...new Set(questions.map((q) => String(q.year)))].sort((a, b) => Number(b) - Number(a))],
    [questions]
  );
  const departments = useMemo(
    () => [ALL, ...[...new Set(questions.map((q) => q.department).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "ko"))],
    [questions]
  );
  const admissionTypes = useMemo(
    () => [ALL, ...[...new Set(questions.map((q) => q.admissionType).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "ko"))],
    [questions]
  );

  const [year, setYear] = useState(ALL);
  const [department, setDepartment] = useState(ALL);
  const [admissionType, setAdmissionType] = useState(ALL);
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    const k = keyword.trim();
    return questions.filter((q) => {
      if (year !== ALL && String(q.year) !== year) return false;
      if (department !== ALL && q.department !== department) return false;
      if (admissionType !== ALL && q.admissionType !== admissionType) return false;
      if (k && !q.question.includes(k) && !(q.intent ?? "").includes(k)) return false;
      return true;
    });
  }, [questions, year, department, admissionType, keyword]);

  const grouped = useMemo(() => {
    const map = new Map<number, Question[]>();
    for (const q of filtered) {
      const list = map.get(q.year) ?? [];
      list.push(q);
      map.set(q.year, list);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [filtered]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="filters">
        <div>
          <label className="label" htmlFor="f-year">학년도</label>
          <select id="f-year" className="field" value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => (
              <option key={y} value={y}>{y === ALL ? "전체 학년도" : `${y}학년도`}</option>
            ))}
          </select>
        </div>

        {departments.length > 1 && (
          <div>
            <label className="label" htmlFor="f-dept">학과 · 모집단위</label>
            <select id="f-dept" className="field" value={department} onChange={(e) => setDepartment(e.target.value)}>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        )}

        {admissionTypes.length > 1 && (
          <div>
            <label className="label" htmlFor="f-type">전형</label>
            <select id="f-type" className="field" value={admissionType} onChange={(e) => setAdmissionType(e.target.value)}>
              {admissionTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        )}

        <div className="filters-wide">
          <label className="label" htmlFor="f-keyword">문항 검색</label>
          <input
            id="f-keyword"
            className="field"
            placeholder="예: 동아리, 진로, 갈등"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
      </div>

      <p style={{ fontSize: 13, color: "var(--ink-faint)" }}>
        {filtered.length.toLocaleString()}문항
        {filtered.length !== questions.length && ` (전체 ${questions.length.toLocaleString()}문항 중)`}
      </p>

      {grouped.length === 0 && (
        <p className="card" style={{ padding: 20, fontSize: 14, color: "var(--ink-soft)" }}>
          조건에 맞는 문항이 없습니다. 필터를 넓혀 보세요.
        </p>
      )}

      {grouped.map(([groupYear, list]) => (
        <section key={groupYear} style={{ display: "grid", gap: 10 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
            {groupYear}학년도
            <span className="chip">{list.length}문항</span>
          </h3>

          {list.map((q) => (
            <article key={q.id} className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
              <p style={{ fontSize: 15, lineHeight: 1.7 }}>{q.question}</p>

              {q.passage && (
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>
                    제시문 보기
                  </summary>
                  <p
                    style={{
                      marginTop: 8,
                      fontSize: 13,
                      lineHeight: 1.8,
                      color: "var(--ink-soft)",
                      background: "var(--canvas)",
                      borderRadius: 8,
                      padding: "11px 13px",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {q.passage}
                  </p>
                </details>
              )}

              {q.intent && (
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--ink-soft)",
                    background: "var(--canvas)",
                    borderRadius: 8,
                    padding: "9px 12px",
                  }}
                >
                  <strong style={{ color: "var(--ink)" }}>대학이 밝힌 출제 의도 </strong>
                  {q.intent}
                </p>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {q.department && <span className="chip">{q.department}</span>}
                {q.admissionType && <span className="chip">{q.admissionType}</span>}
                {/* track 에 "인문" 처럼 계열만 오기도 하고 "사이버국방학과" 가 통째로 오기도 한다. */}
                {q.track && q.track !== q.department && (
                  <span className="chip">{/(계열|학과|학부|전공)$/.test(q.track) ? q.track : `${q.track}계열`}</span>
                )}
                <a
                  className="chip chip-accent"
                  href={`${q.sourceUrl}#page=${q.page}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={q.sourceName}
                >
                  출처 원문 p.{q.page} ↗
                </a>
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
