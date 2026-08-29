import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useGame } from "../store/game";
import { useSettings } from "../store/settings";
import { PlayerSeat } from "../components/PlayerSeat";
import { TableCenter } from "../components/TableCenter";
import { HandArea } from "../components/HandArea";
import { DeckRevealOverlay } from "../components/DeckRevealOverlay";
import { PekojanOverlay } from "../components/PekojanOverlay";
import { PointStealFx } from "../components/PointStealFx";
import { ClaimDialog } from "../components/ClaimDialog";
import { DebugOverlay } from "../components/DebugOverlay";
import { RulesModal } from "../components/RulesModal";
import { PassDeviceOverlay } from "../components/PassDeviceOverlay";
import { ClassicTurnTimer } from "../components/ClassicTurnTimer";
import { pendingHumanActor } from "../game/view";
import { play } from "../audio/sfx";

export function GameScreen() {
  const state = useGame((s) => s.state);
  const revealedFor = useGame((s) => s.revealedFor);
  const revealOpen = useGame((s) => s.revealOpen);
  if (!state) return null; // safe during the menu transition

  // Hot-seat: when the next decision belongs to a human whose hand is not
  // revealed yet, gate the whole screen.
  const pendingViewer = pendingHumanActor(state);
  const needsPass = pendingViewer !== null && pendingViewer !== revealedFor;
  const setDebug = useGame((s) => s.setDebug);
  const debugOpen = useGame((s) => s.debugOpen);
  const [rulesOpen, setRulesOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="display text-sm text-[#e6b54a]">PEKOJAN</span>
        <button onClick={() => { play("button", 0.3); setRulesOpen(true); }} className="btn-ghost px-3 py-1.5 text-xs font-semibold">
          Rules
        </button>
        <span className="label">turn {state.turnNumber}</span>
        <span className="counter hidden text-[11px] text-[#9aa3b5] sm:inline">{state.seed}</span>
        <div className="ml-auto flex items-center gap-2">
          <AnimationToggle />
          <button
            onClick={() => {
              useGame.getState().setDebug(!debugOpen);
            }}
            className="btn-ghost px-2.5 py-1.5 text-xs font-semibold"
          >
            {debugOpen ? "debug on" : "debug"}
          </button>
        </div>
      </div>

      {/* Table — seats rotate so the revealed player is always at the bottom;
          every seat stays visible no matter whose hand is shown. */}
      <div
        className="relative mx-auto my-auto flex w-full max-w-[1600px] flex-1 flex-col justify-between px-2 sm:px-4"
        /* the table spreads to fill the screen, but only so far: past this the
           rows would drift apart and leave a hole where the felt should be */
        style={{ minHeight: 0, maxHeight: "calc(680 * var(--cu))" }}
      >
        {/* across the table */}
        <div className="flex justify-center">
          <PlayerSeat state={state} player={state.players[(revealedFor + 2) % 4]} />
        </div>

        {/* middle row — the side seats are capped so the felt keeps the width
            it needs to lay the groups out in rows instead of one tall column.
            Seat order runs clockwise: from the viewer's seat the next player
            sits on the left (like 6 → 9 on a clock face), then across, then
            right. */}
        <div className="my-0.5 flex items-center justify-between gap-3">
          <div className="w-44 shrink-0 xl:w-56">
            <PlayerSeat state={state} player={state.players[(revealedFor + 1) % 4]} />
          </div>
          <div className="flex min-w-0 flex-1 justify-center">
            <TableCenter state={state} viewer={revealedFor} />
          </div>
          <div className="w-44 shrink-0 xl:w-56">
            <PlayerSeat state={state} player={state.players[(revealedFor + 3) % 4]} />
          </div>
        </div>

        <HandArea state={state} viewer={revealedFor} />
      </div>

      <ClassicTurnTimer state={state} />
      <PointStealFx state={state} />
      <PekojanOverlay state={state} />
      {!needsPass && <ClaimDialog state={state} />}
      {!revealOpen && needsPass && pendingViewer !== null && (
        <PassDeviceOverlay state={state} forPlayer={pendingViewer} />
      )}
      {debugOpen && <DebugOverlay state={state} />}
      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} state={state} viewer={revealedFor} />

      <AnimatePresence>{state.phase === "GAME_OVER" && <ResultsOverlay />}</AnimatePresence>
      <AnimatePresence>{revealOpen && <DeckRevealOverlay />}</AnimatePresence>
    </div>
  );
}

