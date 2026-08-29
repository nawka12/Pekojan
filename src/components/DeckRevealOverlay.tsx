import { motion } from "framer-motion";
import { useGame } from "../store/game";
import { useSettings } from "../store/settings";
import { Card } from "./Card";
import { getCharacter } from "../data/characters";
import { play } from "../audio/sfx";
import type { CardColor } from "../game/types";

/**
 * Match-start roster reveal: before the first turn, the deck's characters
 * (one sample card each, cycling the three colors) and the bonus character
 * are laid on the table. The store pauses the match (no AI moves, no classic
 * clock) until a human dismisses it.
 */
export function DeckRevealOverlay() {
  const state = useGame((s) => s.state);
  const speed = useSettings((s) => s.settings.animationSpeed);
  const volume = useSettings((s) => s.settings.volume);
  if (!state) return null;

  const k = speed === "fast" ? 0.55 : 1;
  const characters = state.groups.flatMap((g) => g.characterIds);
  const bonusChar = getCharacter(state.bonusCharacterId);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] overflow-y-auto"
      style={{ background: "var(--color-night)" }}
    >
      <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center gap-5 px-4 py-6">
        <motion.div
          initial={{ y: -24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.35 * k }}
          className="text-center"
        >
          <h2
            className="display text-4xl text-[#e6b54a]"
            style={{ textShadow: "0 0 24px rgba(230,181,74,0.35)" }}
          >
            THE DECK IS SET
          </h2>
          <p className="label mt-2 !text-[11px]">
            {state.groups.length} groups · {characters.length} characters · 100 cards in play
          </p>
        </motion.div>

        <div className="w-full space-y-4">
          {state.groups.map((g, gi) => (
            <motion.div
              key={g.id}
              initial={{ y: 14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: (0.15 + gi * 0.1) * k, duration: 0.3 * k }}
              className="slab px-4 py-3"
            >
              <p className="label mb-2 flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded bg-[#e6b54a] font-serif text-[11px] font-bold italic text-[#241b06]">
                  {g.symbol}
                </span>
                {g.name}
                {g.characterIds.some((id) => id === state.bonusCharacterId) && (
                  <span className="ml-auto !text-[#e6b54a]">bonus ★</span>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {g.characterIds.map((charId, ci) => {
                  const isBonus = charId === state.bonusCharacterId;
                  const sample = {
                    id: `reveal-${charId}`,
                    characterId: charId,
                    groupId: g.id,
                    color: (["pink", "blue", "orange"] as CardColor[])[(gi + ci) % 3],
                  };
                  return (
                    <motion.div
                      key={charId}
                      initial={{ rotateY: 90, opacity: 0 }}
                      animate={{ rotateY: 0, opacity: 1 }}
                      transition={{
                        delay: (0.3 + gi * 0.35 + ci * 0.06) * k,
                        type: "spring",
                        stiffness: 260,
                        damping: 20,
                      }}
                      className={isBonus ? "relative" : ""}
                    >
                      {isBonus && (
                        <motion.span
                          aria-hidden
                          className="pointer-events-none absolute -inset-1.5 rounded-[10px] border-2 border-[#e6b54a]"
                          animate={{ opacity: [1, 0.3, 1] }}
                          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                        />
                      )}
                      <div
                        className="rounded-lg p-0.5"
                        style={
                          isBonus
                            ? {
                                background: "linear-gradient(180deg,#f0c464,#b98a2e)",
                                boxShadow: "0 0 18px rgba(230,181,74,0.5)",
                              }
                            : undefined
                        }
                      >
                        <Card card={sample} size="sm" showBonus={isBonus} />
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.9 * k, duration: 0.3 * k }}
          className="slab w-full px-5 py-4 text-center"
        >
          <p className="display text-lg text-[#e6b54a]">
            BONUS CHARACTER — {bonusChar.name} ★
          </p>
          <p className="mt-1 text-sm leading-relaxed text-white/70">
            Every copy of {bonusChar.name} used in a winning hand scores{" "}
            <b className="counter text-[#e6b54a]">+90</b>.
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[#9aa3b5]">
            Each character has 9 cards (3 per color) — exactly 100 of them are
            in this match, the rest never exist here.
          </p>
          <button
            onClick={() => {
              play("button", volume);
              useGame.getState().dismissReveal();
            }}
            className="btn-primary mt-4 px-10 py-3 text-base"
          >
            LET'S PLAY
          </button>
        </motion.div>
      </div>
    </motion.div>
  );
}