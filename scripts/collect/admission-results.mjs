/**
 * 전년도 입시결과(입결)를 모은다.
 *
 * 왜 별도 수집기인가
 *   선행학습 영향평가 보고서에는 면접 문항만 실리고 입결은 들어 있지 않다. 실제로 표본
 *   25건을 확인해 보니 경쟁률이 언급된 보고서는 4건뿐이었다. 입결은 다른 창구에서 받아야 한다.
 *
 * 어디서 받는가
 *   한국대학교육협의회가 공공데이터포털로 공개하는 「대학정보공시 학생 현황」 REST API.
 *   공식·무료이고 전국 대학이 같은 형식으로 들어 있어 자동 갱신에 맞는다.
 *
 * 무엇을 받는가 — 한계를 분명히 해 둔다
 *   이 API 가 주는 것은 **대학 단위 정원내 신입생 경쟁률**이다. 학생이 정말 알고 싶어 하는
 *   학과·전형별 50%/70% 등급 컷은 여기 없다. 그건 각 대학 입학처가 저마다 다른 형식으로
 *   공개하므로 화면에서 링크로 안내한다. 없는 값을 있는 것처럼 채우지 않는다.
 *
 * 필요한 것 — 환경변수
 *   DATA_GO_KR_KEY       공공데이터포털 인증키(Decoding 키)
 *   DATA_GO_KR_ENDPOINT  오퍼레이션까지 포함한 호출 URL
 *     예) https://apis.data.go.kr/B340014/StudentService/getComparisonInsideFixedNumberFreshmanCompetitionRatio
 *
 * 키가 없거나 받아온 행이 없으면 기존 파일을 그대로 둔다. 모아 둔 데이터가 실수로 지워지지
 * 않게 하기 위해서다.
 */
import path from "node:path";
import { DATA, admissionYears, readJson, sleep, writeJson } from "./../lib/util.mjs";

const KEY = process.env.DATA_GO_KR_KEY;
const ENDPOINT = process.env.DATA_GO_KR_ENDPOINT;

/** 이 서비스의 기본 응답은 XML 이다. 필드 이름이 공시 항목마다 달라 후보를 늘어놓는다. */
const FIELD = {
  univName: ["schlNm", "schoolName", "univNm", "schlEstbNm", "학교명"],
  year: ["svyYr", "yr", "stdYr", "기준연도"],
  competitionRate: ["cmptRt", "cmpttRt", "compRate", "fresmnCmptRt", "경쟁률"],
  quota: ["mrcnt", "entsCnt", "fixNmpr", "모집인원"],
  region: ["reg", "regionNm", "지역"],
};

/** 의존성 없이 쓰는 얕은 XML 파서. 이 응답은 중첩이 없는 평평한 <item> 목록이다. */
function parseXmlItems(xml) {
  const items = [];
  for (const block of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const row = {};
    for (const field of block[1].matchAll(/<([A-Za-z0-9_가-힣]+)>([\s\S]*?)<\/\1>/g)) {
      row[field[1]] = field[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
    }
    items.push(row);
  }
  return items;
}

function xmlTag(xml, tag) {
  return xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? null;
}

function pick(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== "") return row[name];
  }
  return null;
}

