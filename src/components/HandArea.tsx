import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Card as CardT, GameState, PekojanCandidate, SortMode } from "../game/types";
import { dedupeByVisibleIdentity, findValidPekojans } from "../game/hands";
import { cardAvailability } from "../game/invariants";
import { getCharacter, getGroup } from "../data/characters";
import { Card, SPINE } from "./Card";
import { DiscardRow, HistoryPanel, SeatToken } from "./PlayerSeat";
import { useGame } from "../store/game";
import { useSettings } from "../store/settings";

const COLOR_ORDER = { pink: 0, blue: 1, orange: 2 };

export function sortHand(hand: CardT[], mode: SortMode): CardT[] {
  const copy = [...hand];
  switch (mode) {
    case "group":
      return copy.sort(
        (a, b) =>
          a.groupId.localeCompare(b.groupId) ||
          a.characterId.localeCompare(b.characterId) ||
          COLOR_ORDER[a.color] - COLOR_ORDER[b.color]
      );
    case "character":
      return copy.sort(
        (a, b) => a.characterId.localeCompare(b.characterId) || COLOR_ORDER[a.color] - COLOR_ORDER[b.color]
      );
    case "color":
      return copy.sort(
        (a, b) => COLOR_ORDER[a.color] - COLOR_ORDER[b.color] || a.characterId.localeCompare(b.characterId)
      );
  }
}

// ---------------------------------------------------------------------------
// Card availability inspector (right-click / long-press)
// ---------------------------------------------------------------------------

