import { describe, it, expect } from "vitest";
import { ACCESSORIES, DISH_LIMITS, HUE_SHIFTS, MONSTERS, TITLE, catalogMonster, fnv1a, monsterById, variantOf, type BankDish } from "./monster-catalog";
import { DISH_SPRITE, MONSTER_SPRITES } from "./sprite-kind";

describe("the monster catalog", () => {
  // Value: protects=ids and sprites are unique, every sprite is a monster sprite with a dish, and there is at least one boss and one room monster; fails_when=two entries share an id or a sprite, or a sprite has no dish; why_new=new catalog; seam=none; no_claim=the sprites look different on screen
  it("has unique ids and sprites, each sprite drawable with a dish", () => {
    expect(new Set(MONSTERS.map((m) => m.id)).size).toBe(MONSTERS.length);
    expect(new Set(MONSTERS.map((m) => m.sprite)).size).toBe(MONSTERS.length);
    for (const m of MONSTERS) {
      expect(MONSTER_SPRITES).toContain(m.sprite);
      expect(DISH_SPRITE[m.sprite]).toBeTruthy();
    }
    expect(MONSTERS.filter((m) => m.boss).map((m) => m.id)).toEqual(["dragon", "kraken", "phoenix"]);
    expect(MONSTERS.filter((m) => !m.boss)).toHaveLength(20);
  });

  // Value: protects=MONSTER_SPRITES and the catalog stay one to one (risk 8: a hand-synced list), apart from the two map-only slimes; fails_when=a sprite is added without a catalog entry, or the reverse; why_new=PR2 adds 19 sprites; seam=none; no_claim=the dish art exists (tsc checks DISH_SPRITE)
  it("gives every monster sprite exactly one catalog monster, except the map-only slimes", () => {
    const used = MONSTERS.map((m) => m.sprite).sort();
    expect(used).toEqual(MONSTER_SPRITES.filter((s) => s !== "slime-lost" && s !== "slime-king").sort());
  });

  // Value: protects=every dish fits the TV card; fails_when=a dish field is empty or over DISH_LIMITS; why_new=dishes moved from the bank into the catalog; seam=none; no_claim=the wording is good
  it("has every dish field filled and within its limit", () => {
    for (const m of MONSTERS) {
      for (const k of Object.keys(DISH_LIMITS) as (keyof BankDish)[]) {
        expect(m.dish[k].trim(), `${m.id} ${k}`).not.toBe("");
        expect(Array.from(m.dish[k]).length, `${m.id} ${k}`).toBeLessThanOrEqual(DISH_LIMITS[k]);
      }
    }
  });

  // Value: protects=lookup by id, undefined for an unknown id, and catalogMonster throwing with the id; fails_when=the map is keyed wrong or catalogMonster returns undefined; why_new=new catalog; seam=none; no_claim=none
  it("looks monsters up by id", () => {
    expect(monsterById("ghost-shy")?.name).toBe("害羞幽靈");
    expect(monsterById("nope")).toBeUndefined();
    expect(() => catalogMonster("nope")).toThrow(/nope/);
  });
});

describe("variantOf", () => {
  const slime = catalogMonster("slime-soft");

  // Value: protects=the first appearance and every boss stay plain; fails_when=n is off by one or the boss check goes; why_new=new rule (D5); seam=none; no_claim=rendering
  it("is plain on the first appearance and for a boss", () => {
    expect(variantOf(7, slime, 0)).toBeNull();
    expect(variantOf(7, catalogMonster("dragon"), 3)).toBeNull();
  });

  // Value: protects=same seed and count give the same look, and each defeat changes the accessory in order; fails_when=the start or the step of the cycle is wrong; why_new=new rule (D4/D5, R1); seam=none; no_claim=rendering
  it("is deterministic and steps through the accessories and hues", () => {
    const s = fnv1a(`7:${slime.id}`);
    for (let n = 1; n <= 13; n++) {
      const v = variantOf(7, slime, n)!;
      expect(v).toEqual(variantOf(7, slime, n));
      expect(v.accessory).toBe(ACCESSORIES[(s + n - 1) % 6]);
      expect(v.hueShift).toBe(HUE_SHIFTS[((s >>> 8) + n - 1) % 4]);
      expect(v.title).toBe(TITLE[v.accessory]);
      if (n > 1) expect(v.accessory).not.toBe(variantOf(7, slime, n - 1)!.accessory);
    }
  });

  // Value: protects=the variant hash is the standard FNV-1a 32-bit (known vectors), so a seed gives the same look everywhere; fails_when=the offset, prime or unsigned shift changes; why_new=new hash; seam=none; no_claim=distribution quality
  it("hashes with FNV-1a 32-bit", () => {
    expect(fnv1a("")).toBe(2166136261);
    expect(fnv1a("a")).toBe(0xe40c292c);
  });
});
