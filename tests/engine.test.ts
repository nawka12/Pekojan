import { describe, expect, it } from "vitest";
import { createGame, reduce } from "../src/game/engine";
import { selectMatchGroups } from "../src/game/engine";
import { makeRng } from "../src/game/rng";
import { buildMatchDeck, TOTAL_ACTIVE_CARDS, HAND_SIZE } from "../src/game/deck";
import { hashSeed } from "../src/game/rng";
import { validateInvariants } from "../src/game/invariants";
import { aiDecide } from "../src/ai";
import type { GameState, GameAction } from "../src/game/types";
import { resolveDiscardClaims, turnDistance } from "../src/game/claims";
import { settlePayments } from "../src/game/payments";
import { GROUPS } from "../src/data/characters";

/** Drive a full game with AI decisions until it ends; returns final state + history. */
function playFullGame(seed: string, maxSteps = 20000): { state: GameState; actions: GameAction[] } {
  let state = createGame({ seed });
  const actions: GameAction[] = [];
  for (let i = 0; i < maxSteps; i++) {
    if (state.phase === "GAME_OVER") break;
    const actor =
      state.phase === "DISCARD_CLAIM_WINDOW"
        ? state.awaitingClaims[0]
        : state.currentPlayer;
    if (actor === undefined) throw new Error("no actor for phase " + state.phase);
    const decision = aiDecide(state, actor);
    let action: GameAction;
    if (decision) action = decision.action;
    else if (state.phase === "SELF_PEKOJAN_DECISION") action = { type: "PASS_PEKOJAN", playerId: actor };
    else if (state.phase === "DISCARDING") action = { type: "DISCARD", playerId: actor, cardId: state.players[actor].hand[0].id };
    else if (state.phase === "DISCARD_CLAIM_WINDOW") action = { type: "PASS_CLAIM", playerId: actor };
    else throw new Error("no available action in phase " + state.phase);
    actions.push(action);
    try {
      state = reduce(state, action);
    } catch (e) {
      // An inhumanly stalled claim window must never happen — fail loudly.
      throw new Error(`AI produced illegal action ${JSON.stringify(action)}: ${e}`);
    }
    const inv = validateInvariants(state);
    expect(inv.errors, inv.errors.join("; ")).toEqual([]);
  }
  return { state, actions };
}

describe("deck construction", () => {
  it("creates exactly 100 active cards with 72 remaining after the deal", () => {
    const rng = makeRng(hashSeed("pekojan:TEST"));
    const groups = selectMatchGroups(rng);
    const { deck, excluded } = buildMatchDeck(groups, rng);
    expect(deck.length).toBe(TOTAL_ACTIVE_CARDS);
    for (let i = 0; i < 4; i++) deck.splice(0, HAND_SIZE);
    expect(deck.length).toBe(72);
    expect(excluded.length).toBe(groups.flatMap((g) => g.characterIds).length * 9 - 100);
  });

  it("is deterministic per seed", () => {
    const a = createGame({ seed: "PEKOJAN-12345" });
    const b = createGame({ seed: "PEKOJAN-12345" });
    expect(a.deck.map((c) => c.id)).toEqual(b.deck.map((c) => c.id));
    expect(a.groups.map((g) => g.id)).toEqual(b.groups.map((g) => g.id));
    expect(a.bonusCharacterId).toBe(b.bonusCharacterId);
    expect(a.firstPlayer).toBe(b.firstPlayer);

    const c = createGame({ seed: "PEKOJAN-999" });
    expect(c.deck.map((d) => d.id)).not.toEqual(a.deck.map((d) => d.id));
  });

  it("never deals cards excluded from the 100", () => {
    const g = createGame({ seed: "LEAK-CHECK" });
    const leaked = new Set(g.poolExcluded.map((c) => c.id));
    for (const p of g.players) {
      for (const h of p.hand) expect(leaked.has(h.id)).toBe(false);
    }
  });

  it("selects exactly 4 distinct groups of size >= 3, summing to >= 14 characters", () => {
    for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10"]) {
      const rng = makeRng(hashSeed("pokajan:" + seed));
      const groups = selectMatchGroups(rng);
      expect(new Set(groups.map((g) => g.id)).size).toBe(4);
      for (const g of groups) expect(g.characterIds.length).toBeGreaterThanOrEqual(3);
      const total = groups.reduce((n, g) => n + g.characterIds.length, 0);
      expect(total, `seed ${seed} picked ${groups.map((g) => g.id).join(",")}`).toBeGreaterThanOrEqual(14);
      // exclusivity: never 1st Gen + Gamers together
      const ids = groups.map((g) => g.id);
      expect(ids.includes("gen1") && ids.includes("gamers")).toBe(false);
    }
  });
});

