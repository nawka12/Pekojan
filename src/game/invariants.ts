import type { Card, GameState } from "./types";

// ---------------------------------------------------------------------------
// Validation invariants (rule doc §45).
// ---------------------------------------------------------------------------

export interface InvariantReport {
  ok: boolean;
  errors: string[];
}

export function validateInvariants(state: GameState): InvariantReport {
  const errors: string[] = [];
  const seen = new Map<string, string>();

  const where = (loc: string) => loc;
  const put = (card: { id: string }, loc: string) => {
    if (seen.has(card.id)) {
      errors.push(`card ${card.id} exists both in ${seen.get(card.id)} and ${where(loc)}`);
    }
    seen.set(card.id, loc);
  };

  state.deck.forEach((c) => put(c, "deck"));
  state.players.forEach((p) => {
    p.hand.forEach((c) => put(c, `hand:${p.id}`));
    p.discards.forEach((c) => put(c, `discards:${p.id}`));
    p.melds.forEach((m) => m.cards.forEach((c) => put(c, `melds:${p.id}`)));
  });

  // Excluded cards must never appear anywhere.
  const excludedIds = new Set(state.poolExcluded.map((c) => c.id));
  for (const id of seen.keys()) {
    if (excludedIds.has(id)) errors.push(`excluded card ${id} leaked into play`);
  }

  if (state.phase === "SETUP" || state.phase === "DEALING") return { ok: errors.length === 0, errors };
  if (seen.size !== 100) errors.push(`active card count = ${seen.size}, expected 100`);

  state.players.forEach((p) => {
    if (p.score < 0) errors.push(`player ${p.id} score below zero`);
    const normalSize = p.hand.length;
    if (normalSize > HAND_MAX + 1) errors.push(`player ${p.id} holds ${p.hand.length} cards`);
  });

  // Only current player may be mid-decision
  if (
    (state.phase === "DISCARDING" || state.phase === "SELF_PEKOJAN_DECISION") &&
    !state.players[state.currentPlayer]
  ) {
    errors.push("currentPlayer out of range");
  }

  const activeTotal =
    state.deck.length +
    state.players.reduce((n, p) => n + p.hand.length + p.discards.length + p.melds.reduce((m, x) => m + x.cards.length, 0), 0);
  if (activeTotal !== 100 && state.phase !== "GAME_OVER") {
    errors.push(`non-terminal active total = ${activeTotal}`);
  }

  return { ok: errors.length === 0, errors };
}

const HAND_MAX = 8;

export function cardAvailability(state: GameState, viewerId: number): Map<string, Record<"pink" | "blue" | "orange", number>> {
  // Publicly seen = discards + melds + viewer's own hand.
  const map = new Map<string, Record<"pink" | "blue" | "orange", number>>();
  const bump = (characterId: string, color: Card["color"]) => {
    let row = map.get(characterId);
    if (!row) {
      row = { pink: 0, blue: 0, orange: 0 };
      map.set(characterId, row);
    }
    row[color]++;
  };
  for (const p of state.players) {
    for (const d of p.discards) bump(d.characterId, d.color);
    for (const meld of p.melds) for (const c of meld.cards) bump(c.characterId, c.color);
  }
  for (const c of state.players[viewerId].hand) bump(c.characterId, c.color);
  return map;
}
