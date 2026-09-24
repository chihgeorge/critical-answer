import { describe, it, expect } from "vitest";
import { extractYoutubeId, youtubeEmbedUrl } from "./youtube";

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
