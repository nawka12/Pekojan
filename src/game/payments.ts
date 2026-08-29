import type { PlayerState } from "./types";

// ---------------------------------------------------------------------------
// Payment settlement.
//
// Split policy (documented, deterministic):
//  * Self-draw: each opponent pays floor(total / 3); the remainder
//    (total mod 3) is distributed one-by-one to opponents in ascending
//    player id order — i.e. closest after the winner in turn order.
//  * Clamp: a payer never pays more than their current score. After clamping,
//    the winner receives exactly the sum actually paid — the books always
//    balance (money is transferred, not created).
//  * Scores can reach exactly 0 but never below it.
// ---------------------------------------------------------------------------

export interface PaymentResult {
  paid: { playerId: number; amount: number }[];
  received: number;
}

export function splitThree(total: number): [number, number, number] {
  const base = Math.floor(total / 3);
  const rem = total - base * 3;
  return [base + (rem > 0 ? 1 : 0), base + (rem > 1 ? 1 : 0), base];
}

/**
 * Mutates players' scores: `winnerId` receives value from payers.
 * Returns what was actually moved (post-clamp).
 */
export function settlePayments(
  players: PlayerState[],
  winnerId: number,
  payerIds: number[],
  handValue: number
): PaymentResult {
  let amounts: number[];
  if (payerIds.length === 3) {
    // Self-draw — deterministic split documented above.
    const ordered = [...payerIds].sort((a, b) => a - b);
    amounts = splitThree(handValue);
    const applied = new Map<number, number>();
    ordered.forEach((pid, i) => applied.set(pid, Math.min(amounts[i], players[pid].score)));
    for (const [pid, amt] of applied) {
      players[pid].score -= amt;
      if (amt < amounts[pid]) {
        // unclamped had remainder… nothing further; books balance via received sum
      }
      players[pid].pointsLost += amt;
    }
    const received = [...applied.values()].reduce((a, b) => a + b, 0);
    players[winnerId].score += received;
    players[winnerId].pointsGained += received;
    return {
      paid: [...applied.entries()].map(([playerId, amount]) => ({ playerId, amount })),
      received,
    };
  }

  // Discard claim — the discarding player pays everything (clamped at their score).
  const payerId = payerIds[0];
  const amount = Math.min(handValue, players[payerId].score);
  players[payerId].score -= amount;
  players[payerId].pointsLost += amount;
  players[winnerId].score += amount;
  players[winnerId].pointsGained += amount;
  return { paid: [{ playerId: payerId, amount }], received: amount };
}
