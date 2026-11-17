import { test, expect } from "@playwright/test";
import { screenUrl, closeLeftoverContexts } from "./answer";

closeLeftoverContexts();

/** Direction D 「石框木牌」 (DESIGN.md): the stone frames and wooden tiles are on by default, and /screen?frames=0 takes them
 * off one TV without a deploy (the 11/19–22 merge freeze). */
test("the big screen has the dungeon frames, and ?frames=0 takes them off", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("button", { name: /主持遊戲/ }).click();
  await host.waitForURL(/\/room\/[A-Z]{4}\/host#k=/);
  const href = await screenUrl(host);
  const screen = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();

  await screen.goto(href);
  await expect(screen.locator("body")).toHaveClass(/\bpx-frames\b/);
  await expect(screen.locator(".px-say.px-stone")).toBeVisible();

  await screen.goto(href.replace("/screen#", "/screen?frames=0#"));
  await expect(screen.locator(".px-say")).toBeVisible();
  await expect(screen.locator("body")).not.toHaveClass(/\bpx-frames\b/);
});
