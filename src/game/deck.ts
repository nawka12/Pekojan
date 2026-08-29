import type { Card, CardColor, Group } from "./types";
import type { RngSource } from "./rng";
import { shuffled } from "./rng";

export const CARD_COLORS: CardColor[] = ["pink", "blue", "orange"];
export const COPIES_PER_COLOR = 3;
export const TOTAL_ACTIVE_CARDS = 100;
export const HAND_SIZE = 7;
export const PLAYER_COUNT = 4;

/** Generate every theoretical card for the given groups. */
export function generateTheoreticalPool(groups: Group[]): Card[] {
  const pool: Card[] = [];
  for (const g of groups) {
    for (const charId of g.characterIds) {
      for (const color of CARD_COLORS) {
        for (let n = 0; n < COPIES_PER_COLOR; n++) {
          pool.push({
            id: `${g.id}-${charId}-${color}-${n}`,
            characterId: charId,
            groupId: g.id,
            color,
          });
        }
      }
    }
  }
  return pool;
}

/**
 * The 100-card rule:
 * generate everything, shuffle, keep exactly `TOTAL_ACTIVE_CARDS`,
 * shuffle what remains. Excluded cards never exist during the match.
 */
export function buildMatchDeck(
  groups: Group[],
  rng: RngSource
): { deck: Card[]; excluded: Card[] } {
  const all = shuffled(generateTheoreticalPool(groups), rng);
  const active = all.slice(0, TOTAL_ACTIVE_CARDS);
  const excluded = all.slice(TOTAL_ACTIVE_CARDS);
  const deck = shuffled(active, rng); // already shuffled as slice of a shuffle,
                                             // re-shuffle keeps intent explicit
  return { deck, excluded };
}

export function drawCards(deck: Card[], count: number): Card[] {
  if (deck.length < count) throw new Error("deck exhausted");
  return deck.splice(0, count);
}
