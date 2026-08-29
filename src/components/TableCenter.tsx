import { motion } from "framer-motion";
import type { Card, CardColor, GameState } from "../game/types";
import { getCharacter } from "../data/characters";
import { Card as CardView } from "./Card";

/*
 * Table center: every indicator is a card graphic, matching the cards in
 * play — bonus character as a stamped card, each group as its row of
 * member cards (dimmed until you hold that member), deck as a card stack.
 */

const CHIP_COLORS: CardColor[] = ["pink", "blue", "orange"];

function chipCard(groupId: string, characterId: string, i: number): Card {
  return {
    id: `chip-${groupId}-${characterId}`,
    characterId,
    groupId,
    color: CHIP_COLORS[i % CHIP_COLORS.length],
  };
}

export function TableCenter({ state, viewer = 0 }: { state: GameState; viewer?: number }) {
  const bonus = getCharacter(state.bonusCharacterId);
  const myHand = state.players[viewer].hand;
  const bonusColor: CardColor =
    myHand.find((c) => c.characterId === bonus.id)?.color ?? "orange";

  return (
    <div className="felt flex flex-col items-center gap-3 px-4 py-3 sm:px-8">
      {/* bonus character — a stamped card, face up */}
      <div className="flex items-center gap-2">
        <motion.div
          animate={{ rotate: [-2.5, 2.5, -2.5] }}
          transition={{ repeat: Infinity, duration: 5, ease: "easeInOut" }}
        >
          <CardView
            card={{
              id: "chip-bonus",
              characterId: bonus.id,
              groupId: state.groups.find((g) => g.characterIds.includes(bonus.id))?.id ?? "",
              color: bonusColor,
            }}
            size="sm"
            neutral
            showBonus
          />
        </motion.div>
        <div
          className="rounded-lg px-2 py-1 text-center"
          style={{
            background: "linear-gradient(180deg, #f0c464, #b98a2e)",
            boxShadow: "0 3px 10px rgba(0,0,0,0.4)",
          }}
        >
          <p className="display text-[11px] leading-none text-[#241b06]">BONUS</p>
          <p className="counter text-[11px] text-[#241b06]/80">+90 / card</p>
        </div>
      </div>

      {/* active groups — member mini-cards */}
      <div className="flex max-w-full flex-wrap justify-center gap-2">
        {state.groups.map((g) => {
          const complete = g.characterIds.every((id) =>
            myHand.some((c) => c.characterId === id)
          );
          return (
            <div
              key={g.id}
              className="rounded-xl px-2 pt-1.5 pb-2"
              style={{
                background: "rgba(0,0,0,0.28)",
                border: `1px solid ${complete ? "rgba(230,181,74,0.75)" : "rgba(230,181,74,0.2)"}`,
              }}
            >
              <p
                className="label mb-1 !text-[9px] !leading-none"
                style={{ color: complete ? "#e6b54a" : "rgba(243,236,217,0.6)" }}
              >
                {g.symbol} · {g.name.replace("Group ", "")}
              </p>
              <div className="flex justify-center gap-0.5">
                {g.characterIds.map((id, i) => {
                  const held = myHand.some((c) => c.characterId === id);
                  return (
                    <div
                      key={id}
                      style={{
                        opacity: held ? 1 : 0.3,
                        transform: held ? "translateY(-2px)" : undefined,
                        transition: "all 0.25s",
                      }}
                      title={getCharacter(id).name}
                    >
                      <CardView card={chipCard(g.id, id, i)} size="xs" neutral />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* deck — card stack */}
      <div className="flex items-center gap-2.5">
        <div className="relative" style={{ width: 44, height: 62 }}>
          {[2, 1, 0].map((i) => (
            <div
              key={i}
              className="card-back absolute"
              style={{ width: 44, height: 62, left: i * 2, top: i * -2 }}
            />
          ))}
          <motion.span
            key={state.deck.length}
            initial={{ scale: 1.3 }}
            animate={{ scale: 1 }}
            className="counter absolute -right-2 -top-2 grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs"
            style={{ background: "#ff4d6d", color: "#fff" }}
          >
            {state.deck.length}
          </motion.span>
        </div>
        <p className="label" style={{ color: "rgba(243,236,217,0.6)" }}>
          draw pile
        </p>
      </div>
    </div>
  );
}
