import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Critical Answer：致命答題",
  description: "D&D 皮、答題骨的地城問答派對遊戲 — iteration 1 lightweight playtest build.",
};

export const viewport: Viewport = {
  themeColor: "#241a3f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
