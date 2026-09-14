#!/usr/bin/env python3
"""Check public sources and import only explicitly structured CSV/JSON records.

University PDFs/HTML are monitored, but ambiguous tables and prose are never
converted to facts automatically. The report names documents needing review.
"""
import argparse
import csv
import hashlib
import io
import json
import logging
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SOURCES = ROOT / "sources"
MAX_BYTES = 20_000_000
RESULT_FIELDS = ("capacity", "applicants", "competitionRate", "additionalAdmits",
                 "additionalRank", "registeredAverage", "cut50", "cut70", "calculationBasis")
CHECK_FIELDS = ("admissionOffice", "previousResults", "priorLearningReport",
                "interviewMaterials", "publicInterviewArchive", "fallbackResults")
logger = logging.getLogger("update_data")


def read_json(path):
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def write_json_if_changed(path, value):
    rendered = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == rendered:
        return False
    path.write_text(rendered, encoding="utf-8")
    return True


def catalog_entries(universities):
    return {(u["name"], p["major"], t)
            for u in universities for p in u["programs"] for t in p["tracks"]}


def validate_data():
    universities = read_json(DATA / "universities.json")
    interviews = read_json(DATA / "interviews.json")
    admissions = read_json(DATA / "admissions.json")
    reviews = read_json(DATA / "reviews.json")
    metadata = read_json(DATA / "metadata.json")
    sources = read_json(SOURCES / "sources.json")
    if not all(isinstance(x, list) for x in (universities, interviews, admissions, reviews, sources)):
        raise ValueError("데이터 목록은 JSON 배열이어야 합니다")
    if metadata["windowYears"] != 5:
        raise ValueError("표시 기간은 5년이어야 합니다")
    catalog = catalog_entries(universities)
    ids = set()
    for row in interviews:
        if row["id"] in ids:
            raise ValueError(f"중복 면접 ID: {row['id']}")
        ids.add(row["id"])
        if (row["university"], row["major"], row["track"]) not in catalog:
            raise ValueError(f"등록되지 않은 면접 학과/전형: {row['id']}")
        if row["sourceType"] not in ("A", "B", "C") or not row["questions"]:
            raise ValueError(f"출처 또는 질문 오류: {row['id']}")
        for key in ("year", "interviewType", "sourceName", "sourceUrl", "verifiedAt"):
            if key not in row:
                raise ValueError(f"면접 필드 누락: {row['id']} {key}")
    for row in admissions:
        validate_admission(row, catalog)
    for row in reviews:
        if (row["university"], row["major"], row["track"]) not in catalog:
            raise ValueError("등록되지 않은 후기 학과/전형")
    return universities, interviews, admissions, sources, metadata


def validate_admission(row, catalog):
    key = (row["university"], row["major"], row["track"])
    if key not in catalog:
        raise ValueError(f"등록되지 않은 입결 학과/전형: {key}")
    if not isinstance(row["year"], int) or row["year"] < 2000 or row["year"] > date.today().year:
        raise ValueError(f"입결 학년도 오류: {key}")
    if row["sourceType"] not in ("A", "B") or not row["sourceName"] or not row["sourceUrl"]:
        raise ValueError(f"입결 출처 오류: {key}")
    if not row.get("verifiedAt"):
        raise ValueError(f"입결 자료 확인일 누락: {key}")
    if not any(row.get(field) not in (None, "") for field in RESULT_FIELDS):
        raise ValueError(f"입결 수치 없음: {key}")
    for field in ("capacity", "applicants", "additionalAdmits", "additionalRank"):
        if field in row and (not isinstance(row[field], int) or row[field] < 0):
            raise ValueError(f"입결 정수 필드 오류: {key} {field}")