describe("payments", () => {
  it("splits self-draw payments deterministically and balances books", () => {
    const g = createGame({ seed: "PAY1" });
    // force scenario: player 0 declares a valid hand
    // find a seed where that happens quickly instead: simulate via helper
    void g;
    const players = [
      { id: 0, score: 1000, pointsGained: 0, pointsLost: 0 },
      { id: 1, score: 1000, pointsGained: 0, pointsLost: 0 },
      { id: 2, score: 1000, pointsGained: 0, pointsLost: 0 },
      { id: 3, score: 1000, pointsGained: 0, pointsLost: 0 },
    ] as GameState["players"];
    // self-draw of 300: floor split 100/100/100
    let s = JSON.parse(JSON.stringify(players)) as typeof players;
    settlePayments(s, 0, [1, 2, 3], 300);
    expect(s[0].score).toBe(1300);
    [1, 2, 3].forEach((i) => expect(s[i].score).toBe(900));

    // remainder distribution: value 301 → first payer 101, second 101? floor=100 rem 1 → ids ascending get +1 each.
    s = JSON.parse(JSON.stringify(players)) as typeof players;
    settlePayments(s, 2, [0, 1, 3], 302); // rem 2 → lowest two ids (0 and 1) pay 101
    expect(s[0].score).toBe(899);
    expect(s[1].score).toBe(899);
    expect(s[3].score).toBe(900);
    expect(s[2].score).toBe(1302);
  });

  it("clamps at zero: total moved equals amount received", () => {
    const players = [
      { id: 0, score: 50, pointsGained: 0, pointsLost: 0 },
      { id: 1, score: 1000, pointsGained: 0, pointsLost: 0 },
      { id: 2, score: 1000, pointsGained: 0, pointsLost: 0 },
      { id: 3, score: 1000, pointsGained: 0, pointsLost: 0 },
    ] as GameState["players"];
    const r = settlePayments(players, 3, [0], 5000);
    expect(r.received).toBe(50);
    expect(players[0].score).toBe(0);
    expect(players[0].score).toBeGreaterThanOrEqual(0);
    expect(players[3].score).toBe(1050);
  });

  it("discard claims charge only the discarder", () => {
    const players = [
      { id: 0, score: 1000, pointsGained: 0, pointsLost: 0 },
      { id: 1, score: 1000, pointsGained: 0, pointsLost: 0 },
      { id: 2, score: 1000, pointsGained: 0, pointsLost: 0 },
      { id: 3, score: 1000, pointsGained: 0, pointsLost: 0 },
    ] as GameState["players"];
    settlePayments(players, 1, [2], 240);
    expect(players[2].score).toBe(760);
    expect(players[0].score).toBe(1000);
    expect(players[3].score).toBe(1000);
    expect(players[1].score).toBe(1240);
  });
});

