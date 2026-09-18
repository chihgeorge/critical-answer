"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { generateRoomCode } from "@/lib/room-code";

export default function HomePage() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState("");

  function handleCreateRoom() {
    const code = generateRoomCode();
    router.push(`/room/${code}/host`);
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
    router.push(`/room/${code}/play?name=${encodeURIComponent(name)}`);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-5 py-12">
      <div className="text-center">
        <h1 className="text-5xl font-black tracking-tight">dungeon_master</h1>
        <p className="mt-2 text-[var(--ink2)]">地城問答派對遊戲 · Iteration 1</p>
      </div>

      <form
        onSubmit={handleJoin}
        className="flex w-full max-w-sm flex-col gap-3 rounded-2xl bg-[var(--surface)] p-6"
      >
        <p className="text-xs font-bold text-[var(--ink2)]">加入現有房間</p>
        <input
          type="text"
          placeholder="隊伍名稱"
          value={teamName}
          onChange={(e) => {
            setTeamName(e.target.value);
            setError("");
          }}
          maxLength={20}
          className="rounded-xl border-2 border-[var(--surface2)] bg-[var(--surface2)] px-4 py-3 outline-none focus:border-[var(--accent)]"
        />
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="房間代碼"
            value={joinCode}
            onChange={(e) => {
              setJoinCode(e.target.value.toUpperCase());
              setError("");
            }}
            maxLength={4}
            className="min-w-0 flex-1 rounded-xl border-2 border-[var(--surface2)] bg-[var(--surface2)] px-4 py-3 text-center font-mono tracking-widest outline-none focus:border-[var(--accent)]"
          />
          <button
            type="submit"
            className="whitespace-nowrap rounded-xl bg-[var(--accent)] px-5 py-3 font-black text-white"
          >
            加入 →
          </button>
        </div>
        {error && <p className="text-center text-sm text-[var(--danger)]">{error}</p>}

        <div className="my-1 flex items-center gap-3 text-xs text-[var(--ink2)]">
          <div className="h-px flex-1 bg-[var(--surface2)]" />或<div className="h-px flex-1 bg-[var(--surface2)]" />
        </div>

        <button
          type="button"
          onClick={handleCreateRoom}
          className="rounded-xl bg-[var(--accent)] py-3 font-black text-white"
        >
          🏰 主持遊戲 · Create a Room
        </button>
      </form>
    </main>
  );
}
