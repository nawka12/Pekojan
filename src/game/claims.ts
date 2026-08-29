import type { Card, GameState, PendingClaim, PlayerState, PekojanCandidate } from "./types";
import { findValidPekojans } from "./hands";

// ---------------------------------------------------------------------------
// Discard claim resolution (rule doc §16).
// A dedicated resolver — never decided by UI timing.
//
// Priority:
//  1. Highest resulting Pekojan score wins.
//  2. Tie → the claimant closest to the discarder in normal turn order
//     (i.e. smallest clockwise distance after the discarder).
// ---------------------------------------------------------------------------

/** Max clockwise distance from discarder to claimant (1..3). */
export function turnDistance(from: number, to: number): number {
  return (to - from + 4) % 4 || 4;
}

export interface ClaimEligibility {
  playerId: number;
  candidates: PekojanCandidate[];
  best: PekojanCandidate;
  /** ms from discard to call — equal-value double-calls go to the fastest */
  calledAtMs?: number;
}

/**
 * Compute every eligible player's claims for `discard`.
 * The discarder themselves is NEVER eligible.
 */
export function computeClaimEligibility(
  state: GameState,
  discarderId: number,
  discard: Card,
  hands?: Record<number, PlayerState["hand"]>
): ClaimEligibility[] {
  const out: ClaimEligibility[] = [];
  for (const p of state.players) {
    if (p.id === discarderId) continue;
    const hand = hands?.[p.id] ?? p.hand;
    const candidates = findValidPekojans(
      hand,
      state.groups,
      state.bonusCharacterId,
      discard
    ).filter((c) => c.cardIds.includes(discard.id));
    if (candidates.length > 0) {
      out.push({ playerId: p.id, candidates, best: candidates[0] });
    }
  }
  out.sort(
    (a, b) =>
      b.best.totalScore - a.best.totalScore ||
      turnDistance(discarderId, a.playerId) - turnDistance(discarderId, b.playerId)
  );
  return out;
}

/**
 * Resolve multiple simultaneous claims deterministically.
 * Returns a single winning claim or null if there are none.
 */
export function resolveDiscardClaims(
  discarderId: number,
  eligibility: ClaimEligibility[]
): PendingClaim | null {
  if (eligibility.length === 0) return null;
  const winner = [...eligibility].sort(
    (a, b) =>
      b.best.totalScore - a.best.totalScore ||
      (a.calledAtMs ?? Number.POSITIVE_INFINITY) -
        (b.calledAtMs ?? Number.POSITIVE_INFINITY) ||
      turnDistance(discarderId, a.playerId) - turnDistance(discarderId, b.playerId)
  )[0];
  return {
    playerId: winner.playerId,
    candidate: winner.best,
    usesDiscardCardId: "",
  };
}
