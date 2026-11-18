"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ROOM_CODE_RE } from "@/lib/gate";
import { freshHostPath, generateRoomCode, newHostToken } from "@/lib/room-code";
import { MAX_PASSWORD } from "@/lib/protocol";
import { rememberJoinPassword } from "@/lib/stored";
import { HomeBackground, LabelChip, Panel, PixelButton, Sprite } from "@/components/pixel";
import { TitleMusic } from "@/components/title-music";

const inputClass =
  "w-full border-4 border-[var(--k)] bg-white px-4 py-3 text-[17px] text-[var(--ink)] outline-none focus:bg-[var(--turn)] md:text-[20px]";
const TITLE_OUTLINE = { textShadow: "3px 3px 0 var(--k), -2px -2px 0 var(--k), 2px -2px 0 var(--k), -2px 2px 0 var(--k)" };
// The title screen's monster parade. The phone shows the middle four (mushroom to ghost, 328px at 2x), which fit 360px.
const PARADE = ["slime", "mushroom", "bat", "dragon", "ghost", "skeleton", "frog"] as const;

function HomeForm() {
  const router = useRouter();
  // A scanned QR arrives as /?code=ABCD and fills the code in.
  const [joinCode, setJoinCode] = useState((useSearchParams().get("code") ?? "").toUpperCase().slice(0, 4));
  const [teamName, setTeamName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleCreateRoom() {
    const code = generateRoomCode();
    router.push(freshHostPath(code, newHostToken()));
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const name = teamName.trim().slice(0, 20);
    const code = joinCode.trim().toUpperCase();
    if (!name) {
      setError("請輸入隊伍名稱");
      return;
    }
    if (!ROOM_CODE_RE.test(code)) {
      setError("房間代碼不對，請照電視上的 4 個字母輸入");
      return;
    }
    rememberJoinPassword(code, password.trim());
    router.push(`/room/${code}/play?name=${encodeURIComponent(name)}`);
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <HomeBackground />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center gap-4 px-4 py-6 md:gap-5">
        {/* The title screen (C): a stone-framed title plate, a monster parade and ▶ PRESS START. */}
        <Panel tone="turn" className="px-stone w-full text-center">
          <div className="px-4 py-4 md:py-5">
            <h1 className="text-[52px] leading-none text-[var(--warn)] md:text-[88px]" style={TITLE_OUTLINE}>
              致命答題
            </h1>
            <p className="px-num mt-3 text-[11px] md:text-[14px]">CRITICAL ANSWER</p>
            <p className="mt-2 text-[16px] md:text-[20px]">地城問答派對遊戲</p>
          </div>
          {/* The title music (components/title-music.tsx): plays after the first tap, with its mute toggle. */}
          <div id="title-theme-slot" className="absolute right-2 top-2">
            <TitleMusic />
          </div>
        </Panel>
        <div className="flex items-end justify-center gap-2 md:gap-4" aria-hidden="true">
          {PARADE.map((kind, i) => (
            <span key={kind} className={i === 0 || i >= 5 ? "hidden md:block" : undefined}>
              <Sprite kind={kind} scale={2} />
            </span>
          ))}
        </div>
        <p
          className="px-num px-anim text-[12px] text-white md:text-[14px]"
          style={{ textShadow: "2px 2px 0 var(--k)", animation: "px-blink 1s steps(1) infinite" }}
          aria-hidden="true"
        >
          ▶ PRESS START
        </p>

        {/* The two doors (B). The player's comes first, so a phone that scanned the QR sees the form without scrolling. */}
        <div className="grid w-full gap-5 md:grid-cols-2">
          <Panel className="px-stone min-w-0">
            <form onSubmit={handleJoin} className="flex flex-col gap-3 p-4 md:p-5">
              <div className="flex items-end gap-3">
                <Sprite kind="hero" scale={3} />
                <div>
                  <h2 className="text-[26px] leading-tight">我是玩家</h2>
                  <p className="text-[15px]">照電視上的 4 個字母加入</p>
                </div>
              </div>
              <input
                type="text"
                placeholder="隊伍名稱"
                value={teamName}
                onChange={(e) => {
                  setTeamName(e.target.value);
                  setError("");
                }}
                maxLength={20}
                className={inputClass}
              />
              <input
                type="text"
                placeholder="房間密碼（主持人有設才要填）"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={MAX_PASSWORD}
                autoComplete="off"
                className={inputClass}
              />
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  placeholder="房間代碼"
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value.toUpperCase());
                    setError("");
                  }}
                  maxLength={4}
                  className={`${inputClass} min-w-0 flex-1 text-center tracking-[0.3em]`}
                />
                <PixelButton type="submit" variant="ok" className="!m-0 !min-h-0 !px-5 !text-[20px]">
                  加入 →
                </PixelButton>
              </div>
              {error && <p className="text-center text-[15px]" style={{ color: "#b02a3a" }}>{error}</p>}
            </form>
          </Panel>

          <Panel tone="lav" className="px-stone min-w-0">
            <div className="flex h-full flex-col gap-3 p-4 md:p-5">
              <div className="flex items-end gap-3">
                <Sprite kind="door" scale={3} />
                <div>
                  <h2 className="text-[26px] leading-tight">我是主持人</h2>
                  <p className="text-[15px]">開一間地城，把大螢幕投到電視上</p>
                </div>
              </div>
              <ol className="flex-1 space-y-2 text-[16px]">
                <li><LabelChip>1</LabelChip> 開房，電視顯示代碼與 QR</li>
                <li><LabelChip>2</LabelChip> 各隊用手機加入</li>
                <li><LabelChip>3</LabelChip> 你主持判定，大家搶答打王</li>
              </ol>
              <PixelButton variant="primary" onClick={handleCreateRoom} className="!mx-0">
                🏰 主持遊戲 · Create a Room
              </PixelButton>
              <a href="/bank-editor" className="self-center text-[14px] text-[var(--ink)] underline underline-offset-2">
                題庫編輯器（需要 owner key）
              </a>
            </div>
          </Panel>
        </div>
      </div>
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense>
      <HomeForm />
    </Suspense>
  );
}
