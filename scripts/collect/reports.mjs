/**
 * 대학별 「선행학습 영향평가 결과보고서」 PDF를 찾아 목록으로 남긴다.
 *
 * 이 보고서가 면접 기출의 1순위 출처다. 「공교육 정상화 촉진 및 선행교육 규제에 관한
 * 특별법」 제10조에 따라 대학별고사(논술·면접·실기)를 치른 모든 대학이 매년
 * 스스로 공개해야 하는 법정 자료이고, 실제 출제 문항·출제 의도·교육과정 연계가 함께 실린다.
 *
 * 찾는 순서
 *   1. 시·도교육청 대입정보 CDN 미러 — 학교명으로 URL이 결정되므로 가장 빠르다.
 *   2. 대학 입학처 사이트 — 미러에 없을 때 확인할 검색 경로를 함께 적어 둔다.
 *
 * 결과: data/reports.json  (수집기와 파서 사이의 중간 산출물)
 */
import path from "node:path";
import { DATA, admissionYears, mapLimit, readJson, writeJson } from "./../lib/util.mjs";

const MIRROR = "https://cdn013.negagea.net/dgsmidc/omr/seoul/web";

/** 미러가 보유한 학년도. 오래된 연도는 대학 입학처에서만 구할 수 있다. */
const MIRROR_YEARS = new Set([2025, 2026]);

function mirrorUrl(name, year) {
  const dir = encodeURIComponent(name);
  const file = encodeURIComponent(`${name}_${year}학년도_선행학습영향평가.pdf`);
  return `${MIRROR}/univ_info${year}/${dir}/${file}`;
}

/** HEAD 로 존재 여부만 확인한다. 본문은 파서 단계에서 받는다. */
async function exists(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "univ-interview-bot/1.0 (educational-research)" },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    const size = Number(res.headers.get("content-length") ?? 0);
    // 404 를 200 으로 돌려주는 서버가 있어 최소 크기로 한 번 더 거른다.
    if (size && size < 20000) return null;
    return { size };
  } catch {
    return null;
  }
}

/** 미러에 없을 때 사람이 바로 확인할 수 있는 검색 경로. */
function fallbackSearch(name, year) {
  return {
    naver: `https://search.naver.com/search.naver?query=${encodeURIComponent(`${name} ${year}학년도 선행학습 영향평가 결과보고서`)}`,
    google: `https://www.google.com/search?q=${encodeURIComponent(`"${name}" ${year}학년도 선행학습 영향평가 filetype:pdf`)}`,
    academyinfo: "https://www.academyinfo.go.kr",
  };
}

async function main() {
  const universities = readJson(path.join(DATA, "universities.json"), []);
  if (!universities.length) throw new Error("data/universities.json 이 비어 있습니다. npm run data:universities 를 먼저 실행하세요.");

  const targets = universities.filter((u) => u.type !== "cyber");
  const years = admissionYears(5);
  console.log(`  · 대상 ${targets.length}개교 × ${years.join(", ")}학년도`);

  const jobs = [];
  for (const univ of targets) for (const year of years) jobs.push({ univ, year });

  let hit = 0;
  const results = await mapLimit(jobs, 8, async ({ univ, year }) => {
    if (MIRROR_YEARS.has(year)) {
      const url = mirrorUrl(univ.name, year);
      const found = await exists(url);
      if (found) {
        hit++;
        return {
          univId: univ.id, univName: univ.name, year, url,
          bytes: found.size,
          sourceName: `${univ.name} ${year}학년도 선행학습 영향평가 결과보고서`,
          via: "mirror",
        };
      }
    }
    return { univId: univ.id, univName: univ.name, year, url: null, via: "not-found", search: fallbackSearch(univ.name, year) };
  });

  const found = results.filter((r) => r.url);
  const byUniv = new Set(found.map((r) => r.univId));
  writeJson(path.join(DATA, "reports.json"), results);

  console.log(`  · 보고서 ${found.length}건 확보 (${byUniv.size}개교)`);
  console.log(`  · 미확인 ${results.length - found.length}건 — data/reports.json 의 search 링크로 확인할 수 있습니다.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
