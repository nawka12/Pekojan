import type { Card, PekojanCandidate } from "./types";
import type { Group } from "./types";
import { calculatePekojanScore } from "./scoring";

// ---------------------------------------------------------------------------
// Pekojan detection engine.
// Pure functions. Returns EVERY legal combination, not merely the first
// one found, and enumerates duplicate representations correctly (§27/§28).
// ---------------------------------------------------------------------------

function canonicalCandidateId(type: string, cardIds: string[], groupId?: string): string {
  return `${type}|${groupId ?? "-"}|${[...cardIds].sort().join(",")}`;
}

function buildCandidate(
  type: "three-of-kind" | "group",
  cards: Card[],
  bonusCharacterId: string,
  groupId?: string
): PekojanCandidate {
  const cardIds = cards.map((c) => c.id).sort();
  const sameColor = cards.every((c) => c.color === cards[0].color);
  const breakdown = calculatePekojanScore(cards, bonusCharacterId, type);
  return {
    id: canonicalCandidateId(type, cardIds, groupId),
    type,
    groupId,
    cardIds,
    sameColor,
    baseScore: breakdown.baseScore,
    bonusCount: breakdown.bonusCharacterScore / 90,
    bonusScore: breakdown.bonusCharacterScore,
    totalScore: breakdown.totalScore,
  };
}

/** All k-length combinations of `arr`. */
export function combinations<T>(arr: readonly T[], k: number): T[][] {
  const result: T[][] = [];
  if (k <= 0 || k > arr.length) {
    if (k === 0) result.push([]);
    return result;
  }
  const buf: T[] = [];
  const rec = (start: number) => {
    if (buf.length === k) {
      result.push([...buf]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      buf.push(arr[i]);
      rec(i + 1);
      buf.pop();
    }
  };
  rec(0);
  return result;
}

/**
 * Find every valid Pekojan in a hand (+ optional claimed discard).
 * Order groups by size so candidates with unique ids are produced for both
 * mixed and monochrome variants of the same character set.
 */
export function findValidPekojans(
  hand: readonly Card[],
  activeGroups: readonly Group[],
  bonusCharacterId: string,
  optionalDiscard?: Card
): PekojanCandidate[] {
  const cards = optionalDiscard ? [...hand, optionalDiscard] : [...hand];
  const seen = new Set<string>();
  const out: PekojanCandidate[] = [];

  // --- Type A: three of a kind -------------------------------------------
  const byChar = new Map<string, Card[]>();
  for (const c of cards) {
    const list = byChar.get(c.characterId) ?? [];
    list.push(c);
    byChar.set(c.characterId, list);
  }
  for (const [, list] of byChar) {
    if (list.length < 3) continue;
    // Enumerate ALL 3-subsets: e.g. Pink+Orange vs 3×Pink are distinct hands.
    for (const combo of combinations(list, 3)) {
      const cand = buildCandidate("three-of-kind", combo, bonusCharacterId);
      if (!seen.has(cand.id)) {
        seen.add(cand.id);
        out.push(cand);
      }
    }
  }

  // --- Type B: complete group --------------------------------------------
  for (const group of activeGroups) {
    // For each member, gather distinct copies (each copy is distinct because ids differ).
    const perMember: Card[][] = [];
    let feasible = true;
    for (const memberId of group.characterIds) {
      const copies = cards.filter((c) => c.characterId === memberId);
      if (copies.length === 0) {
        feasible = false;
        break;
      }
      perMember.push(copies);
    }
    if (!feasible || group.characterIds.length === 0) continue;

    // Cartesian product over members' copies.
    let product: Card[][] = [[]];
    for (const copies of perMember) {
      const next: Card[][] = [];
      for (const prefix of product) {
        for (const copy of copies) next.push([...prefix, copy]);
      }
      product = next;
    }
    for (const combo of product) {
      const cand = buildCandidate("group", combo, bonusCharacterId, group.id);
      if (!seen.has(cand.id)) {
        seen.add(cand.id);
        out.push(cand);
      }
    }
  }

  // Highest value first; ties broken deterministically by candidate id.
  out.sort((a, b) => b.totalScore - a.totalScore || (a.id < b.id ? -1 : 1));
  return out;
}

/**
 * Collapse candidates that are distinct only by WHICH physical copy they use
 * (same characters, same colors, same score) — strategically identical to the
 * player. One representative per visible identity is kept.
 */
export function dedupeByVisibleIdentity(
  candidates: PekojanCandidate[],
  cardLookup: Map<string, Card>
): PekojanCandidate[] {
  const seen = new Set<string>();
  const out: PekojanCandidate[] = [];
  for (const cand of candidates) {
    const marks = cand.cardIds
      .map((id) => {
        const c = cardLookup.get(id);
        return c ? `${c.characterId}:${c.color}` : id;
      })
      .sort()
      .join("|");
    const sig = `${cand.type}|${cand.groupId ?? ""}|${marks}`;
    if (!seen.has(sig)) {
      seen.add(sig);
      out.push(cand);
    }
  }
  return out;
}
