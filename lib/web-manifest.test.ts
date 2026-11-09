import { describe, expect, it } from "vitest";
import { GET } from "@/app/room/[code]/manifest.webmanifest/route";

const get = (code: string) =>
  GET(new Request(`http://x/room/${code}/manifest.webmanifest`), { params: Promise.resolve({ code }) });

describe("room manifest", () => {
  it("opens the room's phone page from the home screen", async () => {
    const res = await get("BCDF");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/manifest+json");
    expect(await res.json()).toMatchObject({ start_url: "/room/BCDF/play", scope: "/", display: "standalone" });
  });

  it("refuses anything that is not a room code", async () => {
    for (const code of ["bcdf", "ABCD", "BCD", "BC%2F"]) expect((await get(code)).status).toBe(404);
  });
});
