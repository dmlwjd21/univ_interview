import universitiesRaw from "@/data/universities.json";
import questionsRaw from "@/data/questions.json";
import reportsRaw from "@/data/reports.json";
import admissionResultsRaw from "@/data/admission-results.json";
import tipsRaw from "@/data/tips.json";
import reviewsRaw from "@/data/reviews.json";

import type {
  AdmissionResult,
  Question,
  Report,
  Review,
  Tip,
  University,
  UniversityType,
} from "./types";

const universities = universitiesRaw as University[];
const questions = questionsRaw as Question[];
const reports = reportsRaw as Report[];
const admissionResults = admissionResultsRaw as AdmissionResult[];
const tips = tipsRaw as Tip[];
const reviews = reviewsRaw as Review[];

/** 사이버·원격대는 고3 수시 면접 대상이 아니므로 검색에서 뺀다. */
export function listUniversities(type?: UniversityType): University[] {
  const pool = universities.filter((u) => u.type !== "cyber");
  return type ? pool.filter((u) => u.type === type) : pool;
}

export function getUniversity(id: string): University | undefined {
  return universities.find((u) => u.id === id);
}

export function getQuestions(univId: string): Question[] {
  return questions
    .filter((q) => q.univId === univId)
    .sort((a, b) => b.year - a.year || a.page - b.page);
}

export function getReports(univId: string): Report[] {
  return reports
    .filter((r) => r.univId === univId && r.url)
    .sort((a, b) => b.year - a.year);
}

export function getAdmissionResults(univId: string): AdmissionResult[] {
  return admissionResults
    .filter((r) => r.univId === univId)
    .sort((a, b) => b.year - a.year || a.department.localeCompare(b.department, "ko"));
}

export function getReviews(univId: string): Review[] {
  return reviews.filter((r) => r.univId === univId);
}

export function getTips(scopes: string[] = []): Tip[] {
  if (!scopes.length) return tips;
  return tips.filter((t) => t.scope === "common" || scopes.includes(t.scope));
}

/** 한 대학에서 실제로 기출이 확인된 학과 목록. 없으면 빈 배열. */
export function departmentsOf(univId: string): string[] {
  const set = new Set<string>();
  for (const q of questions) {
    if (q.univId === univId && q.department) set.add(q.department);
  }
  for (const r of admissionResults) {
    if (r.univId === univId && r.department) set.add(r.department);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ko"));
}

/** 한 대학에서 확인된 전형 목록. */
export function admissionTypesOf(univId: string): string[] {
  const set = new Set<string>();
  for (const q of questions) {
    if (q.univId === univId && q.admissionType) set.add(q.admissionType);
  }
  for (const r of admissionResults) {
    if (r.univId === univId && r.admissionType) set.add(r.admissionType);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ko"));
}

export interface QuestionFilter {
  univId: string;
  department?: string | null;
  admissionType?: string | null;
  year?: number | null;
}

export function filterQuestions({ univId, department, admissionType, year }: QuestionFilter): Question[] {
  return getQuestions(univId).filter((q) => {
    if (department && q.department !== department) return false;
    if (admissionType && q.admissionType !== admissionType) return false;
    if (year && q.year !== year) return false;
    return true;
  });
}

/** 통계 — 홈 화면에 수집 현황을 그대로 보여 주기 위한 값. */
export function stats() {
  const withQuestions = new Set(questions.map((q) => q.univId));
  const years = [...new Set(questions.map((q) => q.year))].sort((a, b) => b - a);
  return {
    universities: listUniversities("university").length,
    colleges: listUniversities("college").length,
    questions: questions.length,
    universitiesWithQuestions: withQuestions.size,
    reports: reports.filter((r) => r.url).length,
    admissionResults: admissionResults.length,
    years,
  };
}

/** 이름·지역으로 대학을 찾는다. 초성이나 부분 일치도 받아 준다. */
export function searchUniversities(query: string, type?: UniversityType): University[] {
  const q = query.trim().replace(/\s+/g, "");
  const pool = listUniversities(type);
  if (!q) return pool;
  return pool.filter((u) => {
    const name = u.name.replace(/\s+/g, "");
    return name.includes(q) || (u.region ?? "").includes(q) || name.replace(/대학교|대학/g, "").includes(q);
  });
}
