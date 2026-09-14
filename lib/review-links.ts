/**
 * 면접 후기를 찾아가는 검색 경로.
 *
 * 네이버 검색 API 는 2026년에 NAVER API HUB(네이버 클라우드 플랫폼)로 옮겨 가면서
 * 결제수단 등록이 필요해졌다. 후기 검색은 이 앱의 부가 기능이라 결제 계정을 요구하지
 * 않는 쪽을 기본으로 둔다. 그래서 **키 없이도 쓸 수 있는 딥링크**가 1순위이고,
 * 키가 있으면 그때 목록을 안에서 바로 보여 준다.
 *
 * 링크는 한 벌이 아니라 여러 각도로 만든다. 후기 글은 제목 표현이 제각각이라
 * ("면접 후기", "면접 복기", "면접 질문") 한 가지 검색어로는 잘 안 걸린다.
 */

export interface ReviewLink {
  group: string;
  label: string;
  url: string;
  hint?: string;
}

const naverArticle = (query: string) =>
  `https://search.naver.com/search.naver?where=article&query=${encodeURIComponent(query)}`;

const naverBlog = (query: string) =>
  `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(query)}`;

const google = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`;

export function buildReviewLinks(univName: string, department = ""): ReviewLink[] {
  const base = [univName, department].filter(Boolean).join(" ");
  const short = univName.replace(/대학교$/, "대").replace(/대학$/, "대");

  return [
    {
      group: "네이버 카페",
      label: "면접 후기",
      url: naverArticle(`${base} 면접 후기`),
      hint: "수만휘 등 입시 카페 글이 여기서 잡힙니다",
    },
    {
      group: "네이버 카페",
      label: "면접 복기",
      url: naverArticle(`${base} 면접 복기`),
      hint: "질문을 그대로 옮겨 적은 글이 많습니다",
    },
    {
      group: "네이버 카페",
      label: "면접 질문",
      url: naverArticle(`${short} 면접 질문`),
    },
    {
      group: "수만휘",
      label: "수만휘에서 검색",
      url: naverArticle(`${base} 면접 수만휘`),
    },
    {
      group: "수만휘",
      label: "수만휘 카페 바로가기",
      url: "https://cafe.naver.com/suhui",
      hint: "카페 안에서 다시 검색하면 글이 더 정확히 나옵니다",
    },
    {
      group: "블로그",
      label: "블로그 후기",
      url: naverBlog(`${base} 면접 후기`),
    },
    {
      group: "블로그",
      label: "합격 후기",
      url: naverBlog(`${base} 합격 후기 면접`),
    },
    {
      group: "그 밖에",
      label: "구글 — 카페 글만",
      url: google(`site:cafe.naver.com ${base} 면접 후기`),
      hint: "네이버 검색에서 빠진 글이 걸리기도 합니다",
    },
    {
      group: "그 밖에",
      label: "오르비 · 디시 등",
      url: google(`${base} 면접 후기 -site:cafe.naver.com`),
    },
  ];
}