def fetch_public(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("공개 HTTPS URL만 허용")
    request = urllib.request.Request(url, headers={
        "User-Agent": "univ-interview-public-source-check/2.0",
        "Accept": "application/json,text/csv,text/html,application/pdf,*/*"})
    with urllib.request.urlopen(request, timeout=15) as response:
        if urlparse(response.url).scheme != "https":
            raise ValueError("HTTPS가 아닌 주소로 이동")
        if response.status != 200:
            raise ValueError(f"HTTP {response.status}")
        raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("20MB 초과")
        return raw, response.headers.get("Content-Type", "")


def document_list(source, field):
    value = source.get(field)
    if not value:
        return []
    if isinstance(value, str):
        return [{"url": value, "format": "monitor"}]
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        return value
    raise ValueError(f"URL 설정 형식 오류: {field}")


def permitted_source_host(source, field, url):
    host = (urlparse(url).hostname or "").lower()
    if field == "fallbackResults":
        suffixes = ("adiga.kr", "procollege.kr")
    elif field == "publicInterviewArchive":
        suffixes = tuple(source.get("publicHostSuffixes", ()))
    else:
        suffixes = tuple(source.get("officialHostSuffixes", ()))
    return bool(host) and any(host == suffix or host.endswith("." + suffix) for suffix in suffixes)


def normalize_number(value, integer=False):
    if value is None or str(value).strip() in ("", "-", "비공개", "미공개"):
        return None
    text = str(value).strip().replace(",", "")
    if integer:
        if not text.isdigit():
            raise ValueError(f"정수로 확인할 수 없음: {text}")
        return int(text)
    # Preserve the university's displayed unit; never calculate or infer.
    return str(value).strip()


def parse_records(raw, fmt):
    if fmt == "json":
        value = json.loads(raw.decode("utf-8-sig"))
        if not isinstance(value, list):
            raise ValueError("JSON 자료는 레코드 배열이어야 합니다")
        return value
    if fmt == "csv":
        return list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    return None


def admission_from_feed(item, source, doc, grade, checked_at, url, catalog):
    for field in ("university", "major", "track", "year"):
        if not str(item.get(field, "")).strip():
            raise ValueError(f"입결 필수 필드 누락: {field}")
    if item["university"] != source["university"]:
        raise ValueError("소스 대학과 데이터 대학 불일치")
    row = {"university": item["university"], "major": item["major"], "track": item["track"],
           "year": int(item["year"]), "sourceType": grade,
           "sourceName": doc.get("sourceName") or source["university"] + " 입학처",
           "sourceUrl": url, "verifiedAt": checked_at}
    for field in RESULT_FIELDS:
        if field in item:
            value = normalize_number(item[field], field in ("capacity", "applicants",
                                                             "additionalAdmits", "additionalRank"))
            if value is not None:
                row[field] = value
    validate_admission(row, catalog)
    return row


def interview_from_feed(item, source, doc, grade, checked_at, url, catalog):
    if item["university"] != source["university"]:
        raise ValueError("소스 대학과 데이터 대학 불일치")
    key = (item["university"], item["major"], item["track"])
    if key not in catalog:
        raise ValueError(f"등록되지 않은 학과/전형: {key}")
    questions = item["questions"]
    if not isinstance(questions, list) or not questions:
        raise ValueError("질문 배열 없음")
    questions = [q if isinstance(q, dict) else {"text": q} for q in questions]
    if any(not q.get("text") for q in questions):
        raise ValueError("빈 질문")
    year = int(item["year"])
    if year < 2000 or year > date.today().year + 1:
        raise ValueError("면접 학년도 오류")
    return {"id": item.get("id") or f"{source['university']}:{item['major']}:{item['track']}:{year}",
            "university": item["university"], "major": item["major"],
            "track": item["track"], "year": year,
            "interviewType": item["interviewType"], "questions": questions,
            "sourceType": grade, "sourceName": doc.get("sourceName") or source["university"] + " 입학처",
            "sourceUrl": url, "verifiedAt": checked_at, "sample": False}


def admission_key(row):
    return row["university"], row["major"], row["track"], row["year"]


def merge_admissions(existing, official, fallback):
    merged = {admission_key(row): row for row in existing}
    # An official record supersedes a portal record only for the same exact
    # university, program, track, and year. Never mix their numerical fields.
    for row in official:
        merged[admission_key(row)] = row
    for row in fallback:
        key = admission_key(row)
        if key not in merged or merged[key]["sourceType"] != "A":
            merged[key] = row
    return sorted(merged.values(), key=lambda r: (r["university"], r["major"], r["track"], -r["year"]))


def run(output, checksums_path):
    universities, interviews, admissions, sources, metadata = validate_data()
    catalog = catalog_entries(universities)
    checksums = read_json(checksums_path) if checksums_path.exists() else {}
    candidates, skipped, new_checksums = [], [], dict(checksums)
    official_results, fallback_results, new_interviews = [], [], []
    checked_at = date.today().isoformat()
    for source in sources:
        official_count = 0
        for field in CHECK_FIELDS:
            try:
                documents = document_list(source, field)
            except (ValueError, TypeError) as exc:
                skipped.append({"university": source.get("university"), "field": field, "reason": str(exc)})
                continue
            for doc in documents:
                url = doc.get("url", "")
                key = f"{source['university']}:{field}:{url}"
                try:
                    if not permitted_source_host(source, field, url):
                        raise ValueError("허용된 공식/공공 출처 도메인이 아님")
                    raw, content_type = fetch_public(url)
                    digest = hashlib.sha256(raw).hexdigest()
                    changed = checksums.get(key) != digest
                    if not changed:
                        continue
                    fmt = doc.get("format", "monitor")
                    kind = doc.get("kind", "admissions" if field in ("previousResults", "fallbackResults") else "interviews")
                    records = parse_records(raw, fmt)
                    if records is None:
                        new_checksums[key] = digest
                        candidates.append({"university": source["university"], "field": field,
                                           "url": url, "status": "manual_review",
                                           "reason": f"{fmt} 자료는 수치/질문을 자동 추출하지 않음 ({content_type})"})
                        continue
                    grade = "B" if field in ("fallbackResults", "publicInterviewArchive") else "A"
                    parsed = []
                    for item in records:
                        try:
                            if kind == "admissions":
                                parsed.append(admission_from_feed(item, source, doc, grade, checked_at, url, catalog))
                            elif kind == "interviews":
                                parsed.append(interview_from_feed(item, source, doc, grade, checked_at, url, catalog))
                            else:
                                raise ValueError(f"지원하지 않는 자료 유형: {kind}")
                        except (KeyError, ValueError, TypeError) as exc:
                            skipped.append({"university": source["university"], "field": field,
                                            "url": url, "reason": f"행 건너뜀: {exc}"})
                    if kind == "admissions":
                        if grade == "A":
                            official_results.extend(parsed)
                            official_count += len(parsed)
                        else:
                            fallback_results.extend(parsed)
                    else:
                        new_interviews.extend(parsed)
                    if parsed:
                        new_checksums[key] = digest
                    candidates.append({"university": source["university"], "field": field,
                                       "url": url, "status": "imported", "rows": len(parsed)})
                except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError,
                        UnicodeError, json.JSONDecodeError) as exc:
                    skipped.append({"university": source.get("university"), "field": field,
                                    "url": url, "reason": f"{type(exc).__name__}: {exc}"})
                    logger.warning("%s %s 건너뜀: %s", source.get("university"), field, exc)
        logger.info("%s 공식 입결 %d건 확인", source.get("university"), official_count)
    updated_admissions = merge_admissions(admissions, official_results, fallback_results)
    # Existing record wins when feed has no new facts. This avoids changing
    # verifiedAt every run and preserves editorially reviewed sample rows.
    by_id = {row["id"]: row for row in interviews}
    for row in new_interviews:
        by_id[row["id"]] = row
    updated_interviews = sorted(by_id.values(), key=lambda r: (r["university"], r["major"], -r["year"]))
    if updated_admissions != admissions or updated_interviews != interviews:
        metadata["updatedAt"] = checked_at
    write_json_if_changed(DATA / "admissions.json", updated_admissions)
    write_json_if_changed(DATA / "interviews.json", updated_interviews)
    write_json_if_changed(DATA / "metadata.json", metadata)
    write_json_if_changed(checksums_path, new_checksums)
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(),
              "candidates": candidates, "skipped": skipped,
              "admissionsImported": len(official_results) + len(fallback_results),
              "interviewsImported": len(new_interviews)}
    output.parent.mkdir(parents=True, exist_ok=True)
    write_json_if_changed(output, report)
    validate_data()
    logger.info("공식 입결 %d건, 보조 입결 %d건, 면접 %d건, 건너뜀 %d건",
                len(official_results), len(fallback_results), len(new_interviews), len(skipped))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "update-candidates.json")
    parser.add_argument("--checksums", type=Path, default=SOURCES / "checksums.json")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        if args.validate_only:
            validate_data()
            logger.info("로컬 JSON 검증 완료")
        else:
            run(args.output, args.checksums)
        return 0
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        logger.error("전체 데이터 검증 실패: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
