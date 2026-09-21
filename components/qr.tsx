"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** A QR code for `text`, drawn in the panel colors. Renders nothing until ready. */
export function Qr({ text, size = 160, alt = "掃描加入" }: { text: string; size?: number; alt?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, { width: size, margin: 1, color: { dark: "#2a1533", light: "#fff4dc" } }).then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [text, size]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} width={size} height={size} alt={alt} className="px-sprite" /> : null;
}
