"""보고서 PDF를 내려받아 페이지별 텍스트로 바꾼다. 결과는 .cache/pdf 에 남겨 재실행을 빠르게 한다."""
import hashlib
import json
import os
import sys
import urllib.request

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(ROOT, ".cache", "pdf")
UA = "univ-interview-bot/1.0 (+https://github.com/dmlwjd21/univ_interview) educational-research"


def _key(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:20]


def fetch(url: str) -> str | None:
    """PDF 를 캐시에 받아 두고 경로를 돌려준다."""
    os.makedirs(CACHE, exist_ok=True)
    dest = os.path.join(CACHE, _key(url) + ".pdf")
    if os.path.exists(dest) and os.path.getsize(dest) > 20000:
        return dest
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=90) as res:
            body = res.read()
        if len(body) < 20000:
            return None
        with open(dest, "wb") as fh:
            fh.write(body)
        return dest
    except Exception as exc:  # 네트워크·서버 오류는 건너뛴다
        print(f"  ! {url} — {exc}", file=sys.stderr)
        return None


def _blocks(page) -> list[tuple[float, float, float, str]]:
    """(x0, y0, x1, 텍스트) 형태의 텍스트 블록."""
    out = []
    for x0, y0, x1, _y1, text, *_ in page.get_text("blocks"):
        text = text.replace("\x00", "").strip()
        if text:
            out.append((x0, y0, x1, text))
    return out


def _is_two_column(blocks: list, page_width: float) -> bool:
    """
    2단 편집 판별. 단을 무시하고 좌표순으로 읽으면 좌·우 단의 문장이 번갈아 섞여
    문항이 토막 난다. 가운데를 가로지르는 블록이 거의 없고 양쪽에 고루 쌓여 있으면 2단으로 본다.
    """
    if len(blocks) < 6:
        return False
    mid = page_width / 2
    left = sum(1 for x0, _, x1, _ in blocks if x1 < mid + page_width * 0.04)
    right = sum(1 for x0, _, _, _ in blocks if x0 > mid - page_width * 0.04)
    crossing = sum(1 for x0, _, x1, _ in blocks if x0 < mid - page_width * 0.08 and x1 > mid + page_width * 0.08)
    return left >= 3 and right >= 3 and crossing <= len(blocks) * 0.15


def _page_text(page) -> str:
    blocks = _blocks(page)
    width = page.rect.width
    if _is_two_column(blocks, width):
        mid = width / 2
        left = sorted([b for b in blocks if b[0] < mid], key=lambda b: b[1])
        right = sorted([b for b in blocks if b[0] >= mid], key=lambda b: b[1])
        return "\n".join(b[3] for b in left + right)
    # 1단이면 좌표 정렬이 원문 순서에 가장 가깝다(표가 많기 때문).
    return page.get_text("text", sort=True).replace("\x00", "")


def pages(path: str) -> list[str]:
    """페이지별 텍스트. 2단 편집 페이지는 단별로 나눠 읽는다."""
    doc = pymupdf.open(path)
    out = [_page_text(page) for page in doc]
    doc.close()
    return out


def text_of(url: str) -> list[str] | None:
    path = fetch(url)
    return pages(path) if path else None


if __name__ == "__main__":
    data = text_of(sys.argv[1])
    print(json.dumps(data, ensure_ascii=False)[:2000] if data else "FAILED")
