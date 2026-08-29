import type { Card, ScoreBreakdown } from "./types";

// ---------------------------------------------------------------------------
// Scoring table — implemented as data (rule doc §12).
// ---------------------------------------------------------------------------

export type HandKind = "triple" | "group";

export interface ScoreRow {
  kind: HandKind;
  groupSize?: number;
  mixed: number;
  sameColor: number;
}

export const SCORING_TABLE: ScoreRow[] = [
  { kind: "triple", mixed: 120, sameColor: 840 },
  { kind: "group", groupSize: 3, mixed: 180, sameColor: 480 },
  { kind: "group", groupSize: 4, mixed: 300, sameColor: 840 },
  { kind: "group", groupSize: 5, mixed: 480, sameColor: 1800 },
];

export const BONUS_PER_CARD = 90;

export function tableScore(kind: HandKind, size: number, sameColor: boolean): number {
  if (kind === "triple") return sameColor ? 840 : 120;
  const row = SCORING_TABLE.find((r) => r.kind === "group" && r.groupSize === size);
  if (!row) throw new Error(`no scoring row for group of ${size}`);
  return sameColor ? row.sameColor : row.mixed;
}

/**
 * Reusable scoring function per rule doc §12.
 * `baseScore` is the value from the scoring table (monochrome premium already
 * included); `colorBonus` reports how much of that came from being same-color
 * so the UI can display it separately. `totalScore` adds bonus-character points.
 */
export function calculatePekojanScore(
  cards: Card[],
  bonusCharacterId: string,
  handType: "three-of-kind" | "group"
): ScoreBreakdown {
  const sameColor = cards.every((c) => c.color === cards[0].color);
  const base = tableScore(
    handType === "group" ? "group" : "triple",
    cards.length,
    sameColor
  );
  const mixedBase =
    handType === "group" ? tableScore("group", cards.length, false) : 120;
  const bonusCount = cards.filter((c) => c.characterId === bonusCharacterId).length;
  const bonus = bonusCount * BONUS_PER_CARD;
  return {
    baseScore: base,
    colorBonus: sameColor ? base - mixedBase : 0,
    bonusCharacterScore: bonus,
    totalScore: base + bonus,
    handType,
    sameColor,
  };
}
