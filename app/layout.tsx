import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Critical Answer：致命答題",
  description: "D&D 皮、答題骨的地城問答派對遊戲 — iteration 1 lightweight playtest build.",
  // iPhone「加入主畫面」opens full screen (older iOS reads these tags, not the manifest).
  appleWebApp: { capable: true, title: "致命答題", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: "#241a3f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // px-frames: direction D 「石框木牌」 (DESIGN.md). The revert switch: delete that one word for the plain panels and tiles.
  return (
    <html lang="zh-TW" className="h-full">
      <body className="min-h-full antialiased px-frames">{children}</body>
    </html>
  );
}
