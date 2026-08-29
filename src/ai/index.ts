import type { Card, Difficulty, GameAction, GameState } from "../game/types";
import { findValidPekojans } from "../game/hands";
import { hashSeed, makeRng, randomInt } from "../game/rng";
import { buildPublicContext, claimAppeal, keepValue } from "./evaluator";
import { expertClaim, expertDiscard, expertDiscardRisk, expertSelfPekojan } from "./expert";

// ---------------------------------------------------------------------------
// AI opponents.
//
// AI decisions are emitted as the same GameAction commands humans dispatch,
// so they are recorded in replays. Randomness derives deterministically from
// seed + decisionCounter (rule doc §30) and never touches hidden information.
// ---------------------------------------------------------------------------

export interface AiDecision {
  action: GameAction;
  /** debug info for the overlay */
  evalNote?: string;
}

function rngFor(state: GameState): ReturnType<typeof makeRng> {
  return makeRng(hashSeed(`ai:${state.seed}:${state.decisionCounter}`));
}

/** Returns the next action the AI seated at `playerId` wants to take, or null if it's not that player's decision moment. */
export function aiDecide(state: GameState, playerId: number): AiDecision | null {
  const player = state.players[playerId];
  // Defense in depth: AI never acts for a human seat.
  if (player.isHuman) return null;
  const difficulty = player.difficulty ?? "normal";
  switch (state.phase) {
    case "SELF_PEKOJAN_DECISION":
      return decideSelfPekojan(state, playerId, difficulty);
    case "DISCARDING":
      return decideDiscard(state, playerId, difficulty);
    case "DISCARD_CLAIM_WINDOW":
      return decideClaim(state, playerId, difficulty);
    default:
      return null;
  }
}

// --- Self Pekojan (declare / pass / chain choice) ---------------------------

function decideSelfPekojan(state: GameState, playerId: number, difficulty: Difficulty): AiDecision | null {
  if (state.currentPlayer !== playerId) return null;
  const hand = state.players[playerId].hand;
  const candidates = findValidPekojans(hand, state.groups, state.bonusCharacterId);
  if (candidates.length === 0) return null;

  if (difficulty === "expert") {
    const d = expertSelfPekojan(state, playerId);
    return d.declare
      ? { action: { type: "DECLARE_PEKOJAN", playerId, candidateId: d.candidateId }, evalNote: d.note }
      : { action: { type: "PASS_PEKOJAN", playerId }, evalNote: d.note };
  }

  // Easy always takes it; Normal/Hard may pass a low-value mixed hand to
  // fish for same-color or bonus upgrades — a meaningful strategic option.
  const best = candidates[0];
  const rng = rngFor(state);
  let takeIt = true;
  if (difficulty !== "easy") {
    const leading = state.players.filter((p) => p.id !== playerId).every((p) => best.totalScore >= p.score - 0 || true);
    void leading;
    if (best.sameColor || best.bonusCount > 0 || best.totalScore >= 300) takeIt = true;
    else if (difficulty === "hard" && state.deck.length > 30 && state.turnNumber < 20) {
      takeIt = rng.next() > 0.12; // occasionally holds out early for a stronger hand
    } else if (difficulty === "normal") {
      takeIt = rng.next() > 0.10; // banking also buys replacements and a chain
    }
  }
  if (takeIt)
    return { action: { type: "DECLARE_PEKOJAN", playerId, candidateId: best.id }, evalNote: `declares ${best.type} ${best.totalScore}` };
  return { action: { type: "PASS_PEKOJAN", playerId }, evalNote: `passes ${best.totalScore} hoping for more` };
}

// --- Discard choice ----------------------------------------------------------

function decideDiscard(state: GameState, playerId: number, difficulty: Difficulty): AiDecision | null {
  if (state.currentPlayer !== playerId) return null;
  const hand = state.players[playerId].hand;
  if (hand.length === 0) return null;

  if (difficulty === "expert") {
    const d = expertDiscard(state, playerId);
    return { action: { type: "DISCARD", playerId, cardId: d.cardId }, evalNote: d.note };
  }

  const ctx = buildPublicContext(state, playerId);

  if (difficulty === "easy") {
    const rng = rngFor(state);
    const card = hand[randomInt(rng, hand.length)];
    return { action: { type: "DISCARD", playerId, cardId: card.id }, evalNote: "random-ish discard" };
  }

  const scoreNow = state.players[playerId].score;
  const rank = [...state.players].sort((a, b) => b.score - a.score).findIndex((p) => p.id === playerId);

  // Feeding a claim is the single most expensive mistake in Pekojan, so every
  // thinking difficulty weighs it — just less sharply than the expert, which is
  // what keeps the ladder monotonic. Normal barely flinches; Hard defends
  // properly but without the expert's opponent modelling.
  const DANGER_WEIGHT = difficulty === "hard" ? 1500 : 900;

  const scored = hand.map((card) => {
    let value = keepValue(card, hand, ctx);
    const danger = expertDiscardRisk(state, ctx, card);
    value -= danger * (rank === 0 ? DANGER_WEIGHT * 1.4 : DANGER_WEIGHT);
    if (difficulty === "hard") {
      // Losing players gamble: keep chase-cards for big hands alive.
      if (rank >= 2) value += card.characterId === ctx.bonusCharacterId ? 18 : 6;
    }
    return { card, value };
  });
  scored.sort((a, b) => b.value - a.value);

  const pick = scored[0]?.card ?? hand[0];
  void scoreNow;
  return {
    action: { type: "DISCARD", playerId, cardId: pick.id },
    evalNote: scored.map((s) => `${short(s.card)}:${Math.round(s.value)}`).join(" "),
  };
}

