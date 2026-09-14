"""
선행학습 영향평가 보고서 PDF에서 면접 기출문항을 뽑아 data/questions.json 을 만든다.

대학마다 서식이 제각각이라 두 단계로 읽는다.

  1. 규칙 기반(항상 동작)
     - 문서를 '면접 / 논술 / 실기' 구획으로 나눈다. 면접 구획만 남긴다.
     - 구획 안에서 전형명·계열·학과를 문맥으로 들고 다니며 문항 문장을 집는다.
     - 문항마다 원본 PDF의 **페이지 번호**를 붙인다. 그래야 출처를 정확히 댈 수 있다.

  2. LLM 보정(선택, OPENAI_API_KEY 또는 ANTHROPIC_API_KEY 가 있을 때)
     - 규칙 기반이 집은 구획 텍스트를 넘겨 학과·전형·문항·출제의도로 정리시킨다.
     - 키가 없으면 1단계 결과만 쓴다. 즉 키 없이도 데이터는 나온다.

실행: python scripts/collect/parse_reports.py [--limit N] [--llm]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import asdict, dataclass, field

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_text import text_of  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "data")

# ── 구획 판별 ────────────────────────────────────────────────────────────────
# 면접만 모아야 한다. 같은 보고서에 논술·실기 문항이 섞여 있기 때문이다.
INTERVIEW = re.compile(r"(면접|구술|인·?적성\s*면접|제시문\s*기반\s*면접|서류\s*기반\s*면접|MMI|다중\s*미니)")
ESSAY = re.compile(r"(논술|약술형|서술형\s*고사)")
PRACTICAL = re.compile(r"(실기|실기고사|체육\s*실기|미술\s*실기)")

# ── 문항 문장 ────────────────────────────────────────────────────────────────
# 한국어 면접 문항은 명령형 종결이나 의문형으로 끝난다.
QUESTION_TAIL = (
    r"(?:하시오|해\s*보시오|해\s*보세요|말해\s*보시오|말씀해\s*주세요|설명하시오|설명해\s*주세요"
    r"|논하시오|답하시오|답해\s*보시오|보십시오|기술하시오|서술하시오|제시하시오|비교하시오"
    r"|무엇입니까|무엇인가요|무엇인가|하겠습니까|생각합니까|생각하나요|어떻습니까|있습니까"
    r"|이유는\s*무엇|어떻게\s*생각|말해\s*보세요)"
)
QUESTION_RE = re.compile(rf"([^\n]{{6,300}}?{QUESTION_TAIL}\s*[.?]?)")

# 진짜 문항은 문장이 의문형·명령형으로 **끝난다**. 문장 한복판에 그런 말이 들어 있는
# 것만으로는 부족하다. 평가요소 표나 운영 설명이 그렇게 걸려 들기 때문이다.
QUESTION_ENDING = re.compile(rf"(?:{QUESTION_TAIL}|\?)\s*[.?!]?\s*[\"'”’)\]】]?$")

# 문항 번호 표기: 【문제 1】, [문항 2], ※, 1-1., Q1.
QUESTION_MARKER = re.compile(r"^\s*(?:[【\[（(]\s*(?:문제|문항|질문)\s*\d*|※|§|Q\s*\d+|\d+[-.]\d*\s*\.|[①-⑩▪▫])")

# 문항이 아닌 것 — 보고서의 자기 서술, 규정, 운영 문서, 평가 기준표
NOISE = re.compile(
    r"(선행학습\s*영향평가|위원회|위원장|[가-힣]*위원\b|검토위원|자문위원|출제위원|재적위원|전임교원"
    r"|보고서|심의|위촉|소집|개최|제\d+조|규정|지침|서약서|보안|인쇄|파쇄|시험물|기자회견|보도자료"
    r"|일정|절차|목차|붙임|별첨|본교는|본 대학|대학은|평가하고자|바랍니다"
    r"|교육과정\s*범위|고교\s*교육과정을|준수하|유발하|해당\s*없음|하였다\.|한다\."
    r"|점검\s*(?:표|내용|결과)|자체평가|YES\s*NO|[◯○×]\s*$|평가\s*영역\s*평가\s*항목)"
)

# 평가요소 표에서 새어 나오는 조각 — 문항이 아니라 채점 항목 이름이다.
RUBRIC = re.compile(
    r"^(?:[가-힣\s,·]*?(?:역량|능력|의식|태도|노력|이수|사고력|성실성|규칙준수|의사표현)"
    r"[가-힣\s,·§]*)$"
)

# ── 문맥(전형·학과) ──────────────────────────────────────────────────────────
ADMISSION_TYPE = re.compile(
    r"(학생부종합|학생부교과|종합전형|교과전형|지역인재|고른기회|기회균형|사회통합|사회배려"
    r"|농어촌|특성화고|재외국민|논술전형|실기전형|특기자|정시|수시|가군|나군|다군"
    r"|일반전형|면접형|활동우수|계열적합|네오르네상스|미래인재|잠재능력|국가보훈)"
)
# 학과는 '제목 줄'에서만 집는다. 본문 한복판에서 집으면 조사·서술어가 딸려 들어온다.
DEPARTMENT_HEADING = re.compile(
    r"^[\s\[(【]*((?:[가-힣A-Za-z]+\s?){1,4}?(?:학과|학부|전공|계열))[\s\])】]*$"
)
DEPARTMENT_LABELLED = re.compile(r"(?:모집단위|학과|모집\s*단위)\s*[:：]\s*([가-힣A-Za-z·\s]{2,20})")
TRACK = re.compile(r"(인문|자연|사회|예체능|의학|간호|교육|공학|상경|국제)\s*(?:계열|계|분야)")


@dataclass
class Question:
    id: str
    univId: str
    univName: str
    year: int
    department: str | None
    admissionType: str | None
    track: str | None
    question: str
    intent: str | None = None
    page: int = 0
    sourceUrl: str = ""
    sourceName: str = ""
    extractedBy: str = "rule"


@dataclass
class Section:
    """문서에서 잘라낸 한 덩어리. 면접 구획만 살아남는다."""

    kind: str  # interview | essay | practical | unknown
    start_page: int
    pages: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n".join(self.pages)


# 논술 답안지의 표시. 이것이 보이면 면접 페이지가 아니다.
ESSAY_MARKER = re.compile(r"(논제|풀이\s*과정|\(\d{1,3}\s*점\)|답안\s*분량|배점|자수\s*이내|수리\s*논술)")

# 고사 운영·보안 문서. 문항이 아니라 행정 서류다.
ADMIN_MARKER = re.compile(
    r"(전형관리위원|행정관리위원|보안|서약서|인쇄|편철|투봉|파쇄|시험물|고사장 관리"
    r"|기자회견|보도자료|통신기기|출제장소|숙소|경비|수당)"
)


def classify_page(text: str) -> str:
    """
    페이지 하나가 어느 고사에 관한 것인지 고른다.

    제목 줄(첫 3줄)에 실린 말이 본문에 흩어진 말보다 훨씬 믿을 만하다. 보고서 목차나
    머리글 때문에 '면접'이라는 낱말은 논술 페이지에도 흔히 나오기 때문이다.
    """
    lines = [line for line in text.split("\n")[:6] if line.strip()]
    head = " ".join(lines[:3])

    if len(ADMIN_MARKER.findall(text)) >= 2:
        return "admin"
    if ESSAY_MARKER.search(text):
        return "essay"

    scores = {
        "interview": len(INTERVIEW.findall(head)) * 4 + len(INTERVIEW.findall(text)),
        "essay": len(ESSAY.findall(head)) * 4 + len(ESSAY.findall(text)),
        "practical": len(PRACTICAL.findall(head)) * 4 + len(PRACTICAL.findall(text)),
    }
    best = max(scores, key=scores.get)
    # 면접으로 보려면 다른 고사보다 확실히 우세해야 한다.
    if best == "interview" and scores["interview"] <= max(scores["essay"], scores["practical"]) * 1.5:
        return "unknown"
    return best if scores[best] > 0 else "unknown"


def split_sections(pages: list[str]) -> list[Section]:
    """연속한 같은 종류의 페이지를 한 구획으로 묶는다."""
    sections: list[Section] = []
    for index, text in enumerate(pages):
        kind = classify_page(text)
        if sections and sections[-1].kind == kind:
            sections[-1].pages.append(text)
        else:
            sections.append(Section(kind=kind, start_page=index + 1, pages=[text]))
    return sections


def clean(line: str) -> str:
    line = re.sub(r"\s+", " ", line).strip()
    line = re.sub(r"^[-–—•▶▸◦○●□■◇◆*※\s]+", "", line)
    line = re.sub(r"^\(?\d+[).\-]\s*", "", line)
    return line.strip()


# 문장의 끝. 구두점을 요구한다. "…한" + "다고" 처럼 줄이 쪼개질 때
# 종결어미만 보고 끊으면 문항이 토막 난다.
SENTENCE_END = re.compile(r"[.?!]\s*[\"'”’)\]】]?$")
PAGE_NUMBER = re.compile(r"^\s*[-–]?\s*\d{1,3}\s*[-–]?\s*$")
MAX_SENTENCE = 700  # 구두점이 없는 표 페이지에서 한없이 이어붙는 것을 막는다


def reflow(page_text: str) -> list[str]:
    """
    PDF 는 한 문장을 여러 줄로 쪼개 놓는다. 그대로 정규식을 걸면 문항의 꼬리만 잡힌다.
    문장이 끝나지 않은 줄은 다음 줄과 이어 붙여 온전한 문장으로 되돌린다.
    """
    out: list[str] = []
    buffer = ""
    blanks = 0
    for raw in page_text.split("\n"):
        line = clean(raw)
        if not line or PAGE_NUMBER.match(line):
            # 줄마다 빈 줄을 끼워 넣는 PDF가 흔하다. 빈 줄 하나로는 문단을 끊지 않는다.
            blanks += 1
            if blanks >= 2 and buffer:
                out.append(buffer)
                buffer = ""
            continue
        blanks = 0
        # 새 문항 표시가 나오면 앞 문장은 거기서 끊는다.
        if QUESTION_MARKER.match(line) and buffer:
            out.append(buffer)
            buffer = line
        elif buffer:
            buffer = f"{buffer} {line}"
        else:
            buffer = line
        if SENTENCE_END.search(buffer) or len(buffer) > MAX_SENTENCE:
            out.append(buffer)
            buffer = ""
    if buffer:
        out.append(buffer)
    return out


def polish(sentence: str) -> str:
    """문항 앞에 남은 표시·표 머리글을 떼어낸다."""
    sentence = re.sub(r"^\s*(?:§|※|▪|▫|[①-⑩])\s*", "", sentence)
    sentence = re.sub(r"^\s*[【\[（(]\s*(?:문제|문항|질문)\s*\d*\s*[】\]）)]\s*", "", sentence)
    # "인성관련 해당 역할을 …" 처럼 표의 구분 칸이 앞에 붙는 경우
    sentence = re.sub(r"^(?:인성관련|전공관련|공통질문|학업관련|진로관련|구분)\s+", "", sentence)
    # 문항카드 표의 항목 이름이 문항 앞에 붙어 나오는 경우
    sentence = re.sub(
        r"^(?:문항\s*(?:및\s*(?:자료|제시문))?|제시문|가이드|평가\s*요소|질문\s*문항|출제\s*문항)\s*[:：]?\s*",
        "",
        sentence,
    )
    return sentence.strip()


def looks_like_question(line: str) -> bool:
    if len(line) < 12 or len(line) > 400:
        return False
    if NOISE.search(line):
        return False
    if RUBRIC.match(line):
        return False
    # 표 조각·목차 점선
    if line.count("·") > 6 or line.count("…") > 2:
        return False
    # 수식 기호가 많으면 수리 논술 문항이다
    if len(re.findall(r"[＋－×÷≤≥∈∑∫→lim]", line)) >= 2:
        return False
    # 표의 칸이 옆으로 붙어 한 줄이 된 것 — 실제 문항은 이렇게 끝나지 않는다
    if re.search(r"(?:\d+\s*분\s*내외|\d+\s*%|\d+\s*점)\s*[,.]?$", line):
        return False
    # 날짜·개정 이력·숫자 표 (예: "10.23., 2025.02.06.>")
    digits = sum(ch.isdigit() for ch in line)
    if digits > len(line) * 0.3:
        return False
    # 조사·어미로 시작하면 앞이 잘린 조각이다
    if re.match(r"^(?:다고|라고|하고|지만|으로|에서|에게|이나|거나|면서|는데|므로|어서)\b", line):
        return False
    # 제시문 안내문. 그 자체로는 문항이 아니라 뒤따르는 물음의 머리말이다.
    if re.search(r"다음\s*(?:글|제시문|자료|표|그림)[^.]{0,25}(?:읽고|보고)\s*(?:아래\s*)?(?:물음에\s*)?답", line):
        return False
    # 보고서 서식 자체를 설명하는 줄
    if re.search(r"(?:문항\s*정보\s*카드|문항\s*및\s*(?:자료|제시문)\s*\[)", line):
        return False
    return bool(QUESTION_ENDING.search(line))


def find_context(raw_lines: list[str]) -> tuple[str | None, str | None, str | None]:
    """
    문항 앞쪽 줄에서 전형·학과·계열을 집는다. 뒤에서부터 훑어 가장 가까운 값을 쓴다.
    학과는 제목 줄이나 '모집단위:' 표기에서만 받는다.
    """
    department = admission = track = None
    for raw in reversed(raw_lines):
        line = clean(raw)
        if not line:
            continue
        if department is None:
            m = DEPARTMENT_HEADING.match(line) or DEPARTMENT_LABELLED.search(line)
            if m:
                candidate = re.sub(r"\s+", "", m.group(1))
                if 3 <= len(candidate) <= 20 and not NOISE.search(candidate):
                    department = candidate
        if admission is None:
            m = ADMISSION_TYPE.search(line)
            if m:
                admission = m.group(1)
        if track is None:
            m = TRACK.search(line)
            if m:
                track = m.group(1)
        if department and admission and track:
            break
    return department, admission, track


def find_intent(text: str, position: int) -> str | None:
    """문항 뒤에 붙는 '출제 의도' 블록. 대학이 스스로 밝힌 평가 방향이라 답변 지침이 된다."""
    tail = text[position : position + 2500]
    m = re.search(r"출제\s*(?:의도|목적)[^\n]*\n?(.{30,600}?)(?=\n\s*(?:\d+\.|[가-힣]\)|출제\s*근거|문항\s*해설|채점|$))", tail, re.S)
    if not m:
        return None
    intent = re.sub(r"\s+", " ", m.group(1)).strip()
    return intent[:600] if len(intent) > 40 else None


def parse_report(report: dict, pages: list[str]) -> list[Question]:
    sections = [s for s in split_sections(pages) if s.kind == "interview"]
    if not sections:
        return []

    out: list[Question] = []
    seen: set[str] = set()

    for section in sections:
        for offset, page_text in enumerate(section.pages):
            page_no = section.start_page + offset
            raw_lines = page_text.split("\n")
            sentences = reflow(page_text)
            for i, sentence in enumerate(sentences):
                if not looks_like_question(sentence):
                    continue
                key = re.sub(r"\W", "", sentence)[:60]
                if key in seen:
                    continue
                seen.add(key)

                department, admission, track = find_context(sentences[max(0, i - 30) : i] or raw_lines[:40])
                out.append(
                    Question(
                        id=f"{report['univId']}-{report['year']}-{len(out) + 1}",
                        univId=report["univId"],
                        univName=report["univName"],
                        year=report["year"],
                        department=department,
                        admissionType=admission,
                        track=track,
                        question=polish(sentence),
                        intent=find_intent(page_text, page_text.find(sentence[:20])),
                        page=page_no,
                        sourceUrl=report["url"],
                        sourceName=report["sourceName"],
                    )
                )
    return out


# ── LLM 보정 ────────────────────────────────────────────────────────────────
def llm_refine(report: dict, section_text: str) -> list[dict] | None:
    """구획 텍스트를 통째로 넘겨 구조화시킨다. 키가 없으면 None."""
    prompt = (
        "다음은 한국 대학의 「선행학습 영향평가 결과보고서」에서 뽑아낸 면접고사 관련 텍스트다.\n"
        "실제로 수험생에게 주어진 **면접 문항만** 찾아 JSON 배열로 정리하라.\n"
        "각 원소: {\"department\": 학과/모집단위 or null, \"admissionType\": 전형명 or null, "
        "\"track\": 인문/자연/의학 등 계열 or null, \"question\": 문항 원문, "
        "\"intent\": 대학이 밝힌 출제 의도 or null}\n"
        "규칙: 논술·실기 문항, 보고서의 자체 서술(위원 구성·일정·심의 의견)은 제외한다. "
        "문항 원문은 요약하지 말고 그대로 옮긴다. 문항이 없으면 빈 배열 []을 반환한다. "
        "JSON 외의 텍스트는 출력하지 마라.\n\n"
        f"[{report['univName']} {report['year']}학년도]\n{section_text[:60000]}"
    )

    if os.environ.get("OPENAI_API_KEY"):
        body = {
            "model": os.environ.get("OPENAI_MODEL", "gpt-4.1-mini"),
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
        }
        text = _post_json(
            "https://api.openai.com/v1/chat/completions",
            body,
            {"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
        )
        if text:
            return _parse_json_array(text["choices"][0]["message"]["content"])

    if os.environ.get("ANTHROPIC_API_KEY"):
        body = {
            "model": os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5"),
            "max_tokens": 8000,
            "messages": [{"role": "user", "content": prompt}],
        }
        text = _post_json(
            "https://api.anthropic.com/v1/messages",
            body,
            {"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"},
        )
        if text:
            return _parse_json_array(text["content"][0]["text"])

    return None


def _post_json(url: str, body: dict, headers: dict) -> dict | None:
    import urllib.error
    import urllib.request

    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            return json.loads(res.read())
    except Exception as exc:
        print(f"  ! LLM 호출 실패 — {exc}", file=sys.stderr)
        return None


def _parse_json_array(text: str) -> list[dict]:
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    try:
        value = json.loads(text)
        return value if isinstance(value, list) else []
    except json.JSONDecodeError:
        return []


# ── 실행 ────────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="앞에서 N건만 처리(시험용)")
    ap.add_argument("--llm", action="store_true", help="LLM 보정 사용(API 키 필요)")
    args = ap.parse_args()

    with open(os.path.join(DATA, "reports.json"), encoding="utf-8") as fh:
        reports = [r for r in json.load(fh) if r.get("url")]
    if args.limit:
        reports = reports[: args.limit]

    use_llm = args.llm and (os.environ.get("OPENAI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY"))
    if args.llm and not use_llm:
        print("  · --llm 을 주었지만 OPENAI_API_KEY/ANTHROPIC_API_KEY 가 없어 규칙 기반으로만 처리합니다.")

    all_questions: list[dict] = []
    ok = 0
    for i, report in enumerate(reports, 1):
        pages = text_of(report["url"])
        if not pages:
            continue
        questions = parse_report(report, pages)

        if use_llm and questions:
            sections = [s for s in split_sections(pages) if s.kind == "interview"]
            refined = llm_refine(report, "\n".join(s.text for s in sections))
            if refined:
                questions = [
                    Question(
                        id=f"{report['univId']}-{report['year']}-L{n + 1}",
                        univId=report["univId"],
                        univName=report["univName"],
                        year=report["year"],
                        department=item.get("department"),
                        admissionType=item.get("admissionType"),
                        track=item.get("track"),
                        question=(item.get("question") or "").strip(),
                        intent=item.get("intent"),
                        page=sections[0].start_page if sections else 0,
                        sourceUrl=report["url"],
                        sourceName=report["sourceName"],
                        extractedBy="llm",
                    )
                    for n, item in enumerate(refined)
                    if (item.get("question") or "").strip()
                ]

        if questions:
            ok += 1
            all_questions.extend(asdict(q) for q in questions)
        print(f"  [{i}/{len(reports)}] {report['univName']} {report['year']} — 문항 {len(questions)}건", flush=True)

    dest = os.path.join(DATA, "questions.json")
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(all_questions, fh, ensure_ascii=False, indent=2)
    print(f"\n  ✓ data/questions.json — 문항 {len(all_questions)}건 / 보고서 {ok}건")


if __name__ == "__main__":
    main()
