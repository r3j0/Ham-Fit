import type { Metadata, Viewport } from "next";
import "@fontsource-variable/noto-sans-kr";
import "./globals.css";
import { SessionProvider } from "@/components/session-provider";
export const metadata: Metadata = {
  title: { default: "햄피트", template: "%s | 햄피트" },
  description:
    "나만의 속도로, 함께 건강하게. 국민체력100 측정 결과를 기록해요.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8fafc",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <a className="skip-link" href="#main">
          본문으로 건너뛰기
        </a>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
