/**
 * 전년도 입시결과(입결)를 모은다.
 *
 * 왜 별도 수집기인가
 *   선행학습 영향평가 보고서에는 면접 문항만 실리고 입결은 들어 있지 않다. 실제로 확인해 본
 *   결과 보고서 안에 경쟁률이 나오는 경우는 드물었다. 입결은 다른 창구에서 받아야 한다.
 *
 * 어디서 받는가
 *   한국대학교육협의회가 공공데이터포털(data.go.kr)로 공개하는 대학정보공시 API 를 쓴다.
 *   공식·무료이고 전국 대학이 같은 형식으로 들어 있어 자동 갱신에 맞는다.
 *
 * 필요한 것 — 환경변수
 *   DATA_GO_KR_KEY       공공데이터포털 인증키(Decoding 키)
 *   DATA_GO_KR_ENDPOINT  활용신청한 오퍼레이션의 호출 URL
 *                        (포털의 "활용신청 상세" 화면에 그대로 적혀 있다)
 *
 * 키가 없으면 아무것도 덮어쓰지 않고 안내만 하고 끝낸다. 그래야 이미 모아 둔 데이터가
 * 실수로 지워지지 않는다.
 */
import path from "node:path";
import { DATA, admissionYears, mapLimit, readJson, writeJson } from "./../lib/util.mjs";

const KEY = process.env.DATA_GO_KR_KEY;
const ENDPOINT = process.env.DATA_GO_KR_ENDPOINT;

/** 응답 필드 이름이 공시 항목마다 조금씩 달라 후보를 늘어놓고 먼저 잡히는 것을 쓴다. */
const FIELD = {
  univName: ["schlNm", "schoolName", "univNm", "학교명"],
  department: ["mjrNm", "deptNm", "학과명", "majorName"],
  admissionType: ["admsTypeNm", "전형명", "admissionType"],
  quota: ["mrcnt", "모집인원", "quota"],
  competitionRate: ["cmptRt", "경쟁률", "competitionRate", "cmpttRt"],
  year: ["yr", "기준연도", "year", "std_year"],
};

function pick(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== "") return row[name];
  }
  return null;
}

const toNumber = (value) => {
  if (value == null) return null;
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

async function fetchPage(year, pageNo) {
  const url =
    `${ENDPOINT}${ENDPOINT.includes("?") ? "&" : "?"}` +
    new URLSearchParams({
      serviceKey: KEY,
      pageNo: String(pageNo),
      numOfRows: "1000",
      type: "json",
      svyYr: String(year),
    });

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    // 인증키 오류·트래픽 초과는 XML 로 온다.
    const message = text.match(/<returnAuthMsg>([^<]*)<|<errMsg>([^<]*)</)?.slice(1).find(Boolean);
    throw new Error(message ?? "XML 오류 응답 (인증키 또는 엔드포인트를 확인하세요)");
  }

  const json = JSON.parse(text);
  const body = json?.response?.body ?? json?.body ?? json;
  const items = body?.items?.item ?? body?.items ?? [];
  return {
    rows: Array.isArray(items) ? items : [items].filter(Boolean),
    totalCount: Number(body?.totalCount ?? 0),
  };
}

async function main() {
  const universities = readJson(path.join(DATA, "universities.json"), []);
  const byName = new Map(universities.map((u) => [u.name.replace(/\s+/g, ""), u]));

  if (!KEY || !ENDPOINT) {
    console.log("  · DATA_GO_KR_KEY / DATA_GO_KR_ENDPOINT 가 없어 입결 수집을 건너뜁니다.");
    console.log("    1) https://www.data.go.kr 에서 '한국대학교육협의회 대학정보공시' 오픈API 활용신청");
    console.log("    2) 발급받은 인증키와 호출 URL 을 .env 에 넣고 다시 실행하세요.");
    console.log("    기존 data/admission-results.json 은 그대로 둡니다.");
    return;
  }

  const years = admissionYears(5);
  const collected = [];

  for (const year of years) {
    let pageNo = 1;
    let total = Infinity;
    let seen = 0;

    while (seen < total && pageNo <= 50) {
      let page;
      try {
        page = await fetchPage(year, pageNo);
      } catch (err) {
        console.warn(`  ! ${year}년 ${pageNo}쪽 — ${err.message}`);
        break;
      }
      if (!page.rows.length) break;
      total = page.totalCount || page.rows.length;
      seen += page.rows.length;
      pageNo++;

      for (const row of page.rows) {
        const rawName = String(pick(row, FIELD.univName) ?? "").replace(/\s+/g, "");
        const univ = byName.get(rawName);
        if (!univ) continue;

        const department = pick(row, FIELD.department);
        const competitionRate = toNumber(pick(row, FIELD.competitionRate));
        if (!department && competitionRate == null) continue;

        collected.push({
          univId: univ.id,
          univName: univ.name,
          year: toNumber(pick(row, FIELD.year)) ?? year,
          department: String(department ?? "전체"),
          admissionType: String(pick(row, FIELD.admissionType) ?? "전체"),
          quota: toNumber(pick(row, FIELD.quota)),
          competitionRate,
          grade50: null,
          grade70: null,
          note: "대학정보공시 기준. 등급 컷은 각 대학 입학처 공개자료를 확인하세요.",
          sourceUrl: "https://www.academyinfo.go.kr",
          sourceName: `대학정보공시(대학알리미) ${year}년`,
        });
      }
    }
    console.log(`  · ${year}년 — ${collected.filter((r) => r.year === year).length}건`);
  }

  if (!collected.length) {
    console.log("  · 받아온 행이 없어 기존 파일을 유지합니다.");
    return;
  }
  writeJson(path.join(DATA, "admission-results.json"), collected);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
