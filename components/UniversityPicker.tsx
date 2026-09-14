"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { University, UniversityType } from "@/lib/types";

const REGIONS = ["전체", "서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산", "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];

interface Props {
  universities: University[];
  /** 기출문항이 이미 수집된 대학 id. 목록에서 먼저 보여 준다. */
  withData: string[];
}

export default function UniversityPicker({ universities, withData }: Props) {
  const [type, setType] = useState<UniversityType>("university");
  const [region, setRegion] = useState("전체");
  const [query, setQuery] = useState("");

  const ready = useMemo(() => new Set(withData), [withData]);

  const results = useMemo(() => {
    const q = query.trim().replace(/\s+/g, "");
    return universities
      .filter((u) => u.type === type)
      .filter((u) => region === "전체" || u.region === region)
      .filter((u) => {
        if (!q) return true;
        const name = u.name.replace(/\s+/g, "");
        return name.includes(q) || name.replace(/대학교|대학/g, "").includes(q);
      })
      .sort((a, b) => {
        // 기출이 있는 학교를 위로 올린다. 학생이 먼저 볼 것이기 때문이다.
        const diff = Number(ready.has(b.id)) - Number(ready.has(a.id));
        return diff !== 0 ? diff : a.name.localeCompare(b.name, "ko");
      });
  }, [universities, type, region, query, ready]);

  const counts = useMemo(
    () => ({
      university: universities.filter((u) => u.type === "university").length,
      college: universities.filter((u) => u.type === "college").length,
    }),
    [universities]
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {(
          [
            ["university", `4년제 대학 ${counts.university}`],
            ["college", `전문대학 ${counts.college}`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={type === value ? "btn btn-primary" : "btn"}
            style={{ flex: 1 }}
            onClick={() => setType(value)}
            aria-pressed={type === value}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        <label className="label" htmlFor="univ-search">
          대학 이름으로 찾기
        </label>
        <input
          id="univ-search"
          className="field"
          placeholder="예: 부산대, 우송대, 대구보건"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div>
        <span className="label">지역</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              className={region === r ? "chip chip-accent" : "chip"}
              style={{ cursor: "pointer" }}
              onClick={() => setRegion(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 7,
          }}
        >
          <span className="label" style={{ marginBottom: 0 }}>
            검색 결과 {results.length}개교
          </span>
          <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>기출 확보 학교가 위에 표시됩니다</span>
        </div>

        {results.length === 0 ? (
          <p className="card" style={{ padding: 20, fontSize: 14, color: "var(--ink-soft)" }}>
            조건에 맞는 학교가 없습니다. 검색어나 지역을 바꿔 보세요.
          </p>
        ) : (
          <div className="picker">
            {results.map((u) => (
              <Link key={u.id} href={`/univ/${encodeURIComponent(u.id)}`} className="picker-item">
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</span>
                  {u.region && <span className="chip">{u.region}</span>}
                </span>
                {ready.has(u.id) ? (
                  <span className="chip chip-accent">기출 있음</span>
                ) : (
                  <span className="chip">자료 찾기</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
