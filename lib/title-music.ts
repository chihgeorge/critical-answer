// The home page's title song (#315): it starts on the first tap or key press (browsers block sound before one),
// and its 🎵 switch is remembered in this browser. The React part is components/title-music.tsx.
import { TITLE_THEME, type Song } from "./bgm";

export const TITLE_MUSIC_KEY = "titleMusic";

interface Player {
  setSong(song: Song): void;
  start(): Promise<void>;
  stop(): void;
  unlock(): Promise<void>;
  running(): boolean;
}

/** `player` is called only inside a gesture, so the AudioContext is never created before one. `defaultOn` is the
 * state before this browser has a stored choice: off on phones (players join from this page, and every phone playing
 * its own copy over the big screen is noise), on elsewhere. A stored choice always wins. */
export function titleMusic(player: () => Player, read: (key: string) => string | null, write: (key: string, value: string) => void, defaultOn = true) {
  const stored = read(TITLE_MUSIC_KEY);
  let on = stored === null ? defaultOn : stored !== "off";
  let started = false;
  let made: Player | null = null;
  function play() {
    started = true;
    const p = (made = player());
    p.setSong(TITLE_THEME);
    void p.start();
  }
  return {
    on: () => on,
    /** Any tap or key press on the page: the first one starts the song, unless 🎵 is off. A later one wakes the
     * sound again if the browser refused the first (a key it does not count as a gesture). */
    gesture() {
      if (!on) return;
      if (!started) play();
      else if (made && !made.running()) void made.unlock();
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
