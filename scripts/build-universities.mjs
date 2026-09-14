/**
 * 전국 4년제 대학 + 전문대학 마스터 목록.
 *
 * 출처를 셋 겹쳐 쓴다. 어느 하나도 단독으로는 믿을 수 없기 때문이다.
 *   A. 위키백과 "대한민국의 대학 목록" / "대한민국의 전문대학 목록"
 *      → 표시 이름(label)이 아니라 **문서 제목**을 쓴다. 목록 문서는 종종 훼손된다.
 *        (실제로 [[서울과학기술대학교|서울대학교]] 같은 잘못된 파이프 링크가 있었다.)
 *   B. 시·도별 분류(분류:○○의 대학교 / ○○의 전문대학) → 목록 문서 누락분 보완
 *   C. data/overrides/universities.json → 사람이 직접 고치는 최종 보정 레이어
 *
 * 소재지·홈페이지는 각 문서의 정보상자(infobox)에서 뽑는다.
 */
import path from "node:path";
import { DATA, get, mapLimit, readJson, slugify, writeJson } from "./lib/util.mjs";

const API = "https://ko.wikipedia.org/w/api.php?";

const LIST_PAGES = [
  { page: "대한민국의 대학 목록", type: "university" },
  { page: "대한민국의 전문대학 목록", type: "college" },
];

const SIDO = [
  "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
  "대전광역시", "울산광역시", "세종특별자치시", "경기도", "강원특별자치도",
  "충청북도", "충청남도", "전북특별자치도", "전라남도", "경상북도",
  "경상남도", "제주특별자치도",
];

const REGION_BY_KEYWORD = [
  ["서울", "서울"], ["부산", "부산"], ["대구", "대구"], ["인천", "인천"],
  ["광주", "광주"], ["대전", "대전"], ["울산", "울산"], ["세종", "세종"],
  ["경기", "경기"], ["강원", "강원"],
  ["충청북도", "충북"], ["충북", "충북"], ["충청남도", "충남"], ["충남", "충남"],
  ["전라북도", "전북"], ["전북", "전북"], ["전라남도", "전남"], ["전남", "전남"],
  ["경상북도", "경북"], ["경북", "경북"], ["경상남도", "경남"], ["경남", "경남"],
  ["제주", "제주"],
];

/** 대학 문서가 아닌 것 — 대학원·목록·틀·연구소·학부 단위 문서 */
const NOT_A_SCHOOL =
  /(대학원|목록|^틀:|^분류:|연구소|연구원$|병원$|박물관|축구부|야구부|총학생회|사태|사건|등록금|면적|캠퍼스 목록|부속|여자고등학교|고등학교)/;

/** 대학으로 볼 문서 제목 */
const LOOKS_LIKE_SCHOOL = /(대학교|대학|과학기술원|사관학교|폴리텍)/;

async function api(params) {
  const body = await get(API + new URLSearchParams({ format: "json", formatversion: "2", ...params }));
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function wikitext(page) {
  const json = await api({ action: "parse", page, prop: "wikitext", redirects: "1" });
  return json?.parse?.wikitext ?? null;
}

/** 문서 제목만 뽑는다. 표시 이름은 훼손되기 쉬우므로 쓰지 않는다. */
function parseListPage(text) {
  const titles = new Set();
  for (const m of text.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g)) {
    const title = m[1].trim();
    if (!LOOKS_LIKE_SCHOOL.test(title)) continue;
    if (NOT_A_SCHOOL.test(title)) continue;
    if (/^(대학|전문대학|사이버대학|대학교|각종학교|방송통신대학)$/.test(title)) continue;
    titles.add(title);
  }
  return [...titles];
}

async function categoryMembers(category) {
  const out = [];
  let cont;
  for (let i = 0; i < 10; i++) {
    const json = await api({
      action: "query", list: "categorymembers", cmtitle: category,
      cmlimit: "500", cmtype: "page", ...(cont ? { cmcontinue: cont } : {}),
    });
    const members = json?.query?.categorymembers ?? [];
    out.push(...members.map((m) => m.title));
    cont = json?.continue?.cmcontinue;
    if (!cont) break;
  }
  return out.filter((t) => LOOKS_LIKE_SCHOOL.test(t) && !NOT_A_SCHOOL.test(t));
}

function detectRegion(text) {
  const field = text.match(/\|\s*(?:소재지|위치|주소)\s*=\s*([^\n|]+)/)?.[1] ?? "";
  const haystack = field || text.slice(0, 2500);
  for (const [needle, region] of REGION_BY_KEYWORD) {
    if (haystack.includes(needle)) return region;
  }
  return null;
}

