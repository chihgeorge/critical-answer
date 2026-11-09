import type { MetadataRoute } from "next";

/**
 * The home-screen app (TODOS「上架手機版本」, PWA only). No service worker on purpose: a WebSocket game has
 * nothing to do offline, and a cache could keep serving an old build. `startUrl` is where the icon opens;
 * a phone added from /room/<code>/play gets that room's own manifest, so Android reopens the room.
 */
export function webManifest(startUrl: string): MetadataRoute.Manifest {
  return {
    name: "Critical Answer：致命答題",
    short_name: "致命答題",
    description: "D&D 皮、答題骨的地城問答派對遊戲",
    start_url: startUrl,
    scope: "/",
    display: "standalone",
    background_color: "#241a3f",
    theme_color: "#241a3f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // The slime sits inside the safe circle on an opaque background, so launchers may crop it to a shape.
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
