import { describe, expect, it } from "vitest";
import { createGame, reduce } from "../src/game/engine";
import { createGame as create } from "../src/game/engine";
import { aiDecide } from "../src/ai";
import { validateInvariants } from "../src/game/invariants";
import type { GameAction } from "../src/game/types";
import {
  unseenCopies,
  unseenTotal,
  unknownCopies,
  availableCopies,
  drawHitProbability,
  expertDiscardRisk,
} from "../src/ai/expert";
import { findValidPekojans } from "../src/game/hands";
import { buildPublicContext } from "../src/ai/evaluator";

/** Drive a full expert-only match. */
function playFull(seed: string): { endReason: string | null; turns: number } {
  let state = create({ seed, aiDifficulty: "expert" });
  let guard = 0;
  while (state.phase !== "GAME_OVER" && guard++ < 30000) {
    const who = state.awaitingClaims[0] ?? state.currentPlayer;
    const dec = aiDecide(state, who);
    const phase = state.phase as string;
    const action: GameAction = dec
      ? dec.action
      : phase === "SELF_PEKOJAN_DECISION"
        ? ({ type: "PASS_PEKOJAN", playerId: who } as GameAction)
        : phase === "DISCARDING"
          ? ({ type: "DISCARD", playerId: who, cardId: state.players[who].hand[0].id } as GameAction)
          : ({ type: "PASS_CLAIM", playerId: who } as GameAction);
    state = reduce(state, action);
    const inv = validateInvariants(state);
    expect(inv.errors, `${seed}: ${inv.errors.join("; ")}`).toEqual([]);
  }
  return { endReason: state.endReason, turns: state.turnNumber };
}

describe("expert card counting", () => {
  it("counts unseen copies from public information", () => {
    const g = createGame({ seed: "COUNT-1" });
    const ctx = buildPublicContext(g, 0);
    // fresh game: nothing public yet → all 3 copies of every color unseen
    expect(unseenCopies(ctx, g.groups[0].characterIds[0], "pink")).toBe(3);
    expect(unseenTotal(ctx, g.groups[0].characterIds[0])).toBe(9);
    // my own hand is excluded from "unknown" (what others could hold)
    const mine = g.players[0].hand.filter((c) => c.characterId === g.groups[0].characterIds[0]).length;
    expect(unknownCopies(ctx, g.players[0].hand, g.groups[0].characterIds[0])).toBe(9 - mine);
  });

  it("draw probability behaves monotonically", () => {
    expect(drawHitProbability(0, 50, 10)).toBe(0);
    expect(drawHitProbability(3, 50, 10)).toBeGreaterThan(drawHitProbability(1, 50, 10));
    expect(drawHitProbability(3, 50, 10)).toBeLessThan(drawHitProbability(3, 50, 40));
    expect(drawHitProbability(100, 10, 5)).toBe(1);
  });

  it("discard risk is a probability that actually discriminates", () => {
    // Regression guard: risk used to be an unbounded SUM clamped at 0.85, so it
    // sat on the ceiling for almost every card and carried no information.
    const g = createGame({ seed: "RISK-1" });
    const ctx = buildPublicContext(g, 0);
    const risks = g.players[0].hand.map((c) => expertDiscardRisk(g, ctx, c));
    for (const r of risks) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
    // it must separate safe cards from dangerous ones, not saturate
    expect(Math.max(...risks) - Math.min(...risks)).toBeGreaterThan(0.05);
  });

  it("availability is discounted by the 100-card rule (§5)", () => {
    const g = createGame({ seed: "COUNT-1" });
    const ctx = buildPublicContext(g, 0);
    const charId = g.groups[0].characterIds[0];
    // only 100 of the 126-153 theoretical cards enter a match, so a card nobody
    // has seen is NOT necessarily available to draw
    expect(ctx.theoreticalPool).toBeGreaterThanOrEqual(126);
    expect(ctx.theoreticalPool).toBeLessThanOrEqual(153);
    expect(ctx.inPlayRatio).toBeGreaterThan(0);
    expect(ctx.inPlayRatio).toBeLessThan(1);
    const hand = g.players[0].hand;
    expect(availableCopies(ctx, hand, charId)).toBeLessThan(unknownCopies(ctx, hand, charId));
    // probabilities must be measured against everything we cannot see, not the
    // deck alone (opponents' hands hold cards too)
    expect(ctx.unknownPool).toBeGreaterThan(ctx.deckRemaining);
  });

  it("claims a discard instead of hoarding a speculative hand", () => {
    // Regression guard: the claim threshold used to be compared against a
    // single card's 12-draw keep-value, so the expert declined ~90% of claims.
    let state = createGame({ seed: "exp-claims", aiDifficulty: "expert" , humanSeats: [] });
    let guard = 0;
    let offered = 0;
    let claimed = 0;
    while (state.phase !== "GAME_OVER" && guard++ < 20000) {
      const who = state.awaitingClaims[0] ?? state.currentPlayer;
      const dec = aiDecide(state, who);
      if (state.phase === "DISCARD_CLAIM_WINDOW" && state.awaitingClaims.includes(who)) {
        const d = state.players[state.discarderId]?.discards.at(-1);
        const cands = d
          ? findValidPekojans(state.players[who].hand, state.groups, state.bonusCharacterId, d).filter((c) =>
              c.cardIds.includes(d.id)
            )
          : [];
        if (cands.length > 0) {
          offered++;
          if (dec?.action.type === "CLAIM_DISCARD") claimed++;
        }
      }
      const phase = state.phase as string;
      const action: GameAction = dec
        ? dec.action
        : phase === "SELF_PEKOJAN_DECISION"
          ? ({ type: "PASS_PEKOJAN", playerId: who } as GameAction)
          : phase === "DISCARDING"
            ? ({ type: "DISCARD", playerId: who, cardId: state.players[who].hand[0].id } as GameAction)
            : ({ type: "PASS_CLAIM", playerId: who } as GameAction);
      state = reduce(state, action);
    }
    expect(offered).toBeGreaterThan(0);
    expect(claimed / offered).toBeGreaterThan(0.5);
  }, 60000);
});

