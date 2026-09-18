import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local playtests connect over LAN IP (phones on the same Wi-Fi), not
  // localhost — Next 16 blocks cross-origin dev requests by default.
  allowedDevOrigins: ["10.0.0.61"],
};

export default nextConfig;
