"""
시·도교육청·진학지원센터가 펴낸 면접 지도 자료에서 준비 요령을 뽑아 data/tips.json 을 만든다.

이 자료들은 저작권이 있는 배포본이므로 저장소에 PDF 를 넣지 않는다. 대신 로컬에 있는
파일을 가리키는 목록(scripts/collect/guides.json)을 읽어 처리하고, 결과 JSON 만 커밋한다.
자료가 없으면 조용히 건너뛰므로 다른 사람이 받아 가도 빌드가 깨지지 않는다.

실행: python scripts/collect/parse_guides.py
"""
from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdf_text  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "data")
GUIDES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "guides.json")

# 본문이 아닌 면 — 표지, 차례, 판권
SKIP_TITLE = re.compile(r"^(차례|목차|표지|발간|저작권|참고문헌|부록 목록)?$")
NOISE_LINE = re.compile(r"^(면접 지도 가이드북|셀프면접|\d+|[-–]\s*\d+\s*[-–])$")


def clean_lines(text: str) -> list[str]:
    out = []
    for raw in text.split("\n"):
        line = re.sub(r"\s+", " ", raw).strip()
        if not line or NOISE_LINE.match(line):
            continue
        out.append(line)
    return out


def page_to_tip(lines: list[str]) -> tuple[str, str, str] | None:
    """
    한 면이 곧 한 꼭지다. 이 자료들은 '한 면에 한 주제'로 짜여 있어서
    첫 줄들이 분류·제목, 나머지가 본문이 된다.
    """
    if len(lines) < 5:
        return None

    # 첫 줄이 "제1부 공통 · 04" 같은 머리글이면 분류로 쓰고 다음 줄을 제목으로 삼는다
    category = "공통"
    title_index = 0
    if re.match(r"^(제\s*\d+\s*부|부록)", lines[0]):
        category = re.sub(r"\s*·\s*\d+$", "", lines[0]).strip()
        title_index = 1

    title = lines[title_index]
    if SKIP_TITLE.match(title) or len(title) > 60:
        return None

    body_lines = lines[title_index + 1 :]
    # 부제가 짧게 한 줄 더 붙는 경우가 있다
    if body_lines and len(body_lines[0]) <= 22:
        title = f"{title} — {body_lines[0]}"
        body_lines = body_lines[1:]

    body = "\n".join(body_lines).strip()
    if len(body) < 120:
        return None
    return category, title, body[:2600]


def main() -> None:
    if not os.path.exists(GUIDES):
        print(f"  · {os.path.relpath(GUIDES, ROOT)} 가 없어 건너뜁니다.")
        return

    with open(GUIDES, encoding="utf-8") as fh:
        guides = json.load(fh)

    tips = []
    for guide in guides:
        path = os.path.expandvars(os.path.expanduser(guide["path"]))
        if not os.path.exists(path):
            print(f"  ! 자료 없음, 건너뜀 — {guide['name']}")
            continue

        pages = pdf_text.pages(path)
        made = 0
        for index, text in enumerate(pages):
            parsed = page_to_tip(clean_lines(text))
            if not parsed:
                continue
            category, title, body = parsed
            made += 1
            tips.append(
                {
                    "id": f"{guide['id']}-{index + 1}",
                    "scope": guide.get("scope", "common"),
                    "category": category,
                    "title": title,
                    "body": body,
                    "sourceName": guide["name"],
                    "sourcePage": index + 1,
                }
            )
        print(f"  · {guide['name']} — {made}꼭지")

    dest = os.path.join(DATA, "tips.json")
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(tips, fh, ensure_ascii=False, indent=2)
    print(f"\n  ✓ data/tips.json — {len(tips)}꼭지")


if __name__ == "__main__":
    main()
