export type UniversityType = "university" | "college" | "cyber";

export interface University {
  id: string;
  name: string;
  /** university = 4년제, college = 전문대, cyber = 원격·사이버대(검색에서 제외) */
  type: UniversityType;
  region: string | null;
  homepage: string | null;
  wikipedia: string;
}

export interface Question {
  id: string;
  univId: string;
  univName: string;
  /** 학년도. 2026 = 2025년 가을에 치른 2026학년도 전형 */
  year: number;
  department: string | null;
  admissionType: string | null;
  track: string | null;
  question: string;
  /** 대학이 보고서에 스스로 적어 둔 출제 의도 */
  intent: string | null;
  /** 원본 PDF 안에서의 쪽 번호 */
  page: number;
  sourceUrl: string;
  sourceName: string;
  extractedBy: "rule" | "llm";
}

export interface Report {
  univId: string;
  univName: string;
  year: number;
  url: string | null;
  sourceName?: string;
  via: "mirror" | "not-found";
  search?: { naver: string; google: string; academyinfo: string };
}

/** 전년도 입시결과(입결) */
export interface AdmissionResult {
  univId: string;
  univName: string;
  year: number;
  department: string;
  admissionType: string;
  /** 모집인원 */
  quota: number | null;
  /** 경쟁률 (예: 12.4) */
  competitionRate: number | null;
  /** 교과 50% 컷 (등급) */
  grade50: number | null;
  /** 교과 70% 컷 (등급) */
  grade70: number | null;
  /** 환산점수 등 대학이 별도로 공개한 값 */
  note: string | null;
  sourceUrl: string;
  sourceName: string;
}

/** 면접 준비 팁 — 시도교육청·진학지원센터 자료에서 정리 */
export interface Tip {
  id: string;
  /** common = 모든 면접 공통, 계열/유형별로 좁혀지면 scope 로 구분 */
  scope: string;
  category: string;
  title: string;
  body: string;
  sourceName: string;
  sourcePage: number | null;
}

/** 실제 응시자 면접 후기 발췌 */
export interface Review {
  id: string;
  univId: string | null;
  univName: string | null;
  department: string | null;
  year: number | null;
  body: string;
  sourceName: string;
  sourcePage: number | null;
}

export interface SearchSelection {
  type: UniversityType;
  univId: string | null;
  department: string | null;
  admissionType: string | null;
}