const toNumber = (value) => {
  if (value == null) return null;
  const n = Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

async function fetchPage(year, pageNo) {
  const url =
    `${ENDPOINT}${ENDPOINT.includes("?") ? "&" : "?"}` +
    new URLSearchParams({
      serviceKey: KEY,
      pageNo: String(pageNo),
      numOfRows: "1000",
      svyYr: String(year),
    });

  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();

  // 오류는 JSON 이든 XML 이든 errMsg / returnAuthMsg 로 온다.
  const error = xmlTag(body, "errMsg");
  if (error) {
    const reason = xmlTag(body, "returnAuthMsg");
    throw new Error(reason && reason !== error ? `${error} (${reason})` : error);
  }

  if (body.trimStart().startsWith("{")) {
    const json = JSON.parse(body);
    const node = json?.response?.body ?? json?.body ?? json;
    const items = node?.items?.item ?? node?.items ?? node?.data ?? [];
    return {
      rows: Array.isArray(items) ? items : [items].filter(Boolean),
      totalCount: Number(node?.totalCount ?? 0),
    };
  }

  return { rows: parseXmlItems(body), totalCount: Number(xmlTag(body, "totalCount") ?? 0) };
}

async function main() {
  const universities = readJson(path.join(DATA, "universities.json"), []);
  const byName = new Map(universities.map((u) => [u.name.replace(/\s+/g, ""), u]));

  if (!KEY || !ENDPOINT) {
    console.log("  · DATA_GO_KR_KEY / DATA_GO_KR_ENDPOINT 가 없어 입결 수집을 건너뜁니다.");
    console.log("    https://www.data.go.kr 에서 '한국대학교육협의회 대학정보공시 학생 현황' 활용신청 후");
    console.log("    인증키와 '오퍼레이션까지 포함한' 호출 URL 을 .env.local 에 넣으세요.");
    return;
  }
  if (!/\/get[A-Za-z]/.test(ENDPOINT)) {
    console.log("  ! DATA_GO_KR_ENDPOINT 에 오퍼레이션 이름이 빠진 것 같습니다.");
    console.log(`    지금 값: ${ENDPOINT}`);
    console.log("    예) .../StudentService/getComparisonInsideFixedNumberFreshmanCompetitionRatio");
  }

  const years = admissionYears(5);
  const collected = [];
  let lastError = null;

  for (const year of years) {
    let pageNo = 1;
    let total = Infinity;
    let seen = 0;
    const before = collected.length;

    while (seen < total && pageNo <= 30) {
      let page;
      try {
        page = await fetchPage(year, pageNo);
      } catch (err) {
        lastError = err.message;
        console.warn(`  ! ${year}년 ${pageNo}쪽 — ${err.message}`);
        break;
      }
      if (!page.rows.length) break;
      total = page.totalCount || page.rows.length;
      seen += page.rows.length;
      pageNo++;
      await sleep(200); // 일일 트래픽 한도가 있으므로 천천히 부른다

      for (const row of page.rows) {
        const rawName = String(pick(row, FIELD.univName) ?? "").replace(/\s+/g, "");
        const univ = byName.get(rawName);
        if (!univ) continue;

        const competitionRate = toNumber(pick(row, FIELD.competitionRate));
        if (competitionRate == null) continue;

        collected.push({
          univId: univ.id,
          univName: univ.name,
          year: toNumber(pick(row, FIELD.year)) ?? year,
          // 이 공시는 대학 단위 집계다. 학과·전형을 지어내지 않는다.
          department: "대학 전체 (정원내 신입생)",
          admissionType: "전체",
          quota: toNumber(pick(row, FIELD.quota)),
          competitionRate,
          grade50: null,
          grade70: null,
          note: "대학정보공시 기준 정원내 신입생 경쟁률. 학과·전형별 등급 컷은 각 대학 입학처 공개자료를 보세요.",
          sourceUrl: "https://www.academyinfo.go.kr",
          sourceName: `대학정보공시(대학알리미) ${year}년 정원내 신입생 경쟁률`,
        });
      }
    }
    console.log(`  · ${year}년 — ${collected.length - before}건`);
  }

  if (!collected.length) {
    console.log("  · 받아온 행이 없어 기존 파일을 유지합니다.");
    if (lastError?.includes("NO_OPENAPI_SERVICE")) {
      console.log("    승인 직후에는 게이트웨이 반영에 1~2시간이 걸립니다. 잠시 뒤 다시 실행해 보세요.");
    }
    return;
  }
  writeJson(path.join(DATA, "admission-results.json"), collected);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
