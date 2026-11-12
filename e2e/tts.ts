import { expect, type Page } from "@playwright/test";

/** Stubs window.speechSynthesis before the page loads, recording every speak() call's text
 * and every cancel(). getVoices() returns one usable zh-TW voice so pickVoice() finds it
 * immediately (no need to wait for a real voiceschanged event in the test environment). */
export async function stubSpeechSynthesis(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = [];
    let cancelCount = 0;
    const voice = { lang: "zh-TW", name: "Test zh-TW Voice", default: true } as SpeechSynthesisVoice;
    (window as unknown as { __ttsCalls: string[] }).__ttsCalls = calls;
    (window as unknown as { __ttsCancelCount: () => number }).__ttsCancelCount = () => cancelCount;
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [voice],
        addEventListener: () => {},
        removeEventListener: () => {},
        // Ends each line a moment later, like a real voice: the screen reads one line at a time and waits for onend.
        speak: (utter: SpeechSynthesisUtterance) => {
          calls.push(utter.text);
          setTimeout(() => utter.onend?.(new Event("end") as SpeechSynthesisEvent), 50);
        },
        cancel: () => {
          cancelCount++;
        },
      },
    });
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
      text: string;
      voice: SpeechSynthesisVoice | null = null;
      lang = "";
      onend: ((e: SpeechSynthesisEvent) => void) | null = null;
      onerror: ((e: SpeechSynthesisErrorEvent) => void) | null = null;
      constructor(text = "") {
        this.text = text;
      }
    };
  });
}

export const ttsCalls = (page: Page) => page.evaluate(() => (window as unknown as { __ttsCalls: string[] }).__ttsCalls);

/** The big screen's first tap: it wakes the sound and primes the voice. The 🔊 / 🎵 switches themselves are the host's,
 * in ⚙ 更多 (immersion.md PR3). It first waits for an unlock button (the lobby's or 「👆 開聲音」): they render only once the
 * page has hydrated, so the wake listener is there to catch the tap. A corner of the page: nothing there to press. */
export async function tapScreen(page: Page) {
  await expect(page.getByRole("button", { name: /開啟音效與氣氛|開聲音/ }).first()).toBeVisible();
  await page.mouse.click(4, 4);
}

/** Sets one of the host's big-screen sound switches in ⚙ 更多 (🎵 音樂, 🔊 旁白語音, 🌧 環境音), then closes the drawer. */
export async function setScreenAudio(host: Page, name: "🎵 音樂" | "🔊 旁白語音" | "🌧 環境音", on: boolean) {
  await host.getByRole("button", { name: "⚙ 更多" }).click();
  const drawer = host.getByTestId("more-drawer");
  const sw = drawer.getByRole("switch", { name: new RegExp(`^${name}：`) });
  if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", String(on)); // the room's STATE came back with it
  await drawer.getByRole("button", { name: "關閉" }).click();
}
