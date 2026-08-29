import { describe, expect, it } from "vitest";
import type { Card, CardColor } from "../src/game/types";
import { findValidPekojans, dedupeByVisibleIdentity, combinations } from "../src/game/hands";
import { calculatePekojanScore, BONUS_PER_CARD } from "../src/game/scoring";
import { GROUPS } from "../src/data/characters";

// Dynamic fixtures from the real roster
const G3 = GROUPS.find((g) => g.characterIds.length === 3)!; // ID 1st Gen
const G4 = GROUPS.find((g) => g.characterIds.length === 4)!; // 1st Gen
const G5 = GROUPS.find((g) => g.characterIds.length === 5)!; // Myth

let uid = 0;
function mk(characterId: string, groupId: string, color: CardColor): Card {
  return { id: `t${uid++}`, characterId, groupId, color };
}

describe("hand detection", () => {
  it("detects a mixed three-of-a-kind", () => {
    const hand = [mk("fubuki", "gen1", "pink"), mk("fubuki", "gen1", "orange"), mk("fubuki", "gen1", "blue")];
    const cands = findValidPekojans(hand, [G4], "sora");
    expect(cands).toHaveLength(1);
    expect(cands[0].type).toBe("three-of-kind");
    expect(cands[0].sameColor).toBe(false);
    expect(cands[0].totalScore).toBe(120);
  });

  it("detects a monochrome three-of-a-kind as the high-value variant", () => {
    const hand = [mk("miko", "gen0", "pink"), mk("miko", "gen0", "pink"), mk("miko", "gen0", "pink")];
    const cands = findValidPekojans(hand, [G5], "sora");
    expect(cands).toHaveLength(1);
    expect(cands[0].sameColor).toBe(true);
    expect(cands[0].totalScore).toBe(840);
  });

  it("rejects two-of-a-kind", () => {
    const hand = [mk("kobo", "id3", "pink"), mk("kobo", "id3", "orange")];
    expect(findValidPekojans(hand, [G3], "sora")).toHaveLength(0);
  });

  it("enumerates every distinct 3-subset when copies exceed three", () => {
    const hand = [
      mk("gura", "myth", "pink"),
      mk("gura", "myth", "pink"),
      mk("gura", "myth", "orange"),
      mk("gura", "myth", "blue"),
    ];
    const cands = findValidPekojans(hand, [], "sora");
    expect(cands).toHaveLength(4); // C(4,3) physical subsets
    expect(new Set(cands.map((c) => c.cardIds.join(","))).size).toBe(4);
  });

  it("detects 3/4/5-person group completions with mixed colors", () => {
    const g3 = G3.characterIds.map((id, i) => mk(id, G3.id, (["pink", "blue", "orange"] as CardColor[])[i]));
    expect(findValidPekojans(g3, [G3], "sora")[0].totalScore).toBe(180);

    const g4 = G4.characterIds.map((id, i) => mk(id, G4.id, (["pink", "blue", "orange"] as CardColor[])[i % 3]));
    expect(findValidPekojans(g4, [G4], "sora")[0].totalScore).toBe(300);

    const g5 = G5.characterIds.map((id) => mk(id, G5.id, "orange"));
    const cand = findValidPekojans(g5, [G5], "korone");
    expect(cand[0].sameColor).toBe(true);
    expect(cand[0].totalScore).toBe(1800);
  });

  it("does not substitute duplicate characters for missing members", () => {
    const [a, b, , d] = G4.characterIds;
    const hand = [mk(a, G4.id, "pink"), mk(b, G4.id, "blue"), mk(b, G4.id, "orange")];
    expect(findValidPekojans(hand, [G4], "sora")).toHaveLength(0);
  });

  it("reports both monochrome and mixed representations of the same group separately", () => {
    const [a, b, c] = G3.characterIds;
    const hand = [
      mk(a, G3.id, "pink"),
      mk(a, G3.id, "pink"),
      mk(a, G3.id, "blue"),
      mk(b, G3.id, "pink"),
      mk(b, G3.id, "orange"),
      mk(c, G3.id, "pink"),
    ];
    const cands = findValidPekojans(hand, [G3], "sora").filter((x) => x.type === "group");
    expect(cands.length).toBeGreaterThanOrEqual(6); // 3 a-copies × 2 b-copies × 1 c
    expect(cands.some((x) => x.sameColor && x.totalScore === 480)).toBe(true);
    expect(cands.some((x) => !x.sameColor && x.totalScore === 180)).toBe(true);
  });

  it("finds Pekojan via an optional claimed discard", () => {
    const hand = [mk("roboco", "gen0", "blue"), mk("roboco", "gen0", "orange")];
    const discard = mk("roboco", "gen0", "pink");
    const cands = findValidPekojans(hand, [], "sora", discard);
    expect(cands).toHaveLength(1);
    expect(cands[0].cardIds.includes(discard.id)).toBe(true);
  });

  it("combinations helper enumerates correctly", () => {
    expect(combinations([1, 2, 3], 2)).toHaveLength(3);
    expect(combinations([1, 2], 3)).toHaveLength(0);
  });
});

