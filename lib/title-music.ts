// The home page's title song (#315): it starts on the first tap or key press (browsers block sound before one),
// and its 🎵 switch is remembered in this browser. The React part is components/title-music.tsx.
import { TITLE_THEME, type Song } from "./bgm";

export const TITLE_MUSIC_KEY = "titleMusic";

interface Player {
  setSong(song: Song): void;
  start(): Promise<void>;
  stop(): void;
}

/** `player` is called only inside a gesture, so the AudioContext is never created before one. */
export function titleMusic(player: () => Player, read: (key: string) => string | null, write: (key: string, value: string) => void) {
  let on = read(TITLE_MUSIC_KEY) !== "off";
  let started = false;
  function play() {
    started = true;
    const p = player();
    p.setSong(TITLE_THEME);
    void p.start();
  }
  return {
    on: () => on,
    /** Any tap or key press on the page: the first one starts the song, unless 🎵 is off. */
    gesture() {
      if (on && !started) play();
    },
    /** The 🎵 switch, itself a gesture: on plays at once, off stops. Returns the new state. */
    toggle(): boolean {
      on = !on;
      write(TITLE_MUSIC_KEY, on ? "on" : "off");
      if (on) play();
      else if (started) player().stop();
      return on;
    },
  };
}
