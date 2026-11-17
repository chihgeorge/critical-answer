"use client";

// The big screen's narration voice picker (docs/designs/dm-voice-narration-tts.md, "Voice picker"): every Chinese voice
// this browser offers, each with 試聽 and 選這個. On the screen page itself, not the host's ⚙ 更多: the voices belong to
// the screen computer's browser, and the host's phone offers different ones. Lobby only, so 試聽's cancel() never cuts
// a narration short.

import { useState } from "react";
import { PixelButton } from "./pixel";

/** A line that sounds like the game's narration. */
export const VOICE_SAMPLE = "勇者們，地城的大門已經打開。第一道題目來了，準備好就搶答吧！";

export function VoicePicker({ voices, current, onPick }: { voices: SpeechSynthesisVoice[]; current: SpeechSynthesisVoice | undefined; onPick: (voice: SpeechSynthesisVoice) => void }) {
  const [open, setOpen] = useState(false);
  function audition(voice: SpeechSynthesisVoice) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(VOICE_SAMPLE);
    utter.voice = voice;
    utter.lang = voice.lang;
    window.speechSynthesis.speak(utter);
  }
  if (!open) {
    return (
      <PixelButton onClick={() => setOpen(true)} className="!m-0 !px-3 !py-1 text-[14px]" style={{ position: "fixed", top: 48, left: 12, zIndex: 30 }}>
        🗣 旁白聲音
      </PixelButton>
    );
  }
  return (
    <div
      role="dialog"
      aria-label="旁白聲音"
      data-testid="voice-picker"
      className="flex flex-col gap-2"
      style={{ position: "fixed", top: 48, left: 12, zIndex: 30, width: "min(560px, calc(100vw - 24px))", maxHeight: "calc(100vh - 60px)", background: "var(--cream)", color: "var(--ink)", border: "4px solid var(--k)", padding: 12 }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[18px]">🗣 旁白聲音（只存在這台電腦）</span>
        <PixelButton onClick={() => setOpen(false)} className="!m-0 !px-3 !py-1 text-[14px]">
          關閉
        </PixelButton>
      </div>
      {voices.length === 0 ? (
        <p className="text-[16px]">這個瀏覽器沒有中文語音。</p>
      ) : (
        <ul className="flex flex-col gap-1 overflow-y-auto" style={{ minHeight: 0 }}>
          {voices.map((v) => {
            const chosen = v.voiceURI === current?.voiceURI;
            return (
              <li key={v.voiceURI} className="flex items-center gap-2 text-[15px]" style={{ background: chosen ? "var(--turn)" : undefined, padding: "2px 4px" }}>
                <span className="min-w-0 flex-1 truncate" title={v.name}>
                  {v.name} <span style={{ opacity: 0.7 }}>{v.lang}</span>
                </span>
                <PixelButton onClick={() => audition(v)} aria-label={`試聽 ${v.name}`} className="!m-0 !px-2 !py-0.5 text-[14px]">
                  試聽
                </PixelButton>
                {chosen ? (
                  <span className="text-[14px]" style={{ width: 64, textAlign: "center" }}>
                    ✓ 使用中
                  </span>
                ) : (
                  <PixelButton onClick={() => onPick(v)} aria-label={`選這個 ${v.name}`} variant="ok" className="!m-0 !min-h-0 !px-2 !py-0.5 !text-[14px]" style={{ width: 64 }}>
                    選這個
                  </PixelButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
