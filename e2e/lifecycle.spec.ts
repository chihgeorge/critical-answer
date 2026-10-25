/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";

/**
 * A room that nobody uses stops costing money: after the idle time the real Durable Object closes every
 * connection (the game stays saved), and after the expiry time it forgets the room so the code can be used
 * again. Real alarms in workerd, with the two times cut from 2 hours / 24 hours to 2 / 6 seconds.
 */
const PORT = 1994;
const STORE = ".wrangler/lifecycle-e2e";
const BASE = `ws://localhost:${PORT}/parties/main/LIFE`;
const IDLE_MS = 2000;
const EXPIRE_MS = 6000;
const CLOSE_IDLE = 4001;

const T1 = "00000000-0000-0000-0000-0000000000b1";
const T2 = "00000000-0000-0000-0000-0000000000b2";
const KEY1 = "life-team-one-secret-0123456789";
const KEY2 = "life-team-two-secret-0123456789";
const HOST_TOKEN = "life-host-token-0123456789";

/** Kill the worker and wait for its port to actually free, so a leaked process never blocks the next run. */
async function killAndWaitFree(worker: import("node:child_process").ChildProcess, port: number) {
  try {
    process.kill(-worker.pid!, "SIGKILL");
  } catch {
    /* already gone */
  }
  for (let i = 0; i < 20; i++) {
    const stillUp = await fetch(`http://localhost:${port}/healthz`).then(() => true, () => false);
    if (!stillUp) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

function startWorker(): ChildProcess {
  return spawn(
    "npx",
    [
      "wrangler", "dev", "--port", String(PORT), "--persist-to", STORE,
      "--var", "ALLOWED_ORIGINS:*", "--var", "ANTHROPIC_API_KEY:",
      "--var", `ROOM_IDLE_MS:${IDLE_MS}`, "--var", `ROOM_EXPIRE_MS:${EXPIRE_MS}`,
    ],
    { detached: true, stdio: "ignore" },
  );
}

type Peer = { ws: WebSocket; seen: any[]; closedWith: number | null };
const open = () =>
  new Promise<Peer>((resolve, reject) => {
    const ws = new WebSocket(BASE);
    const peer: Peer = { ws, seen: [], closedWith: null };
    ws.onmessage = (e) => peer.seen.push(JSON.parse(e.data as string));
    ws.onclose = (e) => { peer.closedWith = e.code; };
    ws.onopen = () => resolve(peer);
    ws.onerror = () => reject(new Error("socket error"));
  });
const last = (p: Peer, type: string) => p.seen.findLast((m) => m.type === type);
const send = (p: Peer, m: object) => p.ws.send(JSON.stringify(m));
const wait = <T,>(fn: () => T | undefined | null | false, what: string, timeout = 15_000) =>
  expect.poll(fn, { message: what, timeout, intervals: [100] }).toBeTruthy();

test("a room only ever watched on the big screen (nobody ever played) still rests after the idle time", async () => {
  test.setTimeout(30_000);
  rmSync(STORE, { recursive: true, force: true });
  const worker = startWorker();
  try {
    await expect
      .poll(() => fetch(`http://localhost:${PORT}/healthz`).then((r) => r.ok, () => false), { timeout: 60_000, intervals: [500] })
      .toBe(true);
    // /screen never sends a message at all — this room's only activity, ever, is this one connection opening.
    const screen = await open();
    await expect
      .poll(() => screen.closedWith, { timeout: IDLE_MS + 5000, intervals: [200] })
      .toBe(CLOSE_IDLE);
  } finally {
    await killAndWaitFree(worker, PORT);
  }
});

test("an unused room closes its connections after the idle time, keeps the game, and is forgotten after the expiry", async () => {
  test.setTimeout(120_000);
  rmSync(STORE, { recursive: true, force: true });
  const worker = startWorker();
  try {
    await expect
      .poll(() => fetch(`http://localhost:${PORT}/healthz`).then((r) => r.ok, () => false), { timeout: 60_000, intervals: [500] })
      .toBe(true);

    // A game with one correct answer.
    const host = await open(), a = await open(), b = await open();
    send(host, { type: "HOST_CLAIM", token: HOST_TOKEN });
    send(a, { type: "JOIN", teamId: T1, teamKey: KEY1, teamName: "甲隊" });
    send(b, { type: "JOIN", teamId: T2, teamKey: KEY2, teamName: "乙隊" });
    await wait(() => last(a, "LOBBY")?.teams.length === 2, "both teams in the lobby");
    send(host, { type: "HOST_START", aiNarration: false });
    await wait(() => last(host, "HOST_ANSWER"), "the host is sent the answer");
    const dealt = last(host, "HOST_ANSWER");
    const options: string[] | undefined = last(a, "STATE").question?.options;
    if (options) {
      // A multipleChoice turn is answered by the team's own lock, not HOST_JUDGE. Both phones
      // send it; the one not on turn is refused.
      for (const p of [a, b]) {
        send(p, { type: "TEAM_SELECT_OPTION", questionId: dealt.questionId, optionIndex: options.indexOf(dealt.answer) });
        send(p, { type: "TEAM_LOCK_OPTION", questionId: dealt.questionId });
      }
    } else send(host, { type: "HOST_JUDGE", teamId: last(a, "STATE").view.currentTurnTeamId, questionId: dealt.questionId, correct: true });
    await wait(() => last(a, "STATE")?.eventId >= 2, "the judgment is applied");
    const before = last(a, "STATE");
    const epoch = before.roomEpoch;
    const scores = before.view.teams.map((t: any) => [t.id, t.score]);
    const activeAt = Date.now();

    // Just after the last activity everyone is still connected.
    expect([host, a, b].every((p) => p.closedWith === null)).toBe(true);

    // Idle: the room closes every connection with the idle code, on its own.
    await wait(() => [host, a, b].every((p) => p.closedWith === CLOSE_IDLE), "every connection closed with the idle code");
    expect(Date.now() - activeAt).toBeGreaterThanOrEqual(IDLE_MS - 500); // not sooner than the idle time

    // The game is still there: the same people reconnect with their saved secrets and find it as it was.
    const host2 = await open(), a2 = await open(), b2 = await open();
    send(host2, { type: "HOST_CLAIM", token: HOST_TOKEN });
    send(a2, { type: "JOIN", teamId: T1, teamKey: KEY1, teamName: "甲隊" });
    send(b2, { type: "JOIN", teamId: T2, teamKey: KEY2, teamName: "乙隊" });
    await wait(() => last(a2, "STATE")?.view.teams.every((t: any) => t.online), "both teams back");
    expect(last(a2, "STATE").view.teams.map((t: any) => [t.id, t.score])).toEqual(scores);
    expect(last(a2, "STATE").roomEpoch).toBe(epoch);

    // Reconnecting was activity, so the idle clock started again: it closes once more.
    await wait(() => [host2, a2, b2].every((p) => p.closedWith === CLOSE_IDLE), "closed again after the reconnect");

    // Nobody comes back for the expiry time: the room is forgotten and its code is free.
    await new Promise((r) => setTimeout(r, EXPIRE_MS + 1500));
    const newHost = await open();
    send(newHost, { type: "HOST_CLAIM", token: "some-brand-new-host-token-0123456789" });
    await wait(() => last(newHost, "HOST_OK"), "a new host can take the code");
    expect(last(newHost, "LOBBY")).toBeTruthy(); // an empty lobby, not the old game
    expect(last(newHost, "LOBBY").roomEpoch).not.toBe(epoch);
    const oldTeam = await open();
    send(oldTeam, { type: "JOIN", teamId: T1, teamKey: KEY1, teamName: "甲隊" });
    await wait(() => last(oldTeam, "LOBBY")?.teams.some((t: any) => t.id === T1), "the old team is just a new team in the empty lobby");
    expect(last(oldTeam, "STATE")).toBeUndefined();
    for (const p of [newHost, oldTeam]) p.ws.close();
  } finally {
    await killAndWaitFree(worker, PORT);
  }
});
