import { expect, it, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useGame } from "../src/store/game";
import { useSettings } from "../src/store/settings";
import { GameScreen } from "../src/screens/Game";
import { pendingHumanActor } from "../src/game/view";
import type { GameAction } from "../src/game/types";

/**
 * Hot-seat UI integration: the pass-device gate must appear for a human
 * whose hand is not revealed, and after revealing, that seat's controls
 * must act on THEIR hand (dispatch under their own playerId).
 */

class Boundary extends React.Component<{ children?: React.ReactNode }, { err: Error | null }> {
  state = { err: null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() { return this.state.err ? null : this.props.children; }
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(1);
    await Promise.resolve();
  });
}

it("hot-seat: seat 2 gets the pass screen and their own decision controls", async () => {
  useSettings.getState().update({ humansCount: 3, claimWindowSeconds: 3, gameMode: "classic" });
  vi.useFakeTimers();
  useGame.getState().start("UI-HOTSEAT-2");
  render(<Boundary><GameScreen /></Boundary>);

  // 0. the deck roster reveal must appear before play and pause the match
  let startBtn = screen.queryByText("LET'S PLAY");
  for (let r = 0; r < 10 && !startBtn; r++) {
    await flush();
    startBtn = screen.queryByText("LET'S PLAY");
  }
  expect(startBtn, "deck reveal button").toBeTruthy();
  expect(useGame.getState().state!.turnNumber).toBe(1); // nothing moved yet
  fireEvent.click(startBtn!);

  const acted = new Set<number>();
  let guard = 0;
  while (useGame.getState().state!.phase !== "GAME_OVER" && guard++ < 3000) {
    await flush();
    const s = useGame.getState().state!;
    const pending = pendingHumanActor(s);
    const revealedFor = useGame.getState().revealedFor;

    // 1. pass-device gate
    if (pending !== null && pending !== revealedFor) {
      let btn = screen.queryByText(new RegExp(`I'm ${s.players[pending].name}`));
      for (let r = 0; r < 10 && !btn; r++) {
        await flush();
        btn = screen.queryByText(new RegExp(`I'm ${s.players[pending].name}`));
      }
      expect(btn, `pass-device button for seat ${pending}`).toBeTruthy();
      fireEvent.click(btn!);
      continue;
    }

    // 2. human decision for the revealed seat
    if (pending !== null && pending === revealedFor) {
      if (s.phase === "SELF_PEKOJAN_DECISION") {
        let pass = screen.queryByText("Pass this hand");
        for (let r = 0; r < 10 && !pass; r++) {
          await flush();
          pass = screen.queryByText("Pass this hand");
        }
        expect(pass, "pass button").toBeTruthy();
        fireEvent.click(pass!);
        acted.add(pending);
        continue;
      }
      if (s.phase === "DISCARDING") {
        const cards = [...document.querySelectorAll('[data-testid="hand-fan"] button')];
        expect(cards.length, "hand cards for acting seat").toBeGreaterThan(0);
        // Double-click to discard; skip stale exiting cards until state advances.
        let discarded = false;
        for (const card of cards) {
          fireEvent.doubleClick(card);
          await flush();
          if (useGame.getState().state !== s) { discarded = true; break; }
        }
        expect(discarded, "double-click discard for seat " + pending).toBe(true);
        acted.add(pending);
        continue;
      }
    }

    // 3. AI / claim timers
    await act(async () => { vi.advanceTimersByTime(500); });
  }

  const s = useGame.getState().state!;
  expect(s.phase).toBe("GAME_OVER");
  // humans 0,1,2 must each have acted through the UI at least once
  expect(acted.has(0)).toBe(true);
  expect(acted.has(1)).toBe(true);
  expect(acted.has(2)).toBe(true);
  vi.useRealTimers();
  useSettings.getState().update({ humansCount: 1 });
}, 120000);
