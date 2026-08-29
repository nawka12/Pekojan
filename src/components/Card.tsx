import { useRef } from "react";
import { motion } from "framer-motion";
import type { Card as CardT } from "../game/types";
import { getCharacter, getGroup } from "../data/characters";

/*
 * Card face follows the reference layout:
 *  - full-bleed color field per card color
 *  - large bold white index numeral, top-left + inverted bottom-right
 *  - character portrait center (emoji placeholder until real art)
 *  - "Gen" style group label bottom-left, name top-right
 *
 * The corner mark is the GROUP SIGN (like "0" on an AZKi 0th-gen card),
 * paired with the group name bottom-left.
 */

export const SPINE: Record<CardT["color"], string> = {
  pink: "#d95587",
  blue: "#4b93b8",
  orange: "#d98a2f",
};

/** Full-bleed face fields, bright at the top fading deep at the bottom. */
const FIELD: Record<CardT["color"], { bg: string; deep: string }> = {
  pink: { bg: "#ff9cc4", deep: "#e8448f" },
  blue: { bg: "#8ed1f7", deep: "#2e79c0" },
  orange: { bg: "#ffcf8f", deep: "#df7c1c" },
};

/** Deterministic little rotation for discard scatter — piles, not grids. */
export function scatterOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 15) - 7) * 0.9;
}

const SIZES = {
  xs: { w: 34, h: 48, idx: 13, emoji: 20, name: 0, gen: 0 },
  sm: { w: 50, h: 70, idx: 18, emoji: 30, name: 7, gen: 6 },
  md: { w: 66, h: 96, idx: 24, emoji: 42, name: 8, gen: 7 },
  lg: { w: 82, h: 120, idx: 30, emoji: 54, name: 10, gen: 9 },
} as const;

export interface CardProps {
  card: CardT;
  faceDown?: boolean;
  selected?: boolean;
  /** blinking border: this card is one card away from completing a hand */
  hot?: boolean;
  /** grey reference chip (table hints) — never looks like a card in play */
  neutral?: boolean;
  size?: keyof typeof SIZES;
  showBonus?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onInspect?: () => void;
  className?: string;
}

export function Card({
  card,
  faceDown,
  selected,
  hot,
  neutral,
  size = "md",
  showBonus,
  onClick,
  onDoubleClick,
  onInspect,
  className = "",
}: CardProps) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const startPress = () => {
    if (!onInspect) return;
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      onInspect();
    }, 480);
  };
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  if (faceDown) {
    return (
      <div className={`card-back ${className}`} style={{ width: SIZES[size].w, height: SIZES[size].h }}>
        <div className="grid h-full place-items-center">
          <span className="display text-lg text-[#e6b54a]/70">P</span>
        </div>
      </div>
    );
  }

  const s = SIZES[size];
  const ch = getCharacter(card.characterId);
  const group = getGroup(card.groupId);
  const accent = neutral ? "#aeb6c4" : SPINE[card.color];
  const field = neutral
    ? { bg: "#4a505c", deep: "#272b33" }
    : FIELD[card.color];

  const IndexMark = ({ flip }: { flip?: boolean }) => (
    <span
      className="absolute leading-none"
      style={{
        fontSize: s.idx * (group.symbol.length > 2 ? 0.62 : group.symbol.length > 1 ? 0.8 : 1),
        color: "#fff",
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontStyle: "italic",
        [flip ? "right" : "left"]: 3,
        [flip ? "bottom" : "top"]: 1,
        transform: flip ? "rotate(180deg)" : undefined,
        textShadow: "0 1px 3px rgba(0,0,0,0.35)",
      }}
    >
      {group.symbol}
    </span>
  );

  return (
    <motion.button
      type="button"
      layoutId={card.id}
      whileHover={size === "md" || size === "lg" ? { y: -6 } : undefined}
      whileTap={{ scale: 0.97 }}
      onClick={() => {
        if (!longPressed.current) onClick?.();
        longPressed.current = false;
      }}
      onDoubleClick={onDoubleClick}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onContextMenu={(e) => {
        e.preventDefault();
        onInspect?.();
      }}
      className={`card-face relative shrink-0 cursor-pointer overflow-hidden text-left transition-shadow ${className}`}
      style={{
        width: s.w,
        height: s.h,
        borderRadius: 8,
        background: `linear-gradient(180deg, ${field.bg} 0%, ${field.deep} 100%)`,
        border: "1px solid rgba(255,255,255,0.55)",
        boxShadow: selected
          ? "0 0 0 2px #fff, 0 0 16px rgba(255,255,255,0.55), 0 6px 14px rgba(0,0,0,0.45)"
          : "0 4px 10px rgba(0,0,0,0.45)",
      }}
    >
      {/* diagonal sheen, like the reference scan */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(115deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 38%)",
        }}
      />

      {/* blinking border: one card away from completing a hand */}
      {hot && <span aria-hidden className="card-hot-ring" />}

      {/* corner indices */}
      <IndexMark />
      {size !== "xs" && <IndexMark flip />}

      {/* name, top-right */}
      {s.name > 0 && (
        <span
          className="absolute right-[4px] top-[3px] max-w-[58%] truncate text-right font-semibold"
          style={{
            fontSize: s.name,
            color: "#fff",
            textShadow: "0 1px 2px rgba(0,0,0,0.4)",
          }}
        >
          {ch.name}
        </span>
      )}

      {/* bonus stamp */}
      {showBonus && (
        <span
          className="absolute grid place-items-center rounded-full font-bold"
          style={{
            right: 3,
            top: s.name > 0 ? s.name + 4 : 4,
            width: s.idx * 0.8,
            height: s.idx * 0.8,
            fontSize: s.idx * 0.55,
            background: "#e6b54a",
            color: "#241b06",
            boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
          }}
          title="Bonus character"
        >
          ★
        </span>
      )}

      {/* portrait — emoji placeholder until real art is set on Character.image */}
      {ch.image ? (
        <img
          src={ch.image}
          alt={ch.name}
          draggable={false}
          className="pointer-events-none absolute select-none object-cover"
          style={{
            left: "50%",
            top: "47%",
            transform: "translate(-50%, -50%)",
            width: s.w - 10,
            height: s.h - 16,
            borderRadius: 5,
          }}
        />
      ) : (
        <span
          className="pointer-events-none absolute select-none whitespace-nowrap"
          style={{
            left: "50%",
            top: size === "xs" ? "44%" : "47%",
            transform: "translate(-50%, -50%)",
            // multi-emoji oshi marks (e.g. 🐾🩵) shrink so they stay inside the
            // card; ZWJ joiners/variation selectors are not visible glyphs
            fontSize:
              s.emoji *
              Math.min(
                1,
                1.5 /
                  Math.max(
                    1,
                    [...ch.emoji.replace(/\u200D/g, "").replace(/\uFE0F/g, "")].length
                  )
              ),
            lineHeight: 1,
            filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.35))",
          }}
        >
          {ch.emoji}
        </span>
      )}

      {/* group label, bottom-left */}
      {s.gen > 0 && (
        <span
          className="absolute bottom-[3px] left-[4px] font-bold uppercase"
          style={{
            fontSize: s.gen,
            color: "#fff",
            letterSpacing: "0.06em",
            textShadow: "0 1px 2px rgba(0,0,0,0.4)",
          }}
        >
          {group.shortLabel ?? group.name.replace("Group ", "")}
        </span>
      )}
    </motion.button>
  );
}
