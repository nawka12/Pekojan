import type { GameState } from "../game/types";

/** The human who owes the next decision, if any (hot-seat gating). */
export function pendingHumanActor(s: GameState | null): number | null {
  if (!s || s.phase === "GAME_OVER") return null;
  if (
    (s.phase === "SELF_PEKOJAN_DECISION" || s.phase === "DISCARDING") &&
    s.players[s.currentPlayer].isHuman
  ) {
    return s.currentPlayer;
  }
  if (s.phase === "DISCARD_CLAIM_WINDOW") {
    const claimant = s.awaitingClaims.find((id) => s.players[id].isHuman);
    if (claimant !== undefined) return claimant;
  }
  return null;
}