function detectHomepage(text) {
  const field = text.match(/\|\s*(?:웹사이트|홈페이지|website)\s*=\s*([^\n|]+)/i)?.[1] ?? "";
  const url =
    field.match(/https?:\/\/[^\s|}\]]+/)?.[0] ??
    text.match(/\{\{URL\|(https?:\/\/[^|}]+)/i)?.[1] ??
    text.match(/\{\{공식 웹사이트\|(https?:\/\/[^|}]+)/)?.[1] ??
    null;
  return url ? url.replace(/[.,)]+$/, "") : null;
}

/**
 * university = 4년제, college = 전문대,
 * cyber = 원격·사이버대(고3 수시 면접 대상이 아니므로 UI에서 뺀다).
 * 정보상자 "종류"가 1순위 근거다.
 */
function detectType(text, hint, title) {
  const kind = text.match(/\|\s*종류\s*=\s*([^\n|]+)/)?.[1] ?? "";
  if (/사이버|원격/.test(kind) || /사이버대학|원격대학/.test(title)) return "cyber";
  if (/전문대학/.test(kind)) return "college";
  if (/전문대학/.test(text.slice(0, 1200)) && !/대학교로 (승격|전환)/.test(text)) return hint ?? "college";
  return hint === "college" ? "college" : "university";
}

/** "공군사관학교 (대한민국)" 처럼 위키백과 동음이의 꼬리표를 떼고 학교 이름만 남긴다. */
function cleanName(title) {
  return title.replace(/\s*\((?:대한민국|한국|경기|서울|충남|전북|경남)\)\s*$/, "").trim();
}

async function main() {
  /** @type {Map<string, {title: string, type: string|null, regionHint: string|null}>} */
  const found = new Map();
  const add = (title, type, regionHint = null) => {
    const existing = found.get(title);
    if (existing) {
      existing.type ??= type;
      existing.regionHint ??= regionHint;
    } else {
      found.set(title, { title, type, regionHint });
    }
  };

  // A. 목록 문서
  for (const { page, type } of LIST_PAGES) {
    const text = await wikitext(page);
    if (!text) throw new Error(`위키백과 목록을 불러오지 못했습니다: ${page}`);
    const titles = parseListPage(text);
    console.log(`  · 목록 ${page}: ${titles.length}건`);
    titles.forEach((t) => add(t, type));
  }

  // B. 시·도별 분류
  let fromCategory = 0;
  for (const sido of SIDO) {
    for (const [suffix, type] of [["대학교", "university"], ["전문대학", "college"]]) {
      const region = REGION_BY_KEYWORD.find(([needle]) => sido.startsWith(needle))?.[1] ?? null;
      for (const title of await categoryMembers(`분류:${sido}의 ${suffix}`)) {
        if (!found.has(title)) fromCategory++;
        add(title, type, region);
      }
    }
  }
  console.log(`  · 시·도 분류에서 추가로 발견: ${fromCategory}건`);

  // 정보상자 조회
  const entries = [...found.values()];
  console.log(`  · 정보상자 조회 ${entries.length}건 …`);
  const enriched = await mapLimit(
    entries,
    2,
    async (entry) => {
      const text = await wikitext(entry.title);
      if (!text) return { ...entry, region: entry.regionHint, homepage: null, type: entry.type ?? "university" };
      return {
        ...entry,
        region: detectRegion(text) ?? entry.regionHint,
        homepage: detectHomepage(text),
        type: detectType(text, entry.type, entry.title),
      };
    },
    { gap: 200 }
  );

  // C. 사람이 고치는 보정 레이어
  const overrides = readJson(path.join(DATA, "overrides", "universities.json"), { add: [], patch: {}, remove: [] });
  const removed = new Set(overrides.remove ?? []);

  const byId = new Map();
  for (const u of [...enriched, ...(overrides.add ?? [])]) {
    const name = u.name ?? cleanName(u.title);
    const id = slugify(name);
    if (removed.has(id) || removed.has(name)) continue;
    byId.set(id, {
      id,
      name,
      type: u.type ?? "university",
      region: u.region ?? null,
      homepage: u.homepage ?? null,
      wikipedia: u.wikipedia ?? `https://ko.wikipedia.org/wiki/${encodeURIComponent(u.title ?? name)}`,
      ...(overrides.patch?.[id] ?? {}),
    });
  }

  const universities = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  writeJson(path.join(DATA, "universities.json"), universities);

  const count = (t) => universities.filter((u) => u.type === t).length;
  const four = count("university");
  const missing = universities.filter((u) => !u.region);
  console.log(`  · 4년제 ${four}개교, 전문대 ${count("college")}개교, 사이버·원격대 ${count("cyber")}개교(UI 제외)`);
  if (missing.length) console.log(`  · 소재지 미확인 ${missing.length}건: ${missing.map((u) => u.name).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
