import { useEffect, useRef, useState } from "react";
import type { GameState } from "../game/types";
import { pendingHumanActor } from "../game/view";
import { CLASSIC_TURN_BASE, useGame } from "../store/game";
import { useSettings } from "../store/settings";

/*
 * CLASSIC mode turn timer (original Pokajan rules):
 *  - discard turn = 10s + the seat's remaining compensation pool
 *  - pekojan turn = 5s  + the seat's remaining compensation pool
 *  - the 20s pool is shared across the seat's turns for the whole match;
 *    the STORE accounts spare-time usage at dispatch time (see game.ts)
 *  - expiry forces a pass (pekojan) / discard (first hand card)
 *
 * This component is display + forced-action only. The clock only runs while
 * the pending human actor has the device. AI seats and freestyle are untimed.
 */

export function ClassicTurnTimer({ state }: { state: GameState }) {
  const mode = useSettings((s) => s.settings.gameMode);
  const pending = pendingHumanActor(state);
  const revealedFor = useGame((s) => s.revealedFor);
  const compensation = useGame((s) => s.compensation);
  const turnStartedAt = useGame((s) => s.turnStartedAt);

  const active =
    mode === "classic" &&
    state.phase !== "GAME_OVER" &&
    pending !== null &&
    pending === revealedFor &&
    turnStartedAt !== null &&
    (state.phase === "DISCARDING" || state.phase === "SELF_PEKOJAN_DECISION");

  const base =
    state.phase === "SELF_PEKOJAN_DECISION"
      ? CLASSIC_TURN_BASE.pekojan
      : CLASSIC_TURN_BASE.discard;
  const pool = compensation[pending ?? 0] ?? 0;
  const budget = base + pool;

  const [now, setNow] = useState(() => Date.now());
  const forcedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active || turnStartedAt === null) return;
    const iv = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(iv);
  }, [active, turnStartedAt]);

  const elapsed =
    active && turnStartedAt !== null ? Math.max(0, (now - turnStartedAt) / 1000) : 0;
  const remaining = Math.max(0, budget - elapsed);
  const spareLeft = Math.max(0, pool - Math.max(0, elapsed - base));

  // forced action on expiry — once per turn
  const turnKey = `${state.phase}:${state.turnNumber}:${state.activeChain}:${pending}`;
  useEffect(() => {
    if (!active || pending === null) return;
    if (remaining > 0) {
      forcedRef.current = null;
      return;
    }
    if (forcedRef.current === turnKey) return;
    forcedRef.current = turnKey;
    const dispatch = useGame.getState().dispatch;
    if (state.phase === "SELF_PEKOJAN_DECISION") {
      dispatch({ type: "PASS_PEKOJAN", playerId: pending });
    } else {
      dispatch({
        type: "DISCARD",
        playerId: pending,
        cardId: state.players[pending].hand[0]?.id ?? "",
      });
    }
  }, [turnKey, remaining, active, pending, state]);

  if (!active || pending === null) return null;

  const pct = Math.max(0, Math.min(1, remaining / budget));
  const urgent = remaining <= 3;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex flex-col items-center gap-0.5 pt-1">
      <div
        className="h-1.5 w-64 overflow-hidden rounded-full"
        style={{ background: "rgba(255,255,255,0.12)" }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-100"
          style={{
            width: `${pct * 100}%`,
            background: urgent
              ? "#ff4d6d"
              : "linear-gradient(90deg, #e6b54a, #ff4d6d)",
          }}
        />
      </div>
      <p className="label !text-[10px]">
        <span className="counter" style={{ color: urgent ? "#ff4d6d" : "#e6b54a" }}>
          {remaining.toFixed(1)}s
        </span>{" "}
        · spare {spareLeft.toFixed(1)}s
      </p>
    </div>
  );
}
