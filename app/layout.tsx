import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "dungeon_master",
  description: "地城問答派對遊戲 — iteration 1 lightweight playtest build.",
};

export const viewport: Viewport = {
  themeColor: "#ff6b35",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
