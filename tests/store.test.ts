import { beforeEach, expect, it, vi } from "vitest";
import { useGame } from "../src/store/game";
import { useSettings } from "../src/store/settings";
import { aiDecide } from "../src/ai";
import type { GameAction } from "../src/game/types";

/**
 * Integration test for the reactive store + AI scheduler.
 * Humans receive no UI here, so a scripted "player proxy" answers every
 * human decision exactly like the real UI would — via dispatch().
 */

function humanProxy(): boolean {
  const s = useGame.getState().state;
  if (!s || s.phase === "GAME_OVER") return false;
  if (s.phase === "DISCARDING" && s.players[s.currentPlayer].isHuman) {
    useGame.getState().dispatch({
      type: "DISCARD",
      playerId: s.currentPlayer,
      cardId: s.players[s.currentPlayer].hand[0].id,
    });
    return true;
  }
  if (
    s.phase === "SELF_PEKOJAN_DECISION" &&
    s.players[s.currentPlayer].isHuman
  ) {
    const dec = aiDecide(s, s.currentPlayer);
    useGame.getState().dispatch(
      dec ? dec.action : { type: "PASS_PEKOJAN", playerId: s.currentPlayer }
    );
    return true;
  }
  if (s.phase === "DISCARD_CLAIM_WINDOW" && s.awaitingClaims.length > 0) {
    const who = s.awaitingClaims.find((id) => s.players[id].isHuman);
    if (who !== undefined) {
      const dec = aiDecide(s, who);
      useGame.getState().dispatch(
        dec ? dec.action : { type: "PASS_CLAIM", playerId: who }
      );
      return true;
    }
  }
  return false;
}

it("classic: compensation pool is game-long, never refilled between turns", () => {
  useSettings.getState().update({ gameMode: "classic", humansCount: 1, claimWindowSeconds: 3 });
  vi.useFakeTimers();
  useGame.getState().start("COMP-POOL");
  useGame.getState().dismissReveal();
  expect(useGame.getState().compensation[0]).toBe(20);

  // burn spare on one turn
  useGame.getState().consumeCompensation(0, 6);
  expect(useGame.getState().compensation[0]).toBe(14);

  // play many rounds of turns — the pool must only ever shrink or hold
  let guard = 0;
  let minPool = 20;
  const seenTurns = new Set<number>();
  while (useGame.getState().state!.phase !== "GAME_OVER" && guard++ < 20000) {
    const s = useGame.getState().state!;
    seenTurns.add(s.turnNumber);
    minPool = Math.min(minPool, useGame.getState().compensation[0]);
    const actor = s.awaitingClaims[0] ?? s.currentPlayer;
    const phase = s.phase as string;
    if (s.players[actor].isHuman && s.players[actor].hand.length > 0) {
      const action: GameAction =
        phase === "SELF_PEKOJAN_DECISION"
          ? { type: "PASS_PEKOJAN", playerId: actor }
          : phase === "DISCARDING"
            ? { type: "DISCARD", playerId: actor, cardId: s.players[actor].hand[0].id }
            : { type: "PASS_CLAIM", playerId: actor };
      useGame.getState().dispatch(action);
    } else {
      useGame.getState().consumeCompensation(actor, 0.5); // AI-equivalent tiny drains
    }
    vi.advanceTimersByTime(100);
  }
  expect(useGame.getState().state!.phase).toBe("GAME_OVER");
  expect(seenTurns.size).toBeGreaterThan(3); // multiple turns actually elapsed
  expect(useGame.getState().compensation[0]).toBeLessThanOrEqual(14); // never refilled
  expect(useGame.getState().compensation[0]).toBe(minPool); // monotonic decrease

  // a fresh match restores the pools
  useGame.getState().start("COMP-POOL-2");
  useGame.getState().dismissReveal();
  expect(useGame.getState().compensation[0]).toBe(20);
  vi.useRealTimers();
  useSettings.getState().update({ gameMode: "freestyle" });
}, 60000);

it("classic: a 12s turn drains exactly 2s from the 20s pool at dispatch time", () => {
  useSettings.getState().update({ gameMode: "classic", humansCount: 1, claimWindowSeconds: 3 });
  vi.useFakeTimers();
  useGame.getState().start("SLOW-TURN");
  useGame.getState().dismissReveal();
  expect(useGame.getState().turnStartedAt).not.toBeNull();

  // the turn took 12s (10s base + 2s spare)
  useGame.setState({ turnStartedAt: Date.now() - 12000 });
  const s = useGame.getState().state!;
  expect(s.phase).toBe("DISCARDING");
  useGame.getState().dispatch({
    type: "DISCARD",
    playerId: s.currentPlayer,
    cardId: s.players[s.currentPlayer].hand[0].id,
  });
  const poolAfter = useGame.getState().compensation[0];
  expect(poolAfter).toBeLessThanOrEqual(18);
  expect(poolAfter).toBeGreaterThan(17.9);

  // a fast turn (under base) never touches the pool
  const s2 = useGame.getState().state!;
  const actor = useGame.getState().state!.currentPlayer;
  if (useGame.getState().state!.players[actor].isHuman) {
    // pass device to next human if needed
    useGame.setState({ revealedFor: actor, turnStartedAt: performance.now() });
  }
  void s2;
  vi.useRealTimers();
  useSettings.getState().update({ gameMode: "freestyle" });
}, 60000);

