import { describe, it, expect } from "vitest";
import { extractYoutubeId, youtubeEmbedUrl, playerSteps, clipStatusFromYoutube, parseClipTime, formatClipTime, hostMediaStatus, hostBuzzWait } from "./youtube";

describe("hostMediaStatus", () => {
  it("says the host plays the song live after the 🎤 open", () => expect(hostMediaStatus(false, true)).toBe("現場放歌中"));
  it("follows the player otherwise", () => {
    expect(hostMediaStatus(true, false)).toBe("播放中");
    expect(hostMediaStatus(false, false)).toBe("已暫停");
  });
});

describe("hostBuzzWait", () => {
  it("asks for ▶ before a song is open", () => expect(hostBuzzWait(true, false, false)).toBe("按 ▶ 播放後開放搶答"));
  it("says nothing on a clip error: the red warning leads", () => expect(hostBuzzWait(true, false, true)).toBeNull());
  it("waits for a buzz once open, or on a text question", () => {
    expect(hostBuzzWait(true, true, true)).toBe("等隊伍搶答…");
    expect(hostBuzzWait(false, false, false)).toBe("等隊伍搶答…");
  });
});

describe("extractYoutubeId", () => {
  it.each([
    ["a watch URL", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["a watch URL with extra query params", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s"],
    ["a watch URL where v is not the first param (mobile share)", "https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ"],
    ["a live URL", "https://www.youtube.com/live/dQw4w9WgXcQ?si=abc"],
    ["a youtu.be short link", "https://youtu.be/dQw4w9WgXcQ"],
    ["an embed URL", "https://www.youtube.com/embed/dQw4w9WgXcQ"],
    ["a shorts URL", "https://www.youtube.com/shorts/dQw4w9WgXcQ"],
    ["a youtube-nocookie embed URL", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["a bare id", "dQw4w9WgXcQ"],
    ["a URL with surrounding whitespace", "  https://youtu.be/dQw4w9WgXcQ  "],
  ])("extracts the id from %s", (_name, input) => {
    expect(extractYoutubeId(input)).toBe("dQw4w9WgXcQ");
  });

  it.each([
    ["a non-YouTube URL", "https://vimeo.com/12345678"],
    ["random text", "not a url at all"],
    ["an id that's the wrong length", "shortid"],
    ["an empty string", ""],
    ["a watch URL with no v param", "https://www.youtube.com/watch?feature=share"],
    ["a param that merely ends in v", "https://www.youtube.com/watch?xv=dQw4w9WgXcQ"],
    ["a v only inside the #fragment", "https://www.youtube.com/watch?feature=share#&v=dQw4w9WgXcQ"],
  ])("returns null for %s", (_name, input) => {
    expect(extractYoutubeId(input)).toBeNull();
  });
});

describe("youtubeEmbedUrl", () => {
  it("builds a youtube-nocookie.com embed URL from a video id", () => {
    expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });
});

describe("youtubeEmbedUrl with a clip", () => {
  it("adds start and end only when given", () => {
    expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(youtubeEmbedUrl("dQw4w9WgXcQ", 5, 30)).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=5&end=30");
    expect(youtubeEmbedUrl("dQw4w9WgXcQ", undefined, 30)).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?end=30");
  });
});

describe("playerSteps (docs/designs/youtube-questions.md)", () => {
  const play = (seq = 0) => ({ state: "playing" as const, seq });
  const pause = (seq = 0) => ({ state: "paused" as const, seq });

  it.each([
    ["nothing before, paused", null, pause(), false, []],
    ["a (re)connect onto a playing video plays from the start", null, play(), false, ["restart"]],
    ["▶ after ⏸ resumes", pause(), play(), false, ["play"]],
    ["⏸ while playing", play(), pause(), false, ["pause"]],
    ["a second ▶ does nothing", play(), play(), false, []],
    ["a second ⏸ does nothing", pause(), pause(), false, []],
    ["⟲ while playing", play(0), play(1), false, ["restart"]],
    ["⟲ while paused", pause(0), play(1), false, ["restart"]],
    ["▶ after the clip ended", pause(), play(), true, ["restart"]],
    ["a STATE resent with the same seq after the clip ended", play(), play(), true, ["restart"]],
  ] as const)("%s", (_name, prev, next, ended, steps) => {
    expect(playerSteps(prev, next, ended)).toEqual(steps);
  });
});

describe("clipStatusFromYoutube", () => {
  it.each([
    [-1, false, "loading"],
    [3, false, "loading"],
    [5, false, "paused"],
    [1, false, "playing"],
    [2, false, "paused"],
    [0, false, "ended"],
    [2, true, "ended"],
  ] as const)("YouTube state %s (ended %s) → %s", (yt, ended, status) => {
    expect(clipStatusFromYoutube(yt, ended)).toBe(status);
  });
});

describe("parseClipTime / formatClipTime (D22)", () => {
  it.each([
    ["65", 65],
    ["1:05", 65],
    [" 0:5 ", 5],
    ["0", 0],
    ["12:00", 720],
    ["1:60", null],
    ["1.5", null],
    ["-3", null],
    ["", null],
    ["1:2:3", null],
    ["abc", null],
  ] as const)("%j → %s", (input, seconds) => {
    expect(parseClipTime(input)).toBe(seconds);
  });

  it("formats seconds as m:ss and round-trips", () => {
    expect(formatClipTime(65)).toBe("1:05");
    expect(formatClipTime(0)).toBe("0:00");
    expect(parseClipTime(formatClipTime(754))).toBe(754);
  });
});
