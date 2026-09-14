import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "대입 면접 기출 아카이브",
  description:
    "전국 4년제·전문대학의 최근 면접 기출문항을 출처와 함께 찾아봅니다. 대학이 공개한 선행학습 영향평가 결과보고서를 근거로 합니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header style={{ borderBottom: "1px solid var(--line)", background: "var(--surface)" }}>
          <div
            className="wrap"
            style={{ display: "flex", alignItems: "center", gap: 16, height: 60, justifyContent: "space-between" }}
          >
            <Link href="/" style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.01em" }}>
              대입 면접 기출 아카이브
            </Link>
            <nav style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--ink-faint)" }}>
              <Link href="/tips">면접 준비 가이드</Link>
              <Link href="/sources">출처</Link>
            </nav>
          </div>
        </header>

        <main style={{ minHeight: "calc(100vh - 60px - 132px)" }}>{children}</main>

        <footer
          style={{
            borderTop: "1px solid var(--line)",
            background: "var(--surface)",
            marginTop: 48,
            paddingBlock: 24,
            fontSize: 12,
            color: "var(--ink-faint)",
          }}
        >
          <div className="wrap" style={{ display: "grid", gap: 8 }}>
            <p>
              이 사이트의 기출문항은 각 대학이 「공교육 정상화 촉진 및 선행교육 규제에 관한 특별법」에 따라
              공개한 <strong>선행학습 영향평가 결과보고서</strong>에서 자동으로 모은 것입니다. 문항마다 원문
              PDF의 쪽 번호를 함께 표시하니, 지원 전에는 반드시 원문과 해당 연도 모집요강을 확인하세요.
            </p>
            <p>
              자동 추출 과정에서 문항이 잘리거나 학과·전형이 잘못 붙을 수 있습니다. 표시된 출처가 언제나
              기준입니다.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
