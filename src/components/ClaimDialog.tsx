import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { GameState } from "../game/types";
import { dedupeByVisibleIdentity, findValidPekojans } from "../game/hands";
import { Card, SPINE } from "./Card";
import { getCharacter } from "../data/characters";
import { useGame } from "../store/game";

/**
 * Discard claim decision window for the human player (rule doc §15).
 * A countdown auto-passes if the player doesn't answer.
 */
export function ClaimDialog({ state }: { state: GameState }) {
  const dispatch = useGame((s) => s.dispatch);
  const claimSeconds = useSettingsSeconds();
  const classic = useSettings((s) => s.settings.gameMode === "classic");
  const [remaining, setRemaining] = useState(claimSeconds);

  // Hot-seat: the first human in the queue owns this dialog; privacy for
  // their hand is handled by the PassDevice gate in the Game screen.
  const claimant = state.awaitingClaims.find((id) => state.players[id].isHuman);

  useEffect(() => {
    setRemaining(claimSeconds);
  }, [state.discarderId, state.decisionCounter, claimSeconds]);

  useEffect(() => {
    if (state.phase !== "DISCARD_CLAIM_WINDOW" || claimant === undefined) return;
    const iv = setInterval(() => setRemaining((r) => Math.max(0, r - 0.1)), 100);
    return () => clearInterval(iv);
  }, [state.phase, state.decisionCounter, state.awaitingClaims, claimant]);

  const discard = state.players[state.discarderId]?.discards.at(-1);
  const lookup = useMemo(() => {
    const map = new Map<string, import("../game/types").Card>();
    if (claimant !== undefined) for (const c of state.players[claimant].hand) map.set(c.id, c);
    return map;
  }, [state, claimant]);
  const myCandidates =
    discard && claimant !== undefined
      ? dedupeByVisibleIdentity(
          findValidPekojans(
            state.players[claimant].hand,
            state.groups,
            state.bonusCharacterId,
            discard
          ).filter((c) => c.cardIds.includes(discard.id)),
          lookup
        )
      : [];

  // Only render when it's actually the claimant's window.
  if (!discard || claimant === undefined) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-x-0 top-20 z-40 mx-auto w-[min(92vw,560px)]"
      >
        <div className="slab p-4" style={{ borderColor: "rgba(255,77,109,0.55)" }}>
          <div className="flex items-center justify-between">
            <p className="display text-base text-[#ff4d6d]">PEKOJAN AVAILABLE</p>
            {/* countdown ring — freestyle only: classic runs the claim on the
                claimant's compensation clock (top bar), per declared timings */}
            {!classic && (
            <div className="relative h-10 w-10">
              <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90">
                <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="4" />
                <circle
                  cx="18" cy="18" r="15" fill="none" stroke="#ff4d6d" strokeWidth="4"
                  strokeDasharray={`${(remaining / claimSeconds) * 94.2} 999`}
                  strokeLinecap="round"
                />
              </svg>
              <span className="counter absolute inset-0 grid place-items-center text-xs">{Math.ceil(remaining)}</span>
            </div>
            )}
          </div>

          <div className="mt-2 flex items-center gap-3">
            <Card card={discard} size="sm" />
            <p className="text-sm text-[#cfd4e0]">
              <b>{state.players[state.discarderId].name}</b> discarded{" "}
              <span className="font-semibold" style={{ color: SPINE[discard.color] }}>
                {getCharacter(discard.characterId).name}
              </span>
              . Claiming charges them the entire hand value.
            </p>
          </div>

          <div className="mt-3 space-y-2">
            {myCandidates.map((cand) => (
              <button
                key={cand.id}
                onClick={() =>
                  dispatch({
                    type: "CLAIM_DISCARD",
                    playerId: claimant,
                    candidateId: cand.id,
                    calledAtMs: Math.max(0, performance.now() - useGame.getState().claimWindowOpenedAtMs()),
                  })
                }
                className="btn-primary flex w-full items-center justify-between rounded-xl px-4 py-2.5 text-left"
              >
                <span className="font-bold italic">PEKOJAN</span>
                <span className="text-sm">
                  {cand.type === "group" ? "Group completion" : "Three of a kind"}
                  {cand.sameColor ? " · mono ★" : ""}
                  {cand.bonusCount > 0 ? ` · +${cand.bonusScore}` : ""}
                  <span className="counter ml-3">{cand.totalScore}</span>
                </span>
              </button>
            ))}
            <button
              onClick={() => {
                clearIntervalRemaining();
                dispatch({ type: "PASS_CLAIM", playerId: claimant });
              }}
              className="btn-ghost w-full py-2 text-sm font-semibold"
            >
              Pass for now
            </button>
            <p className="label text-center">
              Equal-value double-calls are won by the fastest call
            </p>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );

  function clearIntervalRemaining() {
    /* interval clears via unmount; explicit no-op for readability */
  }
}

import { useSettings } from "../store/settings";
function useSettingsSeconds(): number {
  return useSettings((s) => s.settings.claimWindowSeconds);
}
