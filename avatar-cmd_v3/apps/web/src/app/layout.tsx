import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="ja" suppressHydrationWarning>
      <body className="font-sans min-h-screen antialiased">{children}</body>
    </html>
  );
}