describe("expert full matches", () => {
  /** Drive a 1-human + 3-AI match; humans play like the store proxy. */
  function playVsHumans(seed: string): { steals: number; turns: number } {
    let state = createGame({ seed, aiDifficulty: "expert", humanSeats: [0] });
    let steals = 0;
    let guard = 0;
    while (state.phase !== "GAME_OVER" && guard++ < 30000) {
      const who = state.awaitingClaims[0] ?? state.currentPlayer;
      const p = state.players[who];
      const phase = state.phase as string;
      const action: GameAction =
        phase === "DISCARDING" && p.isHuman
          ? { type: "DISCARD", playerId: who, cardId: p.hand[0].id }
          : phase === "SELF_PEKOJAN_DECISION" && p.isHuman
            ? { type: "PASS_PEKOJAN", playerId: who }
            : (() => {
                const dec = aiDecide(state, who);
                return dec ? dec.action : ({ type: "PASS_CLAIM", playerId: who } as GameAction);
              })();
      const meldsBefore = state.players.flatMap((pl) => pl.melds).length;
      state = reduce(state, action);
      const inv = validateInvariants(state);
      expect(inv.errors, `${seed}: ${inv.errors.join("; ")}`).toEqual([]);
      for (const m of state.players.flatMap((pl) => pl.melds).slice(meldsBefore)) {
        if (m.claim === "discard" && m.payerPlayerId === 0) steals++;
      }
    }
    return { steals, turns: state.turnNumber };
  }

  it("AI steals discards from a human player (discard-claim path works vs humans)", () => {
    // seeds verified to produce AI discard-claims against the human seat
    for (const seed of ["STEAL-0", "STEAL-4", "STEAL-8"]) {
      const r = playVsHumans(seed);
      expect(r.steals, `${seed}: AI never claimed the human's discard`).toBeGreaterThan(0);
    }
  }, 120000);

  it("completes games across seeds with valid invariants", () => {
    for (const seed of ["exp-1", "exp-2", "exp-3"]) {
      const r = playFull(seed);
      expect(["zero-score", "deck-exhausted"]).toContain(r.endReason);
    }
  }, 120000);

  it("is deterministic per seed", () => {
    const run = () => {
      let state = create({ seed: "exp-det", aiDifficulty: "expert" });
      const notes: string[] = [];
      let guard = 0;
      while (state.phase !== "GAME_OVER" && guard++ < 5000) {
        const who = state.awaitingClaims[0] ?? state.currentPlayer;
        const dec = aiDecide(state, who);
        if (dec) notes.push(dec.evalNote ?? "");
        const phase = state.phase as string;
        const action: GameAction = dec
          ? dec.action
          : phase === "SELF_PEKOJAN_DECISION"
            ? ({ type: "PASS_PEKOJAN", playerId: who } as GameAction)
            : phase === "DISCARDING"
              ? ({ type: "DISCARD", playerId: who, cardId: state.players[who].hand[0].id } as GameAction)
              : ({ type: "PASS_CLAIM", playerId: who } as GameAction);
        state = reduce(state, action);
      }
      return JSON.stringify({ notes, scores: state.players.map((p) => p.score) });
    };
    expect(run()).toBe(run());
  }, 120000);
});