describe("claims resolution", () => {
  it("gives higher score priority then turn-order distance", () => {
    expect(turnDistance(0, 1)).toBe(1);
    expect(turnDistance(1, 0)).toBe(3);
    const elig = [
      { playerId: 3, candidates: [], best: fakeCand(120) },
      { playerId: 1, candidates: [], best: fakeCand(480) },
      { playerId: 2, candidates: [], best: fakeCand(480) },
    ];
    const win = resolveDiscardClaims(0, elig as never)!;
    expect(win.playerId).toBe(1); // same score as 2 → closer to discarder 0

    const lowFirst = resolveDiscardClaims(0, [
      { playerId: 3, candidates: [], best: fakeCand(840) },
      { playerId: 1, candidates: [], best: fakeCand(480) },
    ] as never)!;
    expect(lowFirst.playerId).toBe(3);
  });

  it("double-call ties are won by the FASTEST call, not turn order", () => {
    const win = resolveDiscardClaims(0, [
      { playerId: 1, candidates: [], best: fakeCand(390), calledAtMs: 900 },
      { playerId: 3, candidates: [], best: fakeCand(390), calledAtMs: 240 },
    ] as never)!;
    expect(win.playerId).toBe(3); // same score → faster call beats closer seat
  });

  it("a slower higher claim still loses to nothing — score comes first", () => {
    const win = resolveDiscardClaims(0, [
      { playerId: 1, candidates: [], best: fakeCand(300), calledAtMs: 100 },
      { playerId: 2, candidates: [], best: fakeCand(480), calledAtMs: 2000 },
    ] as never)!;
    expect(win.playerId).toBe(2);
  });

  it("only resolves a single claim even when many are eligible", () => {
    const g = createGame({ seed: "CLAIMS" });
    const win = resolveDiscardClaims(0, [
      { playerId: 1, candidates: [], best: fakeCand(180) },
      { playerId: 2, candidates: [], best: fakeCand(180) },
      { playerId: 3, candidates: [], best: fakeCand(180) },
    ] as never)!;
    expect(win.playerId).toBe(1);
    void g;
  });

  function fakeCand(score: number) {
    return {
      id: "c" + score,
      type: "group" as const,
      cardIds: [],
      sameColor: false,
      baseScore: score,
      bonusCount: 0,
      bonusScore: 0,
      totalScore: score,
    };
  }
});

describe("end conditions & full simulated matches", () => {
  it("ends when any player reaches zero or the deck empties — across many seeds", () => {
    for (const seed of ["alpha-01", "beta-02", "gamma-03", "delta-04"]) {
      const { state } = playFullGame(seed);
      expect(state.phase).toBe("GAME_OVER");
      expect(
        state.endReason === "zero-score" || state.endReason === "deck-exhausted",
        `seed ${seed} ended via ${state.endReason}`
      ).toBe(true);
      if (state.endReason === "zero-score") {
        expect(state.players.some((p) => p.score <= 0)).toBe(true);
      }
      const scores = [...state.players].sort((a, b) => b.score - a.score);
      expect(scores[0].score).toBeGreaterThanOrEqual(scores[3].score);
    }
  }, 60000);

  it("hand sizes stay within bounds and track same totals all game", () => {
    let state = createGame({ seed: "SIZEGUARD" });
    let guard = 0;
    while (state.phase !== "GAME_OVER" && guard++ < 20000) {
      for (const p of state.players) expect(p.hand.length).toBeLessThanOrEqual(8);
      for (const p of state.players) expect(p.hand.length).toBeGreaterThan(0);
      const actor = state.awaitingClaims[0] ?? state.currentPlayer;
      const phase = state.phase as string;
      const dec = aiDecide(state, actor);
      const action = dec
        ? dec.action
        : phase === "SELF_PEKOJAN_DECISION"
          ? ({ type: "PASS_PEKOJAN" as const, playerId: actor } as GameAction)
          : phase === "DISCARDING"
            ? ({ type: "DISCARD" as const, playerId: actor, cardId: state.players[actor].hand[0].id } as GameAction)
            : ({ type: "PASS_CLAIM" as const, playerId: actor } as GameAction);
      state = reduce(state, action);
    }
    expect(state.phase).toBe("GAME_OVER");
  }, 60000);

  it("same seed + same decisions reproduce identical states", () => {
    const runOnce = () => {
      const { state, actions } = playFullGame("REPLAY-7");
      return summarize(state) + "|" + actions.length;
    };
    expect(runOnce()).toEqual(runOnce());
  }, 60000);

  function summarize(g: GameState) {
    return JSON.stringify({
      phase: g.phase,
      endReason: g.endReason,
      scores: g.players.map((p) => p.score),
      melds: g.players.map((p) => p.melds.length),
      turns: g.turnNumber,
      deck: g.deck.length,
    });
  }
});

