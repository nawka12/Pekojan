import { useState } from "react";
import { motion } from "framer-motion";
import { useGame } from "../store/game";
import { useSettings, averagePlacement } from "../store/settings";
import { RulesModal } from "../components/RulesModal";
import { play } from "../audio/sfx";

export function MainMenu() {
  const start = useGame((s) => s.start);
  const { difficulty, tutorialDone, volume, audioEnabled, claimWindowSeconds, humansCount, seatNames, gameMode } = useSettings((s) => s.settings);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(!tutorialDone);
  const [seedInput, setSeedInput] = useState("");

  const go = (seed?: string) => {
    play("button", useSettings.getState().settings.volume);
    start(seed || undefined);
    if (!tutorialDone) setTutorialOpen(true); // offer once per install
  };

  return (
    // auto margins, not justify-center: they centre the column when it fits and
    // collapse to 0 when it does not, so a tall menu scrolls instead of losing
    // its top edge off-screen.
    <div className="flex h-full flex-col items-center gap-6 overflow-y-auto p-4">
      <motion.div className="mt-auto" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring" }}>
        <h1 className="display text-center text-6xl leading-none text-[#f3ecd9] sm:text-7xl"
            style={{ textShadow: "0 0 30px rgba(255,77,109,0.35)" }}>
          PEKOJAN
        </h1>
        <p className="label mt-2 text-center !text-[11px]">
          four seats · one deck · claim everything
        </p>
      </motion.div>

      <div className="slab w-full max-w-xs space-y-3 p-5">
        <div className="text-sm">
          <p className="mb-1 uppercase tracking-widest text-white/50">Game mode</p>
          <div className="flex gap-1">
            <button
              onClick={() => useSettings.getState().update({ gameMode: "freestyle" })}
              className={`flex-1 py-1.5 text-xs font-semibold ${gameMode === "freestyle" ? "btn-brass" : "btn-ghost"}`}
            >
              Freestyle
              <span className="block text-[9px] font-normal opacity-70">no timers</span>
            </button>
            <button
              onClick={() => useSettings.getState().update({ gameMode: "classic" })}
              className={`flex-1 py-1.5 text-xs font-semibold ${gameMode === "classic" ? "btn-brass" : "btn-ghost"}`}
            >
              Classic
              <span className="block text-[9px] font-normal opacity-70">10s / 5s + 20s spare</span>
            </button>
          </div>
        </div>

        <div className="text-sm">
          <p className="mb-1 uppercase tracking-widest text-white/50">Players at this device</p>
          <div className="flex gap-1">
            {([1, 2, 3, 4] as const).map((n) => (
              <button
                key={n}
                onClick={() => useSettings.getState().update({ humansCount: n })}
                className={`flex-1 py-1.5 text-xs font-semibold ${
                  humansCount === n ? "btn-brass" : "btn-ghost"
                }`}
              >
                {n} human{n > 1 ? "s" : ""}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] leading-snug text-[#9aa3b5]">
            Extra seats play offline on one device (pass-and-play); hands stay
            hidden between human turns.
          </p>
        </div>

        {humansCount > 1 && (
          <div className="text-sm">
            <p className="mb-1 uppercase tracking-widest text-white/50">Seat names</p>
            {[0, 1, 2, 3].map((i) => (
              <input
                key={i}
                value={seatNames[i] ?? ""}
                onChange={(e) => {
                  const next = [...seatNames];
                  next[i] = e.target.value;
                  useSettings.getState().update({ seatNames: next });
                }}
                placeholder={
                  i < humansCount ? `Player ${i + 1}` : ["Kotone", "Hibari", "Nodoka"][i - 1]
                }
                className="mb-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-sm placeholder:text-white/25"
              />
            ))}
          </div>
        )}

        <div className="text-sm">
          <p className="mb-1 uppercase tracking-widest text-white/50">
            AI difficulty{humansCount === 4 ? " (no AI seats)" : ""}
          </p>
          <div className="flex gap-1">
            {(["easy", "normal", "hard", "expert"] as const).map((d) => (
              <button
                key={d}
                disabled={humansCount === 4}
                onClick={() => useSettings.getState().update({ difficulty: d })}
                className={`flex-1 py-1.5 text-sm font-semibold capitalize ${
                  difficulty === d ? "btn-primary" : "btn-ghost"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <input
          value={seedInput}
          onChange={(e) => setSeedInput(e.target.value)}
          placeholder="seed (optional)"
          className="counter w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm font-medium placeholder:!font-sans placeholder:text-white/25"
        />

        <button onClick={() => go(seedInput)} className="btn-primary w-full py-3 text-lg">
          START GAME
        </button>
        <button onClick={() => setTutorialOpen(true)} className="btn-ghost w-full rounded-xl py-2">Tutorial</button>
        <button onClick={() => setStatsOpen(true)} className="btn-ghost w-full rounded-xl py-2">Statistics</button>
        <button onClick={() => setRulesOpen(true)} className="btn-ghost w-full rounded-xl py-2">Rules</button>
      </div>

      {/* quick settings */}
      <div className="slab mb-auto flex items-center gap-4 px-4 py-2 text-xs text-[#9aa3b5]">
        <label className="flex items-center gap-2">
          Sound
          <input type="checkbox" checked={audioEnabled} onChange={(e) => useSettings.getState().update({ audioEnabled: e.target.checked })} />
        </label>
        <label className="flex items-center gap-1">
          Vol
          <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => useSettings.getState().update({ volume: +e.target.value })} />
        </label>
        <label className="flex items-center gap-1">
          Claim window {claimWindowSeconds}s
          <input type="range" min={3} max={12} step={1} value={claimWindowSeconds} onChange={(e) => useSettings.getState().update({ claimWindowSeconds: +e.target.value })} />
        </label>
      </div>

      {statsOpen && <StatisticsModal onClose={() => setStatsOpen(false)} />}
      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} state={null} />
      {tutorialOpen && <Tutorial onClose={() => { setTutorialOpen(false); useSettings.getState().update({ tutorialDone: true }); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statistics screen (§40)
// ---------------------------------------------------------------------------

export function StatisticsModal({ onClose }: { onClose(): void }) {
  const s = useSettings.getState().settings;
  const avg = averagePlacement(s);
  const rows: [string, string | number][] = [
    ["Games played", s.gamesPlayed],
    ["1st / 2nd / 3rd / 4th", `${s.firsts} / ${s.seconds} / ${s.thirds} / ${s.fourths}`],
    ["Average placement", avg ? avg.toFixed(2) : "—"],
    ["Total Pekojans", s.totalPekojans],
    ["Self-draw Pekojans", s.selfDrawPekojans],
    ["Discard Pekojans", s.discardPekojans],
    ["Highest hand", s.highestHand.toLocaleString()],
    ["Longest chain", s.longestChain ? `×${s.longestChain}` : "—"],
    ["Monochrome hands", s.monochromeHands],
    ["Bonus hands", s.bonusHands],
  ];
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4"
      onClick={onClose}
    >
      <motion.div className="slab w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="display mb-4 text-2xl text-[#e6b54a]">Statistics</h2>
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-t border-white/10">
                <td className="py-1.5 text-[#cfd4e0]">{k}</td>
                <td className="counter py-1.5 text-right text-[#e6b54a]">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={onClose} className="btn-primary mt-4 w-full rounded-xl py-2 font-bold">Close</button>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Tutorial (§35) — small digestible steps, never all at once.
// ---------------------------------------------------------------------------

const STEPS: [string, string][] = [
  ["Welcome!", "Four players, one deck of 100 cards, and points on the table. You and each rival hold seven cards."],
  ["Draw & discard", "Each turn: draw one card, discard one. When a hand completes, you get to shout about it."],
  ["Winning hands", "Collect three of the same character, or one card from every member of an active group."],
  ["One color pays", "If every card in the hand shares a color, the score jumps. Check the rules screen for exact numbers."],
  ["Bonus character ★", "One character per match is worth 90 extra points for each copy used in a winning hand."],
  ["Self-draw", "Complete a hand from your own draw and all three rivals split the payment."],
  ["Claims", "A rival's discard can finish your hand. Call PEKOJAN and its owner pays the whole bill."],
  ["The game goes on", "A declared hand leaves your cards and replacements arrive at once. Nothing resets."],
  ["Chains", "Those replacement draws can complete another hand immediately. Keep going."],
  ["Passing is legal", "A modest hand can be declined if you are chasing something bigger. No penalty."],
  ["The end", "Someone hits zero points or the deck runs dry. Highest score wins."],
];

function Tutorial({ onClose }: { onClose(): void }) {
  const [step, setStep] = useState(0);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] grid place-items-center bg-black/85 p-4">
      <motion.div key={step} initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="slab w-full max-w-md p-6">
        <p className="label !text-[#ff4d6d]">Tutorial {step + 1} / {STEPS.length}</p>
        <h3 className="display mt-1 text-xl text-[#f3ecd9]">{STEPS[step][0]}</h3>
        <p className="mt-2 min-h-[64px] leading-relaxed text-white/80">{STEPS[step][1]}</p>
        <div className="mt-4 flex justify-between">
          <button disabled={step === 0} onClick={() => setStep(step - 1)} className="btn-ghost rounded-lg px-4 py-2 disabled:opacity-30">Back</button>
          {step === STEPS.length - 1 ? (
            <button onClick={onClose} className="btn-primary rounded-lg px-5 py-2 font-bold">Let's play!</button>
          ) : (
            <button onClick={() => setStep(step + 1)} className="btn-primary rounded-lg px-5 py-2 font-bold">Next</button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
