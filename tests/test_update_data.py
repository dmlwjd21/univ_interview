import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "update_data.py"
spec = importlib.util.spec_from_file_location("update_data", MODULE_PATH)
update = importlib.util.module_from_spec(spec)
spec.loader.exec_module(update)


class UpdateDataTests(unittest.TestCase):
    def setUp(self):
        self.catalog = {("시험대학교", "화학과", "학생부종합")}
        self.source = {"university": "시험대학교"}
        self.doc = {"sourceName": "시험대학교 공식 입학처"}
        self.url = "https://admission.example.ac.kr/results.csv"

    def row(self, **changes):
        item = {"university": "시험대학교", "major": "화학과",
                "track": "학생부종합", "year": "2025",
                "capacity": "12", "cut70": "2.43등급",
                "additionalAdmits": ""}
        item.update(changes)
        return item

    def test_import_only_published_fields(self):
        row = update.admission_from_feed(self.row(), self.source, self.doc, "A",
                                         "2026-09-14", self.url, self.catalog)
        self.assertEqual(row["capacity"], 12)
        self.assertEqual(row["cut70"], "2.43등급")
        self.assertNotIn("additionalAdmits", row)
        self.assertNotIn("cut50", row)
        self.assertEqual(row["sourceType"], "A")

    def test_bad_numeric_row_is_skipped_instead_of_inferred(self):
        with self.assertRaises(ValueError):
            update.admission_from_feed(self.row(capacity="약 12명"), self.source,
                                       self.doc, "A", "2026-09-14", self.url, self.catalog)

    def test_official_result_beats_portal_for_same_program_and_year(self):
        official = update.admission_from_feed(self.row(capacity="12"), self.source,
                                              self.doc, "A", "2026-09-14", self.url, self.catalog)
        portal = update.admission_from_feed(self.row(capacity="13"), self.source,
                                            self.doc, "B", "2026-09-14", self.url, self.catalog)
        self.assertEqual(update.merge_admissions([], [official], [portal]), [official])
        self.assertEqual(update.merge_admissions([], [], [portal]), [portal])

    def test_failed_university_does_not_block_valid_university(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "data").mkdir()
            (root / "sources").mkdir()
            university = {"name": "시험대학교", "type": "4년제", "region": "서울",
                          "programs": [{"major": "화학과", "tracks": ["학생부종합"]}]}
            files = {
                "universities.json": [university],
                "interviews.json": [],
                "admissions.json": [],
                "reviews.json": [],
                "metadata.json": {"windowYears": 5, "latestAdmissionYear": 2026,
                                  "updatedAt": "2026-09-01"},
            }
            for name, value in files.items():
                (root / "data" / name).write_text(json.dumps(value), encoding="utf-8")
            sources = [
                {"university": "시험대학교", "officialHostSuffixes": ["example.ac.kr"],
                 "previousResults": {"url": self.url, "format": "csv", "kind": "admissions"}},
                {"university": "오류대학교", "officialHostSuffixes": ["example.ac.kr"],
                 "previousResults": {"url": "https://bad.example.ac.kr/results.csv",
                                     "format": "csv", "kind": "admissions"}},
            ]
            (root / "sources" / "sources.json").write_text(json.dumps(sources), encoding="utf-8")
            payload = ("university,major,track,year,capacity,cut70\n"
                       "시험대학교,화학과,학생부종합,2025,12,2.43등급\n").encode()
            def fake_fetch(url):
                if "bad." in url:
                    raise ValueError("접근 실패")
                return payload, "text/csv"
            with patch.object(update, "ROOT", root), patch.object(update, "DATA", root / "data"), \
                 patch.object(update, "SOURCES", root / "sources"), patch.object(update, "fetch_public", fake_fetch):
                update.run(root / "report.json", root / "sources" / "checksums.json")
            saved = json.loads((root / "data" / "admissions.json").read_text(encoding="utf-8"))
            report = json.loads((root / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(len(saved), 1)
            self.assertEqual(saved[0]["capacity"], 12)
            self.assertEqual(len(report["skipped"]), 1)


if __name__ == "__main__":
    unittest.main()
