"use client";

import "./globals.css";
import { ErrorScreen } from "@/components/error-screen";

/** Replaces the root layout when the layout itself fails, so it brings its own html and body. */
export default function GlobalError({ error }: { error: unknown }) {
  return (
    <html lang="zh-TW">
      <body className="min-h-full antialiased">
        <title>Critical Answer：致命答題</title>
        <ErrorScreen error={error} />
      </body>
    </html>
  );
}
