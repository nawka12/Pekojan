import { expect, it, vi } from "vitest";
import React from "react";
import { render, act } from "@testing-library/react";
import { useGame } from "../src/store/game";
import { useSettings } from "../src/store/settings";
import { GameScreen } from "../src/screens/Game";
import { aiDecide } from "../src/ai";

/**
 * Fast-mode full-match smoke test with overlapping celebration overlays:
 * back-to-back Pekojans (AI chains fire while the overlay + point-steal fx
 * are still on screen) must never throw during render and must never leave
 * the React tree crashed. Guards the hand-fan / overlay animation churn
 * against regressions of the "card layout goes everywhere" bug.
 */

class Boundary extends React.Component<{ children?: React.ReactNode; onErr(e: Error): void }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() { if (this.state.err) { this.props.onErr(this.state.err); return null; } return this.props.children; }
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(1);
    await Promise.resolve();
  });
}

it("fast-mode full match with overlapping Pekojan overlays never crashes", async () => {
  useSettings.getState().update({ gameMode: "freestyle", humansCount: 1, animationSpeed: "fast" });
  const errors: Error[] = [];
  let guard = 0;

  const seeds = ["REPRO-A", "REPRO-B", "REPRO-C", "REPRO-D", "REPRO-E", "REPRO-F"];
  for (const seed of seeds) {
    vi.useFakeTimers();
    useGame.getState().start(seed);
    const { unmount } = render(
      <Boundary onErr={(e) => errors.push(e)}><GameScreen /></Boundary>
    );
    useGame.getState().dismissReveal();

    while (useGame.getState().state!.phase !== "GAME_OVER" && guard++ < 6000) {
      await flush();
      const s = useGame.getState().state!;
      // human proxy answers like the real player would
      if (s.phase === "DISCARDING" && s.players[s.currentPlayer].isHuman) {
        useGame.getState().dispatch({ type: "DISCARD", playerId: s.currentPlayer, cardId: s.players[s.currentPlayer].hand[0].id });
        continue;
      }
      if (s.phase === "SELF_PEKOJAN_DECISION" && s.players[s.currentPlayer].isHuman) {
        const dec = aiDecide(s, s.currentPlayer);
        useGame.getState().dispatch(dec ? dec.action : { type: "PASS_PEKOJAN", playerId: s.currentPlayer });
        continue;
      }
      if (s.phase === "DISCARD_CLAIM_WINDOW") {
        const who = s.awaitingClaims.find((id) => s.players[id].isHuman);
        if (who !== undefined) {
          const dec = aiDecide(s, who);
          useGame.getState().dispatch(dec ? dec.action : { type: "PASS_CLAIM", playerId: who });
          continue;
        }
      }
      await act(async () => { vi.advanceTimersByTime(600); });
    }

    const s = useGame.getState().state!;
    const pekojans = s.players.reduce((n, p) => n + p.pekojans, 0);
    console.log(`seed ${seed}: over=${s.phase} pekojans=${pekojans} guard=${guard}`);
    expect(s.phase).toBe("GAME_OVER");
    unmount();
    vi.useRealTimers();
  }

  expect(errors, "boundary errors: " + errors.map((e) => e.stack ?? e.message).join("\n---\n")).toEqual([]);
}, 300000);
