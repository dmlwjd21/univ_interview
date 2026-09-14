#!/usr/bin/env python3
"""
대입 면접 기출 수집기

「공교육 정상화 촉진 및 선행교육 규제에 관한 특별법」 제10조에 따라
면접·구술고사를 실시한 대학은 그 해 기출문항이 담긴
'선행학습 영향평가 결과보고서'를 매년 3월 31일까지 공개해야 한다.
서울시교육청 진로진학정보센터가 이를 규칙적인 주소로 모아 두고 있어
연도와 대학명만으로 내려받을 수 있다.

동작
  1단계  보고서 PDF를 내려받아 텍스트에서 질문형 문장을 추려낸다. (API 키 불필요)
  2단계  API 키가 있으면 그 결과를 언어모델에 넘겨 전형·모집단위별로 정리한다. (선택)

결과
  data/questions.json  앱이 읽는 기출 자료
  data/report.json     대학별 수집 성공·실패 기록
"""

from __future__ import annotations
import argparse, datetime, json, os, re, sys, time
from pathlib import Path
from urllib.parse import quote
import urllib.request, urllib.error

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = ROOT / ".cache"
ARCHIVE = "https://cdn013.negagea.net/dgsmidc/omr/seoul/web/univ_info"
UA = "Mozilla/5.0 (compatible; interview-archive/1.0)"

# ── 문항 판별 규칙 ──────────────────────────────────────────
# 한국어 면접 문항은 물음표로 끝나거나 '하시오 / 보세요 / 설명하라' 류로 끝난다.
# 물음표, 그리고 면접관이 실제로 쓰는 말투만 인정한다.
# '~하시오 / ~하십시오'는 논술 답안 지시문과 안내 문구에서 훨씬 많이 나오므로 뺀다.
Q_TAIL = re.compile(
    r"(\?|말해\s*보세요\.?|말해\s*주세요\.?|말씀해\s*주세요\.?|설명해\s*보세요\.?|"
    r"설명해\s*주세요\.?|얘기해\s*주세요\.?|이야기해\s*주세요\.?|해\s*보세요\.?|"
    r"해\s*주세요\.?|해\s*주시겠어요\.?|말해\s*볼까요\.?)\s*$"
)
# 깨진 텍스트에서 나오는 떠다니는 문장부호
JUNK = re.compile(r"(\s[(),.\[\]]\s.*){2,}|^[(),.\[\]]|[(),.\[\]]\s*[(),.\[\]]")
HANGUL = re.compile(r"[가-힣]")
# 문항이 아닌데 위 규칙에 걸리는 것들
NOT_Q = re.compile(
    r"(참고하시오|유의하시오|기재하시오|작성하시오|제출하시오|확인하시기|"
    r"바랍니다|하여야 한다|하지 않았음|평가하였|출제하였|구성하였|"
    r"답안|배점|채점|감수위원|출제위원|위원회|영향평가|교육과정 범위)"
)
# 보고서 서술체·수험생 후기체. 문항이 아니라 설명문이다.
NARRATION = re.compile(r"(하였음|되었음|이해함|생각함|같았음|말았음|였음|겠음)\s*[.·]?")
# 문항카드 부록이 시작되는 지점
CARD_START = re.compile(r"(문\s*항\s*카\s*드|면접\s*문항|구술\s*문항|기출\s*문항|예시\s*문항|문항\s*및\s*출제)")
# 앞뒤에서 주워 담을 맥락
CTX_ADM = re.compile(r"(학생부종합|학생부교과|논술|특기자|재외국민|지역인재|고른기회|실기|정시|수시)[^\n]{0,30}")
CTX_MAJ = re.compile(r"(모집단위|지원학과|학과|학부|전공|계열)\s*[:：]?\s*([^\n]{2,30})")


def log(*a):
    print(*a, flush=True)


def fetch(url: str, timeout: int = 60) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code != 404:
            log(f"      HTTP {e.code}")
        return None
    except Exception as e:
        log(f"      {type(e).__name__}")
        return None


def report_url(name: str, year: int) -> str:
    """앱의 링크 생성 규칙과 완전히 동일해야 한다."""
    n = quote(name, safe="()")
    f = quote(f"{name}_{year}학년도_선행학습영향평가", safe="()_")
    return f"{ARCHIVE}{year}/{n}/{f}.pdf"


def pdf_text(raw: bytes) -> str:
    import pymupdf
    doc = pymupdf.open(stream=raw, filetype="pdf")
    try:
        return "\n".join(p.get_text() for p in doc)
    finally:
        doc.close()


