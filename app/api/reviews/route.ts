import { NextResponse } from "next/server";

/**
 * 면접 후기 검색 (선택 기능).
 *
 * 네이버 검색 API 의 카페글·블로그 검색을 쓴다. 수만휘를 비롯한 입시 카페 글이 여기서
 * 잡힌다. 카페 본문을 직접 긁는 방식은 로그인이 필요하고 이용약관에도 어긋나므로 쓰지
 * 않는다. 제목·요약·링크만 보여 주고 본문은 원글로 보낸다.
 *
 * 이 API 는 2026년에 NAVER API HUB(네이버 클라우드 플랫폼)로 이관되어 결제수단 등록이
 * 필요해졌다. 그래서 후기 검색의 기본 경로는 키가 필요 없는 딥링크(lib/review-links.ts)로
 * 두고, 키가 등록된 환경에서만 이 라우트가 목록을 돌려준다.
 *
 * 키가 없으면 configured: false 만 돌려준다. 링크는 화면이 자체적으로 만든다.
 */

interface NaverItem {
  title: string;
  link: string;
  description: string;
  cafename?: string;
  bloggername?: string;
  postdate?: string;
}

const stripTags = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();

async function naverSearch(kind: "cafearticle" | "blog", query: string) {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return null;

  const url = `https://openapi.naver.com/v1/search/${kind}.json?query=${encodeURIComponent(query)}&display=12&sort=sim`;
  const res = await fetch(url, {
    headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
    next: { revalidate: 60 * 60 * 6 },
  });
  if (!res.ok) return null;

  const json = (await res.json()) as { items?: NaverItem[] };
  return (json.items ?? []).map((item) => ({
    kind,
    title: stripTags(item.title),
    link: item.link,
    summary: stripTags(item.description),
    source: item.cafename ?? item.bloggername ?? "",
    date: item.postdate ?? "",
  }));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const univ = (searchParams.get("univ") ?? "").trim();
  const department = (searchParams.get("department") ?? "").trim();
  if (!univ) {
    return NextResponse.json({ error: "univ 파라미터가 필요합니다." }, { status: 400 });
  }

  const query = [univ, department, "면접 후기"].filter(Boolean).join(" ");
  const fallback = {
    configured: false as const,
    query,
    links: [
      { label: "네이버 카페 검색", url: `https://search.naver.com/search.naver?where=article&query=${encodeURIComponent(query)}` },
      { label: "네이버 블로그 검색", url: `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(query)}` },
      { label: "수만휘 카페에서 검색", url: `https://search.naver.com/search.naver?where=article&query=${encodeURIComponent(`${query} 수만휘`)}` },
    ],
  };

  try {
    const [cafe, blog] = await Promise.all([naverSearch("cafearticle", query), naverSearch("blog", query)]);
    if (cafe === null && blog === null) return NextResponse.json(fallback);
    return NextResponse.json({
      configured: true as const,
      query,
      items: [...(cafe ?? []), ...(blog ?? [])],
      links: fallback.links,
    });
  } catch {
    return NextResponse.json(fallback);
  }
}