export function CardInspector({
  state,
  card,
  viewer,
  onClose,
}: {
  state: GameState;
  card: CardT;
  viewer: number;
  onClose?: () => void;
}) {
  const ch = getCharacter(card.characterId);
  const colors = ["pink", "blue", "orange"] as const;

  // Copy slots: card ids end in the copy number (…-pink-2).
  const copyN = (id: string): number => {
    const m = id.match(/-(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  };

  const usedByColor: Record<string, Set<number>> = {
    pink: new Set(), blue: new Set(), orange: new Set(),
  };
  const mineByColor: Record<string, Set<number>> = {
    pink: new Set(), blue: new Set(), orange: new Set(),
  };

  for (const p of state.players) {
    for (const d of p.discards) {
      if (d.characterId === ch.id) usedByColor[d.color].add(copyN(d.id));
    }
    for (const meld of p.melds) {
      for (const c of meld.cards) {
        if (c.characterId === ch.id) usedByColor[c.color].add(copyN(c.id));
      }
    }
  }
  for (const c of state.players[viewer].hand) {
    if (c.characterId === ch.id) mineByColor[c.color].add(copyN(c.id));
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      data-card-inspect
      className="slab absolute bottom-full right-0 z-50 mb-3 w-60 p-3"
    >
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded text-sm font-bold text-[#9aa3b5] hover:bg-white/10 hover:text-[#e8e4d8]"
        >
          ✕
        </button>
      )}
      <p className="display text-center text-sm text-[#e8e4d8]">{ch.name}</p>
      <p className="label mb-2 text-center">copies not yet used</p>
      <div className="space-y-1.5">
        {colors.map((color) => (
          <div key={color} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: SPINE[color] }}
              title={color}
            />
            <div className="grid flex-1 grid-cols-3 gap-1">
              {[0, 1, 2].map((n) => {
                const isUsed = usedByColor[color].has(n);
                const isMine = mineByColor[color].has(n);
                return (
                  <div
                    key={n}
                    className="grid h-7 place-items-center rounded text-[11px] font-bold"
                    style={{
                      background: isUsed
                        ? "rgba(0,0,0,0.45)"
                        : isMine
                          ? "rgba(230,181,74,0.2)"
                          : "rgba(243,236,217,0.16)",
                      border: isMine
                        ? "1px solid #e6b54a"
                        : "1px solid rgba(243,236,217,0.15)",
                      color: isUsed ? "#5b6272" : "#e8e4d8",
                      textDecoration: isUsed ? "line-through" : undefined,
                    }}
                  >
                    {isUsed ? "✕" : getCharacter(card.characterId).emoji}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-snug text-[#9aa3b5]">
        ✕ used in a Pekojan or discard · bordered = in your hand · open cells
        may not exist in this match at all.
      </p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Hand area
// ---------------------------------------------------------------------------

export function HandArea({ state, viewer = 0 }: { state: GameState; viewer?: number }) {
  const me = state.players[viewer];
  const dispatch = useGame((s) => s.dispatch);
  const sortMode = useSettings((s) => s.settings.sortMode);
  const [selected, setSelected] = useState<string | null>(null);
  const [inspectCard, setInspectCard] = useState<CardT | null>(null);
  const [ownHistoryOpen, setOwnHistoryOpen] = useState(false);

  // The long-press inspector must always be dismissible: any press outside
  // the panel closes it (the ✕ button and re-inspecting the card also work).
  useEffect(() => {
    if (!inspectCard) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest?.("[data-card-inspect]")) setInspectCard(null);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [inspectCard]);

  const candidates = useMemo(
    () => findValidPekojans(me.hand, state.groups, state.bonusCharacterId),
    [me.hand, state.groups, state.bonusCharacterId]
  );

  // Cards that are ONE card away from completing a hand get a blinking
  // border: character pairs (any colors), and held members of a group
  // that is missing exactly one member.
  const hotIds = useMemo(() => {
    const ids = new Set<string>();
    const byChar = new Map<string, CardT[]>();
    for (const c of me.hand) {
      const list = byChar.get(c.characterId) ?? [];
      list.push(c);
      byChar.set(c.characterId, list);
    }
    for (const [, cards] of byChar) {
      if (cards.length === 2) for (const c of cards) ids.add(c.id);
    }
    for (const g of state.groups) {
      const missing = g.characterIds.filter((id) => !byChar.has(id));
      if (missing.length === 1) {
        for (const c of me.hand) {
          if (g.characterIds.includes(c.characterId)) ids.add(c.id);
        }
      }
    }
    return ids;
  }, [me.hand, state.groups]);
  const canDeclare =
    state.phase === "SELF_PEKOJAN_DECISION" &&
    state.currentPlayer === viewer &&
    candidates.length > 0;
  const canDiscard = state.phase === "DISCARDING" && state.currentPlayer === viewer;

  const drawn = me.hand.find((c) => c.id === state.drawnCardId) ?? null;
  const rest = drawn
    ? sortHand(me.hand.filter((c) => c.id !== drawn.id), sortMode)
    : sortHand(me.hand, sortMode);

  const doDiscard = (cardId: string) => {
    if (!canDiscard) return;
    dispatch({ type: "DISCARD", playerId: viewer, cardId });
    setSelected(null);
  };

  // Hand fan: gentle arc, deterministic per slot.
  const fan = (index: number, total: number) => {
    if (total <= 1) return { rotate: 0, y: 0 };
    const mid = (total - 1) / 2;
    const off = index - mid;
    return { rotate: Math.max(-9, Math.min(9, off * 3.2)), y: Math.abs(off) * 2.4 };
  };

  const handCard = (card: CardT, index: number, total: number, isNew: boolean) => {
    const f = isNew ? { rotate: 0, y: -10 } : fan(index, total);
    return (
      <motion.div
        key={card.id}
        layout
        initial={{ opacity: 0, y: 60, scale: 0.85 }}
        animate={{ opacity: 1, rotate: f.rotate, y: f.y, scale: 1 }}
        exit={{ opacity: 0, y: -60, scale: 0.8 }}
        transition={{ type: "spring", stiffness: 340, damping: 28 }}
        className={`relative ${isNew ? "ml-7 sm:ml-12" : ""}`}
        style={{ transformOrigin: "bottom center" }}
      >
        <Card
          card={card}
          selected={selected === card.id}
          hot={hotIds.has(card.id)}
          showBonus={card.characterId === state.bonusCharacterId}
          size="md"
          onDoubleClick={() => doDiscard(card.id)}
          onInspect={() => setInspectCard(inspectCard?.id === card.id ? null : card)}
          onClick={() => setSelected(selected === card.id ? null : card.id)}
        />
        {isNew && (
          <span className="label absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[#ff4d6d] px-1.5 py-0.5 !text-[9px] text-white">
            drawn
          </span>
        )}
        {inspectCard?.id === card.id && (
          <CardInspector
            state={state}
            card={card}
            viewer={viewer}
            onClose={() => setInspectCard(null)}
          />
        )}
      </motion.div>
    );
  };

  return (
    <div className="relative flex w-full flex-col items-center gap-1.5 px-2 pb-2">
      {/* status line */}
      <div className="flex h-7 flex-wrap items-center justify-center gap-2">
        {canDiscard && <p className="label !text-[#e6b54a]">Your turn · discard one card</p>}
        {canDeclare && <p className="label !text-[#ff4d6d]">A hand is ready</p>}
        {!canDeclare && !canDiscard && (
          <p className="label">
            {state.phase === "GAME_OVER"
              ? "Match over"
              : state.currentPlayer === viewer
                ? "…"
                : `${state.players[state.currentPlayer].name} is playing`}
          </p>
        )}
        <span className="ml-2 flex items-center gap-1">
          <span className="label">sort</span>
          {(["group", "character", "color"] as SortMode[]).map((m) => (
            <button
              key={m}
              onClick={() => useSettings.getState().update({ sortMode: m })}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                sortMode === m
                  ? "bg-[#e6b54a] text-[#241b06]"
                  : "text-[#9aa3b5] hover:text-[#cfd4e0]"
              }`}
            >
              {m}
            </button>
          ))}
        </span>
      </div>

      {/* hand fan */}
      <div data-testid="hand-fan" className="flex min-h-[7rem] max-w-full items-end justify-center px-1 pb-1">
        <AnimatePresence mode="popLayout">
          {rest.map((card, i) => handCard(card, i, rest.length, false))}
          {drawn && handCard(drawn, rest.length, rest.length + 1, true)}
        </AnimatePresence>
      </div>

      {/* actions */}
      <div className="flex h-11 items-center justify-center gap-3">
        {canDiscard && (
          <button
            disabled={!selected}
            onClick={() => selected && doDiscard(selected)}
            className="btn-ghost px-4 py-2 text-sm font-semibold disabled:opacity-40"
          >
            Discard {selected ? "selected card" : ""}
          </button>
        )}
        {canDeclare && <PekojanButton state={state} viewer={viewer} />}
        {canDeclare && (
          <button
            onClick={() => dispatch({ type: "PASS_PEKOJAN", playerId: viewer })}
            className="btn-ghost px-4 py-2 text-sm font-semibold"
          >
            Pass this hand
          </button>
        )}
      </div>

      {/* your discards */}
      {me.discards.length > 0 && <DiscardRow player={me} state={state} />}

      {/* own seat */}
      <div className="relative mt-0.5">
        <AnimatePresence>
          {ownHistoryOpen && <HistoryPanel state={state} player={me} align="above" />}
        </AnimatePresence>
        <button
          type="button"
          onClick={() => setOwnHistoryOpen((o) => !o)}
          className="slab flex items-center gap-2.5 px-3 py-2 text-left"
        >
          <SeatToken playerId={viewer} name={me.name} />
          <span>
            <span className="block text-sm font-semibold leading-tight text-[#e8e4d8]">{me.name}</span>
            <span className="label">
              rank{" "}
              {[...state.players].sort((a, b) => b.score - a.score).findIndex((p) => p.id === 0) + 1}
            </span>
          </span>
          <div className="relative">
            <AnimatedScore score={me.score} />
            <ScoreDelta score={me.score} />
          </div>
          <span className="counter rounded bg-black/40 px-1.5 py-0.5 text-[11px] text-[#9aa3b5]">
            {me.hand.length}
          </span>
        </button>
      </div>
    </div>
  );
}

export function AnimatedScore({ score }: { score: number }) {
  return (
    <motion.span
      key={score}
      initial={{ scale: 1.18 }}
      animate={{ scale: 1 }}
      className="counter block text-lg text-[#e6b54a]"
    >
      {score.toLocaleString()}
    </motion.span>
  );
}

/** +N / −N flash keyed on score changes. */
export function ScoreDelta({ score }: { score: number }) {
  const [prev, setPrev] = useState<number | null>(score);
  const [delta, setDelta] = useState<number | null>(null);
  useEffect(() => {
    if (prev === null) {
      setPrev(score);
      return;
    }
    if (prev !== score) {
      setDelta(score - prev);
      setPrev(score);
      const t = setTimeout(() => setDelta(null), 1500);
      return () => clearTimeout(t);
    }
  }, [score, prev]);
  if (delta === null) return null;
  return (
    <motion.span
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: -16 }}
      className={`counter pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap rounded bg-black/70 px-1 text-xs ${
        delta > 0 ? "text-[#7ed491]" : "text-[#ff4d6d]"
      }`}
    >
      {delta > 0 ? "+" : ""}
      {delta.toLocaleString()}
    </motion.span>
  );
}

// ---------------------------------------------------------------------------
// Self Pekojan decision
// ---------------------------------------------------------------------------

function PekojanButton({ state, viewer }: { state: GameState; viewer: number }) {
  const dispatch = useGame((s) => s.dispatch);
  const [choicesOpen, setChoicesOpen] = useState(false);
  const allCandidates = findValidPekojans(state.players[viewer].hand, state.groups, state.bonusCharacterId);
  const lookup = useMemo(() => {
    const map = new Map<string, CardT>();
    for (const c of state.players[viewer].hand) map.set(c.id, c);
    return map;
  }, [state.players[viewer].hand]);
  // Hands that differ only by which physical copy is used play identically.
  const candidates = useMemo(
    () => dedupeByVisibleIdentity(allCandidates, lookup),
    [allCandidates, lookup]
  );
  const best = candidates[0];
  // The button auto-plays the highest-scoring hand; a choice is offered only
  // when several distinct hands tie for the top score.
  const tied = useMemo(
    () => candidates.filter((c) => c.totalScore === best?.totalScore),
    [candidates, best]
  );

  if (!best) return null;
  return (
    <>
      <motion.button
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        onClick={() =>
          tied.length === 1
            ? dispatch({ type: "DECLARE_PEKOJAN", playerId: viewer, candidateId: best.id })
            : setChoicesOpen(true)
        }
        className="btn-primary urgent px-7 py-2.5 text-lg"
      >
        PEKOJAN
        <span className="counter ml-2 align-middle text-sm font-bold opacity-90">
          {best.totalScore.toLocaleString()}
          {tied.length > 1 ? ` · pick 1 of ${tied.length}` : ""}
        </span>
      </motion.button>

      <AnimatePresence>
        {choicesOpen && (
          <CandidatePicker
            candidates={tied}
            onPick={(id) => {
              setChoicesOpen(false);
              dispatch({ type: "DECLARE_PEKOJAN", playerId: viewer, candidateId: id });
            }}
            onClose={() => setChoicesOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function CandidatePicker({
  candidates,
  onPick,
  onClose,
}: {
  candidates: PekojanCandidate[];
  onPick(candidateId: string): void;
  onClose(): void;
}) {
  const state = useGame((s) => s.state);
  const cardsById = useMemo(() => {
    const map = new Map<string, CardT>();
    for (const p of state?.players ?? []) {
      for (const c of p.hand) map.set(c.id, c);
      for (const d of p.discards) map.set(d.id, d);
      for (const m of p.melds) for (const c of m.cards) map.set(c.id, c);
    }
    return map;
  }, [state]);
  const unique = useMemo(() => dedupeByVisibleIdentity(candidates, cardsById), [candidates, cardsById]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.94, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="slab w-full max-w-lg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="display mb-1 text-center text-base text-[#e8e4d8]">Choose a hand</h3>
        <p className="label mb-3 text-center">Only one can be declared</p>
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {unique.map((cand) => (
            <button
              key={cand.id}
              onClick={() => onPick(cand.id)}
              className="btn-ghost flex w-full items-center justify-between gap-3 p-2 text-left"
            >
              <div className="flex gap-1">
                {cand.cardIds.map((id) => {
                  const card = cardsById.get(id);
                  return card ? <Card key={id} card={card} size="sm" /> : null;
                })}
              </div>
              <div className="shrink-0 text-right">
                <p className="counter text-lg text-[#e6b54a]">{cand.totalScore}</p>
                <p className="label">
                  {cand.type === "group" ? "Group" : "Triple"}
                  {cand.sameColor ? " · one color" : ""}
                  {cand.bonusCount > 0 ? ` · bonus ${cand.bonusCount}` : ""}
                </p>
              </div>
            </button>
          ))}
        </div>
        <button onClick={onClose} className="btn-ghost mt-3 w-full py-2 text-sm font-semibold">
          Close
        </button>
      </motion.div>
    </motion.div>
  );
}
