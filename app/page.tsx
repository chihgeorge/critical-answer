"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { freshHostPath, generateRoomCode, newHostToken } from "@/lib/room-code";
import { rememberJoinPassword } from "@/lib/stored";
import { DialogueBox, HomeBackground, Panel, PixelButton, Sprite } from "@/components/pixel";

const inputClass =
  "w-full border-4 border-[var(--k)] bg-white px-4 py-3 text-[20px] text-[var(--ink)] outline-none focus:bg-[var(--turn)]";

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
    if (code.length !== 4) {
      setError("請輸入 4 碼房間代碼");
      return;
    }
    rememberJoinPassword(code, password.trim());
    router.push(`/room/${code}/play?name=${encodeURIComponent(name)}`);
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <HomeBackground />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-4 py-10">
        <div className="text-center">
          <div className="flex justify-center gap-2">
            <Sprite kind="slime" scale={3} />
            <Sprite kind="dragon" scale={2} />
            <Sprite kind="ghost" scale={3} />
          </div>
          <h1 className="mt-3 text-[44px] text-[var(--warn)]" style={{ textShadow: "3px 3px 0 var(--k), -2px -2px 0 var(--k), 2px -2px 0 var(--k), -2px 2px 0 var(--k)" }}>
            致命答題
          </h1>
          <p className="text-[16px] text-white" style={{ textShadow: "2px 2px 0 var(--k)" }}>Critical Answer · 地城問答派對遊戲</p>
        </div>

        <Panel className="w-full">
          <form onSubmit={handleJoin} className="flex flex-col gap-3 p-4">
            <p className="text-[16px]">加入現有房間</p>
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
              maxLength={32}
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

        <PixelButton variant="primary" onClick={handleCreateRoom} className="w-full">
          🏰 主持遊戲 · Create a Room
        </PixelButton>

        <DialogueBox compact className="w-full" lines={["歡迎，冒險者。輸入代碼加入房間，或自己開一間地城。"]} />

        <a href="/bank-editor" className="text-[13px] text-white underline underline-offset-2" style={{ textShadow: "1px 1px 0 var(--k)" }}>
          題庫編輯器（需要 owner key）
        </a>
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
