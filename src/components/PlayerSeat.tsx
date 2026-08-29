import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Card as CardT, GameState, PlayerState } from "../game/types";
import { Card, scatterOf } from "./Card";
import { CardInspector } from "./HandArea";
import { useGame } from "../store/game";

/*
 * Seat design: monogram token (no emoji), tabular counters,
 * scattered discard pile, flat ink slabs. Glow only marks the active turn.
 */

const SEAT_HUES = [8, 150, 205, 265]; // per-player hue for the token split

export function SeatToken({ playerId, name }: { playerId: number; name: string }) {
  const hue = SEAT_HUES[playerId % SEAT_HUES.length];
  return (
    <span
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 45% 34%) 0%, hsl(${hue} 45% 22%) 100%)`,
        border: "1px solid rgba(230,181,74,0.4)",
        color: "#e8e4d8",
        fontFamily: "Georgia, serif",
      }}
    >
      {name[0]}
    </span>
  );
}

export function rankOf(state: GameState, playerId: number): number {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  return sorted.findIndex((p) => p.id === playerId) + 1;
}

const ORDINAL = ["st", "nd", "rd", "th"];

export function PlayerSeat({
  state,
  player,
}: {
  state: GameState;
  player: PlayerState;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  // The inspector's "in your hand" highlight must follow the revealed seat —
  // using the seat's own hand would leak hidden hot-seat information.
  const revealedFor = useGame((s) => s.revealedFor);
  const isActive = state.currentPlayer === player.id && state.phase !== "GAME_OVER";
  const rank = rankOf(state, player.id);
  const recentDiscards = player.discards.slice(-7);

  return (
    <div className="relative flex w-full flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => setHistoryOpen((o) => !o)}
        className={`slab flex items-center gap-2.5 px-3 py-2 text-left transition-shadow ${
          isActive ? "urgent" : ""
        }`}
      >
        <SeatToken playerId={player.id} name={player.name} />
        <span className="min-w-[86px]">
          <span className="block text-sm font-semibold leading-tight text-[#e8e4d8]">
            {player.name}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="label" style={{ color: rank === 1 ? "#e6b54a" : undefined }}>
              {rank}
              {ORDINAL[rank - 1]}
            </span>
            <span className="counter text-sm text-[#e6b54a]">
              {player.score.toLocaleString()}
            </span>
          </span>
        </span>
        <span className="counter rounded bg-black/40 px-1.5 py-0.5 text-[11px] text-[#9aa3b5]">
          {player.hand.length}
        </span>
      </button>

      {recentDiscards.length > 0 && (
        <DiscardRow player={player} state={state} viewer={revealedFor} />
      )}

      <AnimatePresence>
        {historyOpen && (
          <HistoryPanel state={state} player={player} align="top" />
        )}
      </AnimatePresence>
    </div>
  );
}

export function DiscardRow({
  player,
  state,
  viewer,
}: {
  player: PlayerState;
  state?: GameState;
  /** whose hand counts as "mine" in the inspector (defaults to the row's owner) */
  viewer?: number;
}) {
  const recent = player.discards.slice(-7);
  const [inspect, setInspect] = useState<CardT | null>(null);

  // Same dismissal contract as the hand-fan inspector: a press outside the
  // panel closes it, alongside the ✕ button and tapping the card again.
  useEffect(() => {
    if (!inspect) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest?.("[data-card-inspect]")) setInspect(null);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [inspect]);

  return (
    <div className="relative flex max-w-full flex-wrap items-center justify-center gap-0.5">
      <AnimatePresence initial={false} mode="popLayout">
        {recent.map((c, i) => {
          const isLatest = i === recent.length - 1;
          return (
            <motion.div
              key={c.id}
              layout
              initial={{ y: -26, scale: 0.7, opacity: 0, rotate: 0 }}
              animate={{
                y: 0,
                scale: isLatest ? 1.06 : 1,
                opacity: isLatest ? 1 : 0.8,
                rotate: scatterOf(c.id),
              }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 26 }}
              className="relative"
            >
              <Card
                card={c}
                size="xs"
                onClick={() => setInspect((cur) => (cur?.id === c.id ? null : c))}
              />
              {state && inspect?.id === c.id && (
                <CardInspector
                  state={state}
                  card={inspect}
                  viewer={viewer ?? player.id}
                  onClose={() => setInspect(null)}
                />
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function HistoryPanel({
  state,
  player,
  align = "top",
}: {
  state: GameState;
  player: PlayerState;
  align?: "top" | "above";
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: align === "top" ? -6 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={`slab absolute left-1/2 z-40 w-64 -translate-x-1/2 overflow-y-auto p-3 ${
        align === "top" ? "top-full mt-2 max-h-72" : "bottom-full mb-2 max-h-60"
      }`}
    >
      <p className="label mb-1.5 text-[#e6b54a]">Player history</p>
      {player.melds.map((m, i) => (
        <div key={i} className="flex items-center justify-between border-b border-white/5 py-1 text-xs">
          <span className="truncate text-[#cfd4e0]">
            {m.groupName ?? "Triple"}
            {m.claim === "discard" && <span className="text-[#ff4d6d]"> claim</span>}
          </span>
          <span className="counter text-[#e6b54a]">+{m.score}</span>
        </div>
      ))}
      {player.melds.length === 0 && (
        <p className="text-xs italic text-[#9aa3b5]">No hands completed yet.</p>
      )}
      <p className="label mt-2 mb-1">Discards ({player.discards.length})</p>
      <div className="flex flex-wrap gap-1">
        {player.discards.map((c) => (
          <Card key={c.id} card={c} size="xs" />
        ))}
        {player.discards.length === 0 && (
          <p className="text-xs italic text-[#9aa3b5]">Nothing discarded.</p>
        )}
      </div>
    </motion.div>
  );
}
