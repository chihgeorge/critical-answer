/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";

/**
 * The point of saving a room: kill the server in the middle of a game (no goodbye, like a crash or a
 * deploy), start it again on the same storage, and the game is where it was. This runs the real Worker
 * in workerd with real Durable Object storage on disk. Own port and storage, so it never touches the
 * other tests' server.
 */
const PORT = 1995;
const STORE = ".wrangler/restart-e2e";
const BASE = `ws://localhost:${PORT}/parties/main/RSTR`;

const T1 = "00000000-0000-0000-0000-0000000000a1";
const T2 = "00000000-0000-0000-0000-0000000000a2";
const KEY1 = "restart-team-one-secret-0123456789";
const KEY2 = "restart-team-two-secret-0123456789";
const HOST_TOKEN = "restart-host-token-0123456789";

function startWorker(): ChildProcess {
  // detached: the whole process group (npx, wrangler, workerd) can be killed at once.
  return spawn(
    "npx",
    ["wrangler", "dev", "--port", String(PORT), "--persist-to", STORE, "--var", "ALLOWED_ORIGINS:*", "--var", "ANTHROPIC_API_KEY:"],
    { detached: true, stdio: "ignore" },
  );
}

async function waitHealthy() {
  await expect
    .poll(() => fetch(`http://localhost:${PORT}/healthz`).then((r) => r.ok, () => false), { timeout: 60_000, intervals: [500] })
    .toBe(true);
}

/** SIGKILL, not a polite stop: nothing gets a chance to save on the way out. */
/** Kill the worker and wait for its port to actually free, so a leaked process never blocks the next run. */
async function killAndWaitFree(worker: ChildProcess, port: number) {
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

async function crash(child: ChildProcess) {
  process.kill(-child.pid!, "SIGKILL");
  await expect
    .poll(() => fetch(`http://localhost:${PORT}/healthz`).then(() => true, () => false), { timeout: 20_000, intervals: [300] })
    .toBe(false);
}

type Peer = { ws: WebSocket; seen: any[] };
const open = () =>
  new Promise<Peer>((resolve, reject) => {
    const ws = new WebSocket(BASE);
    const seen: any[] = [];
    ws.onmessage = (e) => seen.push(JSON.parse(e.data as string));
    ws.onopen = () => resolve({ ws, seen });
    ws.onerror = () => reject(new Error("socket error"));
  });
const last = (p: Peer, type: string) => p.seen.findLast((m) => m.type === type);
const wait = <T,>(fn: () => T | undefined, what: string) =>
  expect.poll(fn, { message: what, timeout: 15_000, intervals: [100] }).toBeTruthy();

test("a game survives the server being killed and started again", async () => {
  test.setTimeout(120_000);
  rmSync(STORE, { recursive: true, force: true });
  let worker = startWorker();
  const cleanup = () => killAndWaitFree(worker, PORT);
  try {
    await waitHealthy();

    // Before: a host, two teams, one correct answer.
    const host = await open();
    host.ws.send(JSON.stringify({ type: "HOST_CLAIM", token: HOST_TOKEN }));
    const a = await open();
    const b = await open();
    a.ws.send(JSON.stringify({ type: "JOIN", teamId: T1, teamKey: KEY1, teamName: "甲隊" }));
    b.ws.send(JSON.stringify({ type: "JOIN", teamId: T2, teamKey: KEY2, teamName: "乙隊" }));
    await wait(() => last(a, "LOBBY")?.teams.length === 2, "both teams in the lobby");
    host.ws.send(JSON.stringify({ type: "HOST_START", aiNarration: false }));
    await wait(() => last(host, "HOST_ANSWER"), "the host is sent the answer");
    const q = last(host, "HOST_ANSWER");
    const onTurn = last(a, "STATE").view.currentTurnTeamId as string;
    host.ws.send(JSON.stringify({ type: "HOST_JUDGE", teamId: onTurn, questionId: q.questionId, correct: true }));
    await wait(() => last(a, "STATE")?.eventId >= 2, "the judgment is applied");
    const before = last(a, "STATE");
    const scoresBefore = before.view.teams.map((t: any) => [t.id, t.score]);
    expect(scoresBefore.some(([, score]: [string, number]) => score > 0)).toBe(true);
    for (const p of [host, a, b]) p.ws.close();

    // The crash.
    await crash(worker);

    // After: same storage, new process.
    worker = startWorker();
    await waitHealthy();
    const host2 = await open();
    const a2 = await open();
    const b2 = await open();

    // Nobody is trusted just because they connect: a stranger cannot take the host seat...
    const stranger = await open();
    stranger.ws.send(JSON.stringify({ type: "HOST_CLAIM", token: "some-other-token-0123456789" }));
    await wait(() => stranger.seen.find((m) => m.type === "ERROR" && m.error === "bad_token"), "stranger refused as host");
    // ...or a team, with only its public id.
    stranger.ws.send(JSON.stringify({ type: "JOIN", teamId: T1, teamKey: "not-the-team-secret-0123456789", teamName: "甲隊" }));
    await wait(() => stranger.seen.filter((m) => m.type === "ERROR" && m.error === "bad_token").length >= 2, "stranger refused as team");

    // The real ones come back with what they saved.
    host2.ws.send(JSON.stringify({ type: "HOST_CLAIM", token: HOST_TOKEN }));
    a2.ws.send(JSON.stringify({ type: "JOIN", teamId: T1, teamKey: KEY1, teamName: "甲隊" }));
    b2.ws.send(JSON.stringify({ type: "JOIN", teamId: T2, teamKey: KEY2, teamName: "乙隊" }));
    await wait(() => last(a2, "STATE")?.view.teams.every((t: any) => t.online), "both teams back online");

    const after = last(a2, "STATE");
    expect(after.view.teams.map((t: any) => [t.id, t.score])).toEqual(scoresBefore);
    expect(after.phase).toBe("playing");
    expect(after.eventId).toBe(before.eventId);
    // Same epoch: no client would show a false "game reset".
    expect(after.roomEpoch).toBe(before.roomEpoch);
    // The game is playable again: the host is sent the current answer and can judge on.
    await wait(() => last(host2, "HOST_ANSWER"), "the host is sent the answer after the restart");
    expect(last(a2, "STATE").question).not.toBeNull();
    expect(JSON.stringify(a2.seen)).not.toContain(last(host2, "HOST_ANSWER").answer);
    for (const p of [host2, a2, b2, stranger]) p.ws.close();
  } finally {
    await cleanup();
  }
});
