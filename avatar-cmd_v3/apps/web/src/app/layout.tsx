import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto",
});

export const metadata: Metadata = {
  title: "Avatar CMD | AIアバター搭載PCセットアップ",
  description:
    "OpenClaw × AIアバター × SNS自動運用。AIアバターを統合管理し、コンテンツ制作・収益化を自律的に実行するコマンドセンター。",
};

export const viewport: Viewport = {
  themeColor: "#050508",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ja"
      className={`${inter.variable} ${notoSansJP.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans min-h-screen antialiased">{children}</body>
    </html>
  );
}
