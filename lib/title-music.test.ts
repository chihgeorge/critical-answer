import { describe, expect, it, vi } from "vitest";
import { TITLE_THEME } from "./bgm";
import { TITLE_MUSIC_KEY, titleMusic } from "./title-music";

function setup(stored: string | null) {
  const p = { setSong: vi.fn(), start: vi.fn(async () => {}), stop: vi.fn(), unlock: vi.fn(async () => {}), running: vi.fn(() => true) };
  const store = new Map<string, string>(stored ? [[TITLE_MUSIC_KEY, stored]] : []);
  const player = vi.fn(() => p);
  const m = titleMusic(player, (k) => store.get(k) ?? null, (k, v) => void store.set(k, v));
  return { m, p, player, store };
}

describe("titleMusic: the home page's title song", () => {
  it("makes no player before a gesture, then starts the title song once on the first one", () => {
    const { m, p, player } = setup(null);
    expect(m.on()).toBe(true);
    expect(player).not.toHaveBeenCalled();
    m.gesture();
    m.gesture();
    expect(p.setSong).toHaveBeenCalledWith(TITLE_THEME);
    expect(p.start).toHaveBeenCalledTimes(1);
  });

  it("a first tap the browser refused to count: the next tap wakes the sound again", () => {
    const { m, p } = setup(null);
    p.running.mockReturnValue(false);
    m.gesture();
    m.gesture();
    expect(p.start).toHaveBeenCalledTimes(1);
    expect(p.unlock).toHaveBeenCalledTimes(1);
  });

  it("remembered off: taps play nothing, and the switch turns it on at once and remembers that", () => {
    const { m, p, player, store } = setup("off");
    expect(m.on()).toBe(false);
    m.gesture();
    expect(player).not.toHaveBeenCalled();
    expect(m.toggle()).toBe(true);
    expect(p.start).toHaveBeenCalledTimes(1);
    expect(store.get(TITLE_MUSIC_KEY)).toBe("on");
  });

  it("switching off stops the song, remembers it, and later taps stay silent", () => {
    const { m, p, store } = setup(null);
    m.gesture();
    expect(m.toggle()).toBe(false);
    expect(p.stop).toHaveBeenCalledTimes(1);
    expect(store.get(TITLE_MUSIC_KEY)).toBe("off");
    m.gesture();
    expect(p.start).toHaveBeenCalledTimes(1);
  });
});
