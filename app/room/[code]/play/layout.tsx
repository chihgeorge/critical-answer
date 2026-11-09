import type { Metadata } from "next";

// The page is a client component, so the room's manifest link is set here.
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  return { manifest: `/room/${encodeURIComponent(code)}/manifest.webmanifest` };
}

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
