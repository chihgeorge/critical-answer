import type { Page } from "@playwright/test";

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
