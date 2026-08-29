import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { GameState } from "../game/types";
import { findValidPekojans } from "../game/hands";
import { aiDecide } from "../ai";

/**
 * Developer overlay (rule doc §36). Never shown during ordinary play unless
 * explicitly toggled from the menu (helps reproduce seeds / validate rules).
 */
export function DebugOverlay({ state }: { state: GameState }) {
  const [tab, setTab] = useState<"hands" | "deck" | "ai">("hands");
  const inv = state ? quickSummary(state) : null;

  return (
    <motion.div
      drag
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      className="fixed bottom-28 right-3 z-50 w-80 rounded-xl border border-red-400/40 bg-black/92 p-3 font-mono text-[11px] leading-relaxed text-red-200"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold text-red-300">DEBUG</span>
        <div className="flex gap-1">
          {(["hands", "deck", "ai"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded px-2 ${tab === t ? "bg-red-500/60" : "bg-white/10"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <p>seed={state.seed}</p>
      <p>phase={state.phase} · player={state.currentPlayer} · turn={state.turnNumber}</p>
      <p>deck={state.deck.length} · excluded={state.poolExcluded.length}</p>
      <p>decisionCounter={state.decisionCounter} · chain={state.activeChain}</p>
      {inv && <p className="text-emerald-400">{inv}</p>}

      {tab === "hands" &&
        state.players.map((p) => {
          const cands = findValidPekojans(p.hand, state.groups, state.bonusCharacterId);
          return (
            <div key={p.id} className="mt-1 border-t border-white/10 pt-1">
              <b>{p.name}</b> ({p.hand.length}) →{" "}
              {cands.length ? cands.map((c) => `${c.type === "group" ? c.groupId : (c.cardIds[0] ?? "")}:${c.totalScore}`).join(", ") : "—"}
              <div className="flex flex-wrap gap-0.5">
                {p.hand.map((c) => (
                  <span key={c.id} className="rounded bg-white/10 px-1">
                    {c.characterId.slice(0, 2)}-{c.color[0]}
                  </span>
                ))}
              </div>
            </div>
          );
        })}

      {tab === "deck" && (
        <>
          <p className="mt-1">next draws:</p>
          <p>{state.deck.slice(0, 20).map((c) => `${c.characterId}-${c.color[0]}`).join(", ")}</p>
          <p className="mt-1 opacity-70">excluded (never in play): {state.poolExcluded.length} cards</p>
        </>
      )}

      {tab === "ai" && (
        <>
          {[1, 2, 3].map((pid) => {
            const d = aiDecide(state, pid);
            return (
              <p key={pid}>
                P{pid}: {d ? JSON.stringify(d.action).slice(0, 60) + " | " + (d.evalNote ?? "") : "waiting/human"}
              </p>
            );
          })}
        </>
      )}
    </motion.div>
  );
}

function quickSummary(s: GameState): string | null {
  // live invariant summary — cheap version of the full checker
  const count =
    s.deck.length +
    s.players.reduce(
      (n, p) =>
        n + p.hand.length + p.discards.length + p.melds.reduce((m, x) => m + x.cards.length, 0),
      0
    );
  return `cards-in-play=${count}`;
}
