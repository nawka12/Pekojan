import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { GameState } from "../game/types";
import { Card } from "./Card";
import { CandidateRowHelpers } from "./overlayBits";
import { useSettings } from "../store/settings";

/**
 * Full-screen Pekojan celebration.
 *
 * The engine keeps `recentPekojan` in state permanently (for debugging),
 * and every reduce() clones it with a new object identity — so visibility
 * must NOT be tied to object identity or a store boolean. Instead each
 * Pekojan carries a unique `seq`; we celebrate each seq exactly once and
 * auto-hide after a short duration. Subsequent actions can never resurrect it.
 */
export function PekojanOverlay({ state }: { state: GameState }) {
  const recent = state.recentPekojan;
  const speed = useSettings((s) => s.settings.animationSpeed);
  const [visibleSeq, setVisibleSeq] = useState<number | null>(null);
  const handledSeq = useRef(-1);

  useEffect(() => {
    const seq = recent?.seq;
    if (seq === undefined || handledSeq.current === seq) return;
    handledSeq.current = seq;
    setVisibleSeq(seq);
    const duration = Math.min(2600, 1100 + (recent!.cards.length || 3) * 220) * (speed === "fast" ? 0.55 : 1);
    const t = setTimeout(() => setVisibleSeq(null), duration);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent?.seq]);

  const visible = visibleSeq !== null && recent?.seq === visibleSeq;
  const isClaim = recent?.claim === "discard";

  return (
    <AnimatePresence>
      {visible && recent && (
        <motion.div
          key="pekojan"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
          className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-black/60"
        >
          {/* keyed by seq: a chained Pekojan remounts the CONTENT (replaying
              its entrance) while the AnimatePresence child itself stays put —
              swapping the outer key mid-flight overlaps exit+enter and is the
              pattern that leaves stuck/broken animation nodes behind */}
          <div key={recent.seq} className="relative flex flex-col items-center gap-3">
            <motion.div
              initial={{ scale: 0.4, rotate: -6, opacity: 0 }}
              animate={{ scale: 1, rotate: -2, opacity: 1 }}
              transition={{ type: "spring", stiffness: 240, damping: 14 }}
              className="text-center"
            >
              <p className="display text-5xl text-[#ff4d6d] sm:text-7xl" style={{ textShadow: "0 0 24px rgba(255,77,109,0.5)" }}>
                PEKOJAN
              </p>
              {recent.chainIndex > 1 && (
                <motion.p
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.15 }}
                  className="display mt-1 text-2xl text-[#e6b54a]"
                >
                  CHAIN ×{recent.chainIndex}
                </motion.p>
              )}
            </motion.div>

            {/* winning cards */}
            <div className="flex gap-2">
              {recent.cards.map((c, i) => (
                <motion.div
                  key={c.id}
                  initial={{ y: 120, rotate: 8, opacity: 0 }}
                  animate={{ y: 0, rotate: i % 2 ? 3 : -3, opacity: 1 }}
                  transition={{ delay: 0.12 + i * 0.09, type: "spring", stiffness: 200 }}
                >
                  <Card card={c} size="lg" />
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="slab px-5 py-2 text-center"
            >
              <p className="label">
                {state.players[recent.playerId].name} · {isClaim ? "claim!" : "self-draw"}{" "}
                {recent.breakdown.sameColor ? "· monochrome ★" : ""}
              </p>
              <p className="counter text-3xl text-[#e6b54a]">
                +{recent.breakdown.totalScore.toLocaleString()}
              </p>
              <CandidateRowHelpers breakdown={recent.breakdown} />
            </motion.div>

            {/* confetti burst */}
            {Array.from({ length: 18 }).map((_, i) => (
              <motion.span
                key={i}
                className={`absolute h-2 w-2 rounded-sm ${["bg-[#ff4d6d]", "bg-[#4b93b8]", "bg-[#e6b54a]", "bg-[#f3ecd9]"][i % 4]}`}
                initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                animate={{
                  x: Math.cos((i / 26) * Math.PI * 2) * (160 + (i % 7) * 30),
                  y: Math.sin((i / 26) * Math.PI * 2) * (140 + (i % 5) * 34),
                  opacity: 0,
                  scale: 0.4,
                  rotate: i * 37,
                }}
                transition={{ duration: 1.4, delay: 0.25, ease: "easeOut" }}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