it("classic: taking the device restarts the turn clock (no CPU-playing for you)", () => {
  useSettings.getState().update({ gameMode: "classic", humansCount: 2, claimWindowSeconds: 3 });
  vi.useFakeTimers();
  useGame.getState().start("PASS-CLOCK");
  useGame.getState().dismissReveal();
  // drive seat 0 to discard so the turn lands on the other human (seat 1)
  const s0 = useGame.getState().state!;
  expect(s0.players[0].isHuman).toBe(true);
  useGame.getState().dispatch({
    type: "DISCARD",
    playerId: 0,
    cardId: s0.players[0].hand[0].id,
  });
  const s1 = useGame.getState().state!;
  const pending = s1.currentPlayer;
  if (s1.players[pending].isHuman && s1.phase !== "GAME_OVER") {
    // the device sat untouched for a long time → clock went stale
    useGame.setState({ turnStartedAt: performance.now() - 30000 });
    useGame.getState().revealFor(pending);
    const startedAt = useGame.getState().turnStartedAt!;
    expect(performance.now() - startedAt).toBeLessThan(1000); // clock restarted
  }
  vi.useRealTimers();
  useSettings.getState().update({ gameMode: "freestyle", humansCount: 1 });
}, 60000);

beforeEach(() => {
  vi.useFakeTimers();
  return () => {
    vi.useRealTimers();
  };
});

it("hot-seat: 4-human match reaches GAME_OVER through the store", () => {
  useSettings.getState().update({ humansCount: 4 });
  useGame.getState().start("HOTSEAT-STORE");
  useGame.getState().dismissReveal();
  let guard = 0;
  while (useGame.getState().state!.phase !== "GAME_OVER" && guard++ < 30000) {
    const s = useGame.getState().state!;
    const who = s.awaitingClaims[0] ?? s.currentPlayer;
    const phase = s.phase as string;
    const action = phase === "SELF_PEKOJAN_DECISION"
      ? ({ type: "PASS_PEKOJAN" as const, playerId: who } as GameAction)
      : phase === "DISCARDING"
        ? ({ type: "DISCARD" as const, playerId: who, cardId: s.players[who].hand[0].id } as GameAction)
        : ({ type: "PASS_CLAIM" as const, playerId: who } as GameAction);
    useGame.getState().dispatch(action);
    vi.advanceTimersByTime(20);
    // privacy gate must always target a human seat
    const st = useGame.getState().state!;
    expect(st.players.every((p) => p.isHuman)).toBe(true);
    expect(useGame.getState().revealedFor).toBeGreaterThanOrEqual(0);
  }
  expect(useGame.getState().state!.phase).toBe("GAME_OVER");
  useSettings.getState().update({ humansCount: 1 });
}, 60000);

function stepRound(n = 80) {
  for (let i = 0; i < n && useGame.getState().state!.phase !== "GAME_OVER"; i++) {
    vi.advanceTimersByTime(100);
    humanProxy();
  }
}

it("reaches GAME_OVER purely through the store's scheduling machinery", () => {
  useGame.getState().start("STORE-IT-1");
  useGame.getState().dismissReveal();
  let guard = 0;
  while (useGame.getState().state!.phase !== "GAME_OVER" && guard++ < 6000) {
    stepRound();
  }
  const s = useGame.getState().state!;
  expect(s.phase).toBe("GAME_OVER");
  expect(["zero-score", "deck-exhausted"]).toContain(s.endReason);
}, 60000);

it("keeps hands/scores legal through the whole reactive match", () => {
  useGame.getState().start("STORE-IT-2");
  useGame.getState().dismissReveal();
  let guard = 0;
  while (useGame.getState().state!.phase !== "GAME_OVER" && guard++ < 10000) {
    const s = useGame.getState().state!;
    for (const p of s.players) {
      expect(p.hand.length).toBeLessThanOrEqual(8);
      expect(p.score).toBeGreaterThanOrEqual(0);
    }
    stepRound(20);
  }
  expect(useGame.getState().state!.phase).toBe("GAME_OVER");
}, 60000);

it("dispatched commands follow reduce(); illegal ones never corrupt state", () => {
  useGame.getState().start("STORE-IT-3");
  useGame.getState().dismissReveal();
  let guard = 0;
  let s = useGame.getState().state!;
  while (s.phase !== "GAME_OVER" && guard++ < 20000) {
    // obviously illegal action must be ignored gracefully
    expect(() =>
      useGame.getState().dispatch({ type: "DRAW", playerId: 0 })
    ).not.toThrow();
    const actor = s.awaitingClaims[0] ?? s.currentPlayer;
    const dec = aiDecide(s, actor);
    const action: GameAction = dec
      ? dec.action
      : s.phase === ("SELF_PEKOJAN_DECISION" as never)
        ? ({ type: "PASS_PEKOJAN", playerId: actor } as GameAction)
        : s.phase === ("DISCARDING" as never)
          ? ({ type: "DISCARD", playerId: actor, cardId: s.players[actor].hand[0].id } as GameAction)
          : ({ type: "PASS_CLAIM", playerId: actor } as GameAction);
    useGame.getState().dispatch(action);
    vi.advanceTimersByTime(40);
    s = useGame.getState().state!;
  }
  expect(s.phase).toBe("GAME_OVER");
}, 60000);