def clean(line: str) -> str:
    s = line.strip()
    s = re.sub(r"^[\s\-•○●◦▪□■▶▸◂※*]+", "", s)          # 글머리표
    s = re.sub(r"^\[?(문항|질문|Q)\s*\d*[\]\.\):]?\s*", "", s)  # 문항 번호
    s = re.sub(r"^\d{1,2}\s*[\.\)]\s*", "", s)              # 숫자 번호
    s = re.sub(r"\s{2,}", " ", s)
    return s.strip()


def extract(text: str) -> list[dict]:
    """PDF 전체 텍스트에서 문항 후보를 뽑는다."""
    lines = [l.rstrip() for l in text.split("\n")]
    # 줄바꿈으로 끊긴 문장을 이어 붙인다
    merged, buf = [], ""
    for l in lines:
        s = l.strip()
        if not s:
            if buf:
                merged.append(buf); buf = ""
            continue
        buf = (buf + " " + s).strip() if buf else s
        if Q_TAIL.search(buf) or len(buf) > 400:
            merged.append(buf); buf = ""
    if buf:
        merged.append(buf)

    in_card = False
    out, adm, maj = [], "", ""
    for s in merged:
        if CARD_START.search(s):
            in_card = True
        m = CTX_ADM.search(s)
        if m and len(s) < 80:
            adm = m.group(0).strip()
        m = CTX_MAJ.search(s)
        if m and len(s) < 80:
            maj = m.group(2).strip()

        # 앞 문장이 딸려 온 경우가 많다. 물음으로 끝나는 마지막 문장만 남긴다.
        parts = re.split(r"(?<=[.?!])\s+", s)
        tail = ""
        for p in parts:
            if Q_TAIL.search(p.strip()):
                tail = p.strip()
        c = clean(tail or s)

        if not (12 <= len(c) <= 250):
            continue
        if not Q_TAIL.search(c) or NOT_Q.search(c) or NARRATION.search(c):
            continue
        if JUNK.search(c):
            continue
        # 한글이 절반 미만이면 표·수식·깨진 텍스트다
        if len(HANGUL.findall(c)) < len(c) * 0.5:
            continue
        out.append({"q": c, "adm": adm, "major": maj, "card": in_card})

    # 중복 제거, 순서 유지
    seen, uniq = set(), []
    for o in out:
        k = re.sub(r"\s", "", o["q"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(o)
    return uniq


# ── 2단계: 언어모델 정리 (선택) ─────────────────────────────
PROMPT = """다음은 한국 대학의 '선행학습 영향평가 결과보고서' PDF에서 기계적으로 뽑아낸 문장들이다.
이 중 실제 대학 입학 면접·구술고사에서 수험생에게 던진 질문만 골라 정리하라.

규칙
- 면접 질문이 아닌 것(법령 문구, 보고서 서술, 안내 문구, 논술 답안 작성 지시)은 모두 버린다.
- 질문 문장은 원문 그대로 두고 고쳐 쓰지 않는다.
- 같은 모집단위·전형끼리 묶는다. 판단할 수 없으면 빈 문자열로 둔다.
- 결과가 하나도 없으면 빈 배열을 반환한다.

JSON 배열만 출력하고 다른 말은 쓰지 마라. 각 원소의 형식:
{"adm":"전형명","major":"모집단위","field":"인문|사회|자연|공학|정보·SW|의약·보건|교육|예체능|농림·수산 중 하나 또는 빈 문자열","qs":["질문1","질문2"]}

대학: %s / %d학년도
문장 목록:
%s"""


def refine(univ: str, year: int, cands: list[dict]) -> list[dict] | None:
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not key or not cands:
        return None
    joined = "\n".join("- " + c["q"] for c in cands[:220])
    prompt = PROMPT % (univ, year, joined)

    try:
        if os.environ.get("GEMINI_API_KEY"):
            url = ("https://generativelanguage.googleapis.com/v1beta/models/"
                   "gemini-2.0-flash:generateContent?key=" + key)
            body = {"contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0, "maxOutputTokens": 8192}}
            req = urllib.request.Request(url, json.dumps(body).encode(),
                                         {"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as r:
                j = json.load(r)
            txt = j["candidates"][0]["content"]["parts"][0]["text"]
        else:
            body = {"model": "claude-sonnet-4-6", "max_tokens": 8192,
                    "messages": [{"role": "user", "content": prompt}]}
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages", json.dumps(body).encode(),
                {"Content-Type": "application/json", "x-api-key": key,
                 "anthropic-version": "2023-06-01"})
            with urllib.request.urlopen(req, timeout=180) as r:
                j = json.load(r)
            txt = "".join(b.get("text", "") for b in j["content"])

        txt = re.sub(r"^```(?:json)?|```$", "", txt.strip(), flags=re.M).strip()
        got = json.loads(txt)
        return [x for x in got if isinstance(x, dict) and x.get("qs")]
    except Exception as e:
        log(f"      정리 단계 건너뜀: {type(e).__name__}")
        return None


# ── 메인 ────────────────────────────────────────────────────
def latest_year(today: datetime.date | None = None) -> int:
    t = today or datetime.date.today()
    return t.year if t.month >= 4 else t.year - 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=5, help="최근 몇 개 학년도를 볼지")
    ap.add_argument("--only", default="", help="쉼표로 구분한 대학명. 시험 실행용")
    ap.add_argument("--sleep", type=float, default=0.7, help="요청 간격(초)")
    ap.add_argument("--no-refine", action="store_true", help="언어모델 정리 생략")
    args = ap.parse_args()

    CACHE.mkdir(exist_ok=True)
    univs = json.loads((DATA / "universities.json").read_text(encoding="utf-8"))
    if args.only:
        want = {s.strip() for s in args.only.split(",")}
        univs = [u for u in univs if u["name"] in want]

    top = latest_year()
    years = [top - i for i in range(args.years)]
    log(f"기준 {top}학년도 · 수집 범위 {years[-1]}~{top} · 대상 {len(univs)}개 대학\n")

    # 이미 모은 것은 다시 받지 않는다
    out_path = DATA / "questions.json"
    old = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else []
    have = {(q["univ"], q["year"]) for q in old}
    items = list(old)

    ok = skip = miss = 0
    log_rows = []

    for u in univs:
        name, typ = u["name"], u["type"]
        if typ != "4년제":
            # 전문대는 이 아카이브에 없다. 입학처에서 직접 받아야 한다.
            log_rows.append({"univ": name, "year": None, "status": "아카이브 미수록(전문대)"})
            continue

        for y in years:
            if (name, y) in have:
                skip += 1
                continue

            url = report_url(name, y)
            log(f"  {name} {y}학년도")
            raw = fetch(url)
            time.sleep(args.sleep)
            if not raw or not raw.startswith(b"%PDF"):
                miss += 1
                log_rows.append({"univ": name, "year": y, "status": "보고서 없음", "url": url})
                continue

            try:
                text = pdf_text(raw)
            except Exception as e:
                log(f"      PDF 열기 실패: {type(e).__name__}")
                log_rows.append({"univ": name, "year": y, "status": "PDF 열기 실패", "url": url})
                continue

            cands = extract(text)
            if not cands:
                log_rows.append({"univ": name, "year": y, "status": "문항 없음(논술만 실시 등)", "url": url})
                continue

            groups = None if args.no_refine else refine(name, y, cands)
            if groups is None:
                # 정리 단계를 건너뛴 경우, 문항카드 안에서 나온 것만 신뢰한다
                picked = [c["q"] for c in cands if c["card"]] or [c["q"] for c in cands]
                groups = [{"adm": "", "major": "", "field": "", "qs": picked[:60]}]

            for gidx, grp in enumerate(groups):
                items.append({
                    "univ": name, "type": typ, "year": y,
                    "adm": grp.get("adm", ""), "major": grp.get("major", ""),
                    "field": grp.get("field", ""), "method": "",
                    "qs": grp["qs"], "note": "",
                    "src": {"k": "official",
                            "t": f"{y}학년도 {name} 선행학습 영향평가 결과보고서",
                            "p": "", "u": url},
                    "auto": True,
                })
            ok += 1
            n = sum(len(g["qs"]) for g in groups)
            log(f"      문항 {n}건 수집")
            log_rows.append({"univ": name, "year": y, "status": f"수집 {n}건", "url": url})

    out_path.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA / "report.json").write_text(json.dumps({
        "updated": datetime.datetime.now().isoformat(timespec="seconds"),
        "latestYear": top, "years": years,
        "counts": {"수집": ok, "건너뜀": skip, "보고서없음": miss,
                   "문항총계": sum(len(i["qs"]) for i in items)},
        "rows": log_rows,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    log(f"\n수집 {ok} · 건너뜀 {skip} · 보고서 없음 {miss}")
    log(f"문항 총계 {sum(len(i['qs']) for i in items)}건 → data/questions.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