function AnimationToggle() {
  const speed = useSettings((s) => s.settings.animationSpeed);
  return (
    <button
      onClick={() =>
        useSettings.getState().update({ animationSpeed: speed === "fast" ? "normal" : "fast" })
      }
      className="btn-ghost px-2.5 py-1.5 text-xs font-semibold"
    >
      speed {speed}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Result screen (§25)
// ---------------------------------------------------------------------------

export function ResultsOverlay() {
  const state = useGame((s) => s.state);
  if (!state) return null;
  const start = useGame((s) => s.start);
  const [menu, setMenu] = useState(false);
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const meSeat = state.players.find((p) => p.isHuman) ?? state.players[0];
  const myPlace = ranked.findIndex((p) => p.id === meSeat.id) + 1;

  useEffect(() => {
    const vol = useSettings.getState().settings;
    play(myPlace === 1 ? "victory" : "defeat", vol.audioEnabled ? vol.volume : 0);
  }, [myPlace]);

  if (menu) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/80 p-4"
    >
      <motion.div
        initial={{ scale: 0.94, y: 18 }}
        animate={{ scale: 1, y: 0 }}
        className="slab w-full max-w-xl p-6"
      >
        <h2 className="display text-center text-3xl text-[#e6b54a]">RESULT</h2>
        <p className="mb-4 text-center text-sm uppercase tracking-widest text-white/50">
          {state.endReason === "deck-exhausted" ? "Draw pile exhausted" : "A player hit zero points"} · seed {state.seed}
        </p>

        <div className="space-y-1.5">
          {ranked.map((p, i) => (
            <div key={p.id} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${p.isHuman ? "border border-[#e6b54a]/50 bg-[#e6b54a]/10" : "bg-white/5"}`}>
              <span className="counter w-8 text-right font-bold text-[#e6b54a]">{i + 1}{["st", "nd", "rd", "th"][i]}</span>
              <span className="w-8 text-xl">{["🥇", "🥈", "🥉", "💀"][i]}</span>
              <span className="flex-1">{p.name}{p.isHuman && " (human)"}</span>
              <span className="counter text-lg">{p.score.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {(() => {
          const me = meSeat;
          const monochrome = me.melds.filter((m) => m.cards.every((c) => c.color === m.cards[0].color)).length;
          const bonusHands = me.melds.filter((m) => m.cards.some((c) => c.characterId === state.bonusCharacterId)).length;
          return (
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-xl bg-black/30 p-4 text-sm">
              <p className="text-[#cfd4e0]">Pekojans <b className="counter float-right">{me.pekojans}</b></p>
              <p className="text-[#cfd4e0]">Largest Pekojan <b className="counter float-right">{me.largestHand.toLocaleString()}</b></p>
              <p className="text-[#cfd4e0]">Self-draw wins <b className="counter float-right">{me.selfDrawWins}</b></p>
              <p className="text-[#cfd4e0]">Discard wins <b className="counter float-right">{me.discardWins}</b></p>
              <p className="text-[#cfd4e0]">Points gained <b className="counter float-right text-[#7ed491]">+{me.pointsGained.toLocaleString()}</b></p>
              <p className="text-[#cfd4e0]">Points lost <b className="counter float-right text-[#ff4d6d]">−{me.pointsLost.toLocaleString()}</b></p>
              <p className="text-[#cfd4e0]">Longest chain <b className="counter float-right">×{me.longestChain || 1}</b></p>
              <p className="text-[#cfd4e0]">One-color hands <b className="counter float-right">{monochrome}</b></p>
              <p className="text-[#cfd4e0]">Bonus hands <b className="counter float-right">{bonusHands}</b></p>
              <p className="text-[#cfd4e0]">Claims on your discards <b className="counter float-right">{me.dangerousDiscards}</b></p>
            </div>
          );
        })()}

        <div className="mt-5 flex gap-3">
          <button
            onClick={() => start()}
            className="btn-primary flex-1 rounded-xl py-3 font-bold"
          >
            Play Again
          </button>
          <button
            onClick={() => {
              setMenu(true);
              useGame.setState({ state: null });
            }}
            className="btn-ghost flex-1 rounded-xl py-3 font-bold"
          >
            Main Menu
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
