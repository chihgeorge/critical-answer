import { describe, it, expect } from "vitest";
import { decodeDraft, draftKey, draftToOffer, encodeDraft } from "./bank-editor-draft";
import { BANK } from "./question-bank-data";
import type { Bank } from "./question-bank";

const edited: Bank = { ...BANK, pools: { ...BANK.pools, 1: [{ kind: "text", id: "d-1", content: { kind: "text", value: "" }, answer: "" }] } };

describe("bank editor: drafts", () => {
  it("round-trips an unfinished bank, NaN boxes included, and never carries anything but the bank and its version", () => {
    const withNaN: Bank = { ...edited, pools: { ...edited.pools, 2: [{ kind: "text", id: "d-2", content: { kind: "youtube", value: "abcdefghijk", start: NaN }, answer: "x" }] } };
    const raw = encodeDraft({ version: 7, savedAt: 1, bank: withNaN });
    const back = decodeDraft(raw)!;
    expect(back.version).toBe(7);
    expect(back.bank.pools[1][0]).toEqual(edited.pools[1][0]);
    expect(Number.isNaN((back.bank.pools[2][0].content as { start?: number }).start)).toBe(true);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["bank", "format", "savedAt", "version"]);
    expect(draftKey("abc")).toBe("bank-editor-draft:abc");
    // Only number keys are revived: a text reading like the marker stays text.
    const marker: Bank = { ...edited, pools: { ...edited.pools, 1: [{ kind: "text", id: "d-3", content: { kind: "text", value: "__NaN__" }, answer: "__NaN__" }] } };
    expect(decodeDraft(encodeDraft({ version: 1, savedAt: 1, bank: marker }))!.bank.pools[1][0]).toEqual(marker.pools[1][0]);
  });

  it("ignores nothing stored, garbage, another format and shapes the editor cannot render", () => {
    expect(decodeDraft(null)).toBeNull();
    expect(decodeDraft("{not json")).toBeNull();
    const good = JSON.parse(encodeDraft({ version: 1, savedAt: 1, bank: edited }));
    expect(decodeDraft(JSON.stringify({ ...good, format: 99 }))).toBeNull();
    expect(decodeDraft(JSON.stringify({ ...good, bank: { ...good.bank, pools: { ...good.bank.pools, 3: "x" } } }))).toBeNull();
    const badQuestion = { ...good.bank, pools: { ...good.bank.pools, 1: [{ kind: "multipleChoice", id: "m", content: { kind: "text", value: "" }, options: "甲" }] } };
    expect(decodeDraft(JSON.stringify({ ...good, bank: badQuestion }))).toBeNull();
    expect(decodeDraft(JSON.stringify({ ...good, bank: { ...good.bank, boss: { phases: [{ name: "", rule: "" }] } } }))).toBeNull();
  });

  it("offers a draft that differs from the server: fresh on the same version, stale once the server moved on", () => {
    const raw = encodeDraft({ version: 4, savedAt: 1, bank: edited });
    expect(draftToOffer(raw, BANK, 4)).toMatchObject({ stale: false, draft: { version: 4 } });
    expect(draftToOffer(raw, BANK, 5)).toMatchObject({ stale: true });
    // Same content as the server (edits undone, or already saved elsewhere): nothing to offer.
    expect(draftToOffer(encodeDraft({ version: 4, savedAt: 1, bank: BANK }), BANK, 4)).toBeNull();
    expect(draftToOffer(null, BANK, 4)).toBeNull();
  });
});