describe("scores", () => {
  const c = (ch: string, color: CardColor): Card => ({
    id: ch + color + Math.random(),
    characterId: ch,
    groupId: "g",
    color,
  });

  it.each([
    ["triple mixed", [c("sora", "pink"), c("sora", "blue"), c("sora", "orange")], "three-of-kind" as const, 120],
    ["triple mono", [c("sora", "pink"), c("sora", "pink"), c("sora", "pink")], "three-of-kind" as const, 840],
    ["3-group mixed", [c("a", "pink"), c("b", "blue"), c("c", "orange")], "group" as const, 180],
    ["3-group mono", [c("a", "pink"), c("b", "pink"), c("c", "pink")], "group" as const, 480],
    ["4-group mixed", [c("a", "pink"), c("b", "blue"), c("c", "orange"), c("d", "pink")], "group" as const, 300],
    ["4-group mono", [c("a", "pink"), c("b", "pink"), c("c", "pink"), c("d", "pink")], "group" as const, 840],
    ["5-group mixed", [c("a", "pink"), c("b", "blue"), c("c", "orange"), c("d", "pink"), c("e", "blue")], "group" as const, 480],
    ["5-group mono", [c("a", "pink"), c("b", "pink"), c("c", "pink"), c("d", "pink"), c("e", "pink")], "group" as const, 1800],
  ])("%s", (_name, cards, handType, expected) => {
    expect(calculatePekojanScore(cards, "nobody", handType).totalScore).toBe(expected);
  });

  it("adds +90 per bonus character card", () => {
    const cards = [c("pekora", "pink"), c("pekora", "blue"), c("pekora", "orange")];
    expect(calculatePekojanScore(cards, "pekora", "three-of-kind").bonusCharacterScore).toBe(BONUS_PER_CARD * 3);
    expect(calculatePekojanScore(cards, "pekora", "three-of-kind").totalScore).toBe(120 + 270);
    const g = [c("a", "pink"), c("b", "blue"), c("c", "orange")];
    expect(calculatePekojanScore(g, "b", "group").totalScore).toBe(180 + 90);
  });
});

describe("dedupeByVisibleIdentity", () => {
  it("collapses candidates that differ only by physical copy", () => {
    const [a, b, c] = G3.characterIds;
    const hand = [
      mk(a, G3.id, "pink"),
      mk(a, G3.id, "pink"),
      mk(b, G3.id, "orange"),
      mk(c, G3.id, "blue"),
    ];
    const cands = findValidPekojans(hand, [G3], "sora").filter((x) => x.type === "group");
    expect(cands.length).toBe(2); // two physical a-pink copies → two hands
    const lookup = new Map(hand.map((x) => [x.id, x]));
    const visible = dedupeByVisibleIdentity(cands, lookup);
    expect(visible).toHaveLength(1);
    expect(visible[0].totalScore).toBe(180);
  });

  it("keeps genuinely different hands (different colors)", () => {
    const [a, b, c] = G3.characterIds;
    const hand = [
      mk(a, G3.id, "pink"),
      mk(a, G3.id, "pink"),
      mk(a, G3.id, "blue"),
      mk(b, G3.id, "pink"),
      mk(c, G3.id, "pink"),
    ];
    const cands = findValidPekojans(hand, [G3], "sora");
    const lookup = new Map(hand.map((x) => [x.id, x]));
    const visible = dedupeByVisibleIdentity(cands, lookup);
    expect(visible.some((x) => x.type === "group" && x.sameColor && x.totalScore === 480)).toBe(true);
    expect(visible.some((x) => x.type === "three-of-kind" && !x.sameColor && x.totalScore === 120)).toBe(true);
  });
});