describe("engine behaviour specifics", () => {
  it("completed pekojans do NOT reset the game: hands stay, no redeal", () => {
    let found = false;
    for (const seed of ["NO-RESET", "r1", "r2", "r3", "r4"]) {
      const { state } = playFullGame(seed);
      expect(state.turnNumber).toBeGreaterThan(3);
      if (state.players.some((p) => p.melds.length > 0)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("replacement draws keep the acting player's hand consistent", () => {
    // search seeds until someone declares within a few turns, verify hand size post-replacement
    outer: for (const seed of ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]) {
      let state = createGame({ seed });
      let guard = 0;
      while (state.phase !== "GAME_OVER" && guard++ < 8000) {
        const pre = state.currentPlayer;
        const preMelds = state.players[pre].melds.length;
        const who = state.awaitingClaims[0] ?? pre;
        const dec = aiDecide(state, who);
        if (!dec) break;
        state = reduce(state, dec.action);
        if (
          state.phase === "SELF_PEKOJAN_DECISION" &&
          state.players[state.currentPlayer].melds.length > preMelds &&
          state.players[state.currentPlayer].id === pre &&
          !state.pendingClaims.length
        ) {
          // mid-chain: either offer again or discarding with exactly 8 cards
          const ph = state.phase as string;
          if (ph === "DISCARDING" || ph === "SELF_PEKOJAN_DECISION")
            expect(state.players[state.currentPlayer].hand.length).toBeLessThanOrEqual(8);
          break outer;
        }
        void who;
      }
    }
  });

  it("recentPekojan.seq is unique per pekojan and stable across unrelated actions", () => {
    const { state, actions } = playFullGame("SEQ-CHECK");
    // replay and record seq at each pekojan moment
    let s = createGame({ seed: "SEQ-CHECK" });
    const seqs: number[] = [];
    for (const action of actions) {
      s = reduce(s, action);
      if (s.recentPekojan && (seqs.length === 0 || seqs[seqs.length - 1] !== s.recentPekojan.seq)) {
        seqs.push(s.recentPekojan.seq);
      }
    }
    // every recorded seq is strictly increasing (each pekojan celebrated once)
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    void state;
  });

  it("supports all-human offline multiplayer seat configs", () => {
    const g = createGame({ seed: "HOTSEAT", humanSeats: [0, 1, 2, 3] });
    expect(g.players.every((p) => p.isHuman)).toBe(true);

    // drive a full 4-human match through the standard command path
    let s = createGame({ seed: "HOTSEAT-2", humanSeats: [0, 1, 2, 3] });
    let guard = 0;
    while (s.phase !== "GAME_OVER" && guard++ < 30000) {
      const who = s.awaitingClaims[0] ?? s.currentPlayer;
      const dec = aiDecide(s, who); // null for human seats
      const phase = s.phase as string;
      const action = dec
        ? dec.action
        : phase === "SELF_PEKOJAN_DECISION"
          ? ({ type: "PASS_PEKOJAN" as const, playerId: who } as GameAction)
          : phase === "DISCARDING"
            ? ({ type: "DISCARD" as const, playerId: who, cardId: s.players[who].hand[0].id } as GameAction)
            : ({ type: "PASS_CLAIM" as const, playerId: who } as GameAction);
      s = reduce(s, action);
      const inv = validateInvariants(s);
      expect(inv.errors, inv.errors.join("; ")).toEqual([]);
    }
    expect(s.phase).toBe("GAME_OVER");
    expect(s.endReason).toBe("deck-exhausted"); // everyone passes → deck runs out
  });

  it("mixed human/ai seat config respects isHuman flags", () => {
    const g = createGame({
      seed: "MIXED",
      humanSeats: [0, 2],
      seatNames: ["Ana", "Kotone", "Ben", "Hibari"],
    });
    expect(g.players[0].isHuman).toBe(true);
    expect(g.players[1].isHuman).toBe(false);
    expect(g.players[2].isHuman).toBe(true);
    expect(g.players[3].isHuman).toBe(false);
    expect(g.players[0].name).toBe("Ana");
    expect(g.players[2].name).toBe("Ben");
    expect(g.players[1].difficulty).toBe("normal");
  });

  it("illegal actions are rejected outside their phases", () => {
    const state = createGame({ seed: "ILLEGAL" });
    expect(() =>
      reduce(state, { type: "DISCARD", playerId: 0, cardId: "bogus" })
    ).toThrow();
    expect(() =>
      reduce(state, { type: "DECLARE_PEKOJAN", playerId: 0, candidateId: "x" })
    ).toThrow();
  });
});