function short(c: Card): string {
  return `${c.characterId[0].toUpperCase()}${c.color[0]}`;
}

// --- Discard claims -----------------------------------------------------------

function decideClaim(state: GameState, playerId: number, difficulty: Difficulty): AiDecision | null {
  if (!state.awaitingClaims.includes(playerId)) return null;
  const hand = state.players[playerId].hand;
  const discard = state.players[state.discarderId]?.discards.at(-1);
  if (!discard) return null;
  const candidates = findValidPekojans(hand, state.groups, state.bonusCharacterId, discard).filter(
    (c) => c.cardIds.includes(discard.id)
  );
  if (candidates.length === 0) return { action: { type: "PASS_CLAIM", playerId } };

  // Human players handle their own window through UI; guard anyway.
  const player = state.players[playerId];
  if (player.isHuman) return null;

  const ctx = buildPublicContext(state, playerId);
  const best = [...candidates].sort(
    (a, b) => claimAppeal(b, ctx) - claimAppeal(a, ctx) || (a.id < b.id ? -1 : 1)
  )[0];

  // Seeded reaction time: double-calls of EQUAL value are won by speed, exactly
  // like the original game. Sharper opponents call sooner, so the strongest AI
  // wins the races it used to lose — the bands stay human-plausible so a quick
  // player can still beat them to the call.
  const rng = rngFor(state);
  const REACTION: Record<Difficulty, [number, number]> = {
    easy: [900, 1500],
    normal: [650, 1100],
    hard: [450, 800],
    expert: [300, 500],
  };
  const [floorMs, spreadMs] = REACTION[difficulty];
  const calledAtMs = floorMs + rng.next() * spreadMs;

  if (difficulty === "easy") {
    // §26-Easy: takes every Pokajan it NOTICES. A beginner simply misses some
    // claim windows — a perception limit, not a strategy. Without this, "easy"
    // plays the game's strongest line (claim everything) and outperforms the
    // thinking difficulties.
    if (rng.next() < 0.45) {
      return { action: { type: "PASS_CLAIM", playerId }, evalNote: "missed the claim" };
    }
    return { action: { type: "CLAIM_DISCARD", playerId, candidateId: best.id, calledAtMs }, evalNote: "always claims" };
  }

  if (difficulty === "expert") {
    const d = expertClaim(state, playerId, best.id);
    return d.claim
      ? { action: { type: "CLAIM_DISCARD", playerId, candidateId: best.id, calledAtMs }, evalNote: d.note }
      : { action: { type: "PASS_CLAIM", playerId }, evalNote: d.note };
  }

  // Normal/Hard evaluate whether waiting would be worth more than claiming now.
  // The bar is an absolute point value, NOT a multiple of keep-value: claiming
  // costs almost nothing (the rest of the hand stays, spent cards are replaced)
  // so comparing it against speculative hand potential made them decline nearly
  // every claim. Hard holds out for a bit more than Normal, and only early.
  const baseline = bestKeepValue(hand, ctx);
  const appeal = claimAppeal(best, ctx);
  const breakEven = 120;
  if (appeal >= breakEven || best.sameColor || difficulty === "normal") {
    return { action: { type: "CLAIM_DISCARD", playerId, candidateId: best.id, calledAtMs }, evalNote: `claims ${best.totalScore} vs keep≈${baseline}` };
  }
  return { action: { type: "PASS_CLAIM", playerId }, evalNote: `waits (claim=${appeal}, keep≈${baseline})` };
}

function bestKeepValue(hand: Card[], ctx: ReturnType<typeof buildPublicContext>): number {
  return Math.max(...hand.map((c) => keepValue(c, hand, ctx)), 0);
}
