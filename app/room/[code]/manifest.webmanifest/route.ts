import { ROOM_CODE_RE } from "@/lib/gate";
import { webManifest } from "@/lib/web-manifest";

/** This room's manifest: an icon added from the phone page opens straight back into the room. */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!ROOM_CODE_RE.test(code)) return new Response("Not found", { status: 404 });
  return Response.json(webManifest(`/room/${code}/play`), { headers: { "Content-Type": "application/manifest+json" } });
}
