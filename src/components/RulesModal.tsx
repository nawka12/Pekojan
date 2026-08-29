import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { GameState } from "../game/types";
import { BONUS_PER_CARD, SCORING_TABLE } from "../game/scoring";
import { findValidPekojans } from "../game/hands";
import { getCharacter } from "../data/characters";

// Accessible during a game without destroying state — pure overlay.

export function RulesModal({ open, onClose, state, viewer = 0 }: { open: boolean; onClose: () => void; state: GameState | null; viewer?: number }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 24, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 18, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="slab max-h-[85vh] w-full max-w-2xl overflow-y-auto p-6"
          >
            <h2 className="display mb-3 text-2xl text-[#e6b54a]">Rules</h2>
            <ScoringTable />
            <Basics />
            {state && <WinningHandsGuide state={state} viewer={viewer} />}
            <button onClick={onClose} className="btn-primary mt-5 w-full py-2">
              Got it!
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ScoringTable() {
  return (
    <table className="mb-4 w-full text-sm">
      <thead>
        <tr className="text-left uppercase tracking-wider text-white/50">
          <th className="py-1">Hand</th>
          <th className="text-right">Mixed</th>
          <th className="text-right">Same color</th>
        </tr>
      </thead>
      <tbody className="counter">
        {SCORING_TABLE.map((row) => (
          <tr key={`${row.kind}${row.groupSize ?? ""}`} className="border-t border-white/10">
            <td className="py-1">{row.kind === "triple" ? "Three of a Kind" : `${row.groupSize}-person Group`}</td>
            <td className="counter text-right font-normal">{row.mixed.toLocaleString()}</td>
            <td className="counter text-right font-normal text-[#e6b54a]">{row.sameColor.toLocaleString()}</td>
          </tr>
        ))}
        <tr className="border-t border-yellow-400/30">
          <td className="py-1 text-[#e6b54a]">Bonus character card</td>
          <td colSpan={2} className="counter text-right font-normal text-[#e6b54a]">+{BONUS_PER_CARD} each</td>
        </tr>
      </tbody>
    </table>
  );
}

function Basics() {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-white/75">
      <p>Draw 1 card, then discard 1. Complete a hand from your cards anytime you hold one.</p>
      <p><b>Three of a kind</b>: any 3 copies of the same character (colors may differ).</p>
      <p><b>Complete group</b>: exactly one card of every member of an active group.</p>
      <p><b>One color</b>: all cards in the hand share a color — much bigger scores.</p>
      <p><b>Self-draw</b> Pekojan: the other three players split the payment.</p>
      <p><b>Claiming a discard</b>: complete your hand with a freshly discarded card — its owner pays everything.</p>
      <p>Pekojan does <b>not</b> end the round: winning cards leave your hand, replacements are drawn instantly, and chains can happen.</p>
      <p>Passing a valid Pekojan is always allowed — no penalty.</p>
      <p>Game ends when someone hits 0 points or the deck runs dry. Highest score wins.</p>
    </div>
  );
}

/** §22 — live “near completion” info computed only from public data. */
function WinningHandsGuide({ state, viewer = 0 }: { state: GameState; viewer?: number }) {
  const me = state.players[viewer];
  const candidates = useMemo(
    () => findValidPekojans(me.hand, state.groups, state.bonusCharacterId),
    [me.hand, state.groups, state.bonusCharacterId]
  );

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-4">
      <h3 className="mb-2 font-bold uppercase tracking-widest text-white/60">
        Your current potential · bonus {getCharacter(state.bonusCharacterId).name} ★
      </h3>
      {candidates.length > 0 ? (
        <p className="mb-2 rounded-lg px-3 py-2 text-sm" style={{ background: "rgba(255,77,109,0.15)", color: "#ffb3c2" }}>
          PEKOJAN ready! Best value now: <b className="counter">{candidates[0].totalScore}</b>
        </p>
      ) : null}
      <ul className="space-y-2 text-sm">
        {state.groups.map((g) => {
          const missing = g.characterIds.filter((id) => !me.hand.some((c) => c.characterId === id));
          const monoReady =
            missing.length === 0 &&
            g.characterIds.every(
              (id) =>
                me.hand.some((c) => c.characterId === id && c.color === (me.hand.find((c) => c.characterId === id))!.color)
            );
          void monoReady;
          const have = g.characterIds.length - missing.length;
          if (missing.length === 0)
            return (
              <li key={g.id}>
                <span className="text-[#7ed491]">✓ {g.name} complete</span>{" "}
                <span className="counter text-[#9aa3b5]">
                  {SCORING_TABLE.find((r) => r.kind === "group" && r.groupSize === g.characterIds.length)?.mixed}
                  /mono{" "}
                  {SCORING_TABLE.find((r) => r.kind === "group" && r.groupSize === g.characterIds.length)?.sameColor}
                </span>
              </li>
            );
          if (have >= g.characterIds.length - 1)
            return (
              <li key={g.id}>
                <span className="text-[#e6b54a]">Near completion:</span> {g.name}{" "}
                {g.characterIds.map((id) =>
                  missing.includes(id) ? (
                    <span key={id} title={getCharacter(id).name}>□{getCharacter(id).emoji} </span>
                  ) : (
                    <span key={id} className="opacity-50">{getCharacter(id).emoji}✓ </span>
                  )
                )}
              </li>
            );
          return null;
        })}
        {state.groups.some((g) => me.hand.filter((c) => c.characterId === g.id).length >= 3 && false) && null}
        {[...new Set(me.hand.map((c) => c.characterId))]
          .filter((ch) => me.hand.filter((c) => c.characterId === ch).length === 2)
          .map((ch) => (
            <li key={ch}>
              <span className="text-[#4b93b8]">Triple pair:</span> {getCharacter(ch).name} — 1 more copy = 120 / mono 840
            </li>
          ))}
      </ul>
    </div>
  );
}
