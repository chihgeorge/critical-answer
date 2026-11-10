import { describe, expect, it } from "vitest";
import { extractInstagramShortcode, measuredHeight } from "./instagram";

describe("extractInstagramShortcode", () => {
  it.each([
    ["https://www.instagram.com/p/DPPHHjlkTgr/", "DPPHHjlkTgr"],
    ["https://www.instagram.com/reel/DPPHHjlkTgr/?igsh=abc123", "DPPHHjlkTgr"],
    ["https://instagram.com/reels/C_x-9aB1zz", "C_x-9aB1zz"],
    ["instagram.com/tv/CAbcdEFgh12/embed/", "CAbcdEFgh12"],
    ["https://www.instagram.com/natgeo/p/DPPHHjlkTgr/", "DPPHHjlkTgr"],
    ["https://www.instagram.com/p/DPPHHjlkTgr#x", "DPPHHjlkTgr"],
    ["  DPPHHjlkTgr  ", "DPPHHjlkTgr"],
  ])("%s", (url, code) => expect(extractInstagramShortcode(url)).toBe(code));

  it.each(["", "https://www.instagram.com/natgeo/", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "abc", "https://www.instagram.com/p/bad$code/", "not a url at all"])("rejects %s", (bad) =>
    expect(extractInstagramShortcode(bad)).toBeNull(),
  );
});

describe("measuredHeight", () => {
  it("reads the embed's MEASURE message", () => {
    expect(measuredHeight('{"details":{"height":689},"type":"MEASURE"}')).toBe(689);
    expect(measuredHeight({ type: "MEASURE", details: { height: 500 } })).toBe(500);
  });
  it("ignores everything else", () => {
    for (const d of ['{"type":"LOADING","details":{}}', "not json", null, '{"type":"MEASURE","details":{"height":-1}}', '{"type":"MEASURE","details":{"height":"9"}}']) expect(measuredHeight(d)).toBeNull();
  });
});
