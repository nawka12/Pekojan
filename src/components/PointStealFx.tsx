import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { GameState } from "../game/types";
import { useGame } from "../store/game";
import { useSettings } from "../store/settings";
import { play } from "../audio/sfx";

// ---------------------------------------------------------------------------
// PointStealFx — the "steal" moment made visible.
//
// The engine only ever moves points inside settlePayments() during a Pekojan
// resolution, so diffing consecutive score snapshots is a complete,
// authoritative source of payment edges (post-clamp amounts). When seats lose
// points, coins arc from every payer's seat into the winner's seat with
// −N / +N markers pinned to each anchor. Anchors follow the seat rotation,
// so the flight is always correct for the current viewer's table layout.
// ---------------------------------------------------------------------------

const COINS_PER_PAYER = 6;
const COIN_STAGGER_S = 0.07;
const TRAVEL_S = 0.85;
const LEAD_IN_S = 0.15;

/** Seat anchors as viewport fractions; index is position relative to viewer. */
const SEAT_ANCHORS = [
  { x: 0.5, y: 0.88 }, // bottom — the revealed player
  { x: 0.87, y: 0.46 }, // right
  { x: 0.5, y: 0.15 }, // top
  { x: 0.13, y: 0.46 }, // left
] as const;

interface Anchor {
  x: number;
  y: number;
}

interface FlightEdge {
  playerId: number;
  amount: number;
  from: Anchor;
}

interface FlightGroup {
  id: number;
  edges: FlightEdge[];
  toPlayerId: number;
  to: Anchor;
  total: number;
  fast: boolean;
  reduced: boolean;
  /** ms until the last coin reaches the winner */
  arrivalMs: number;
}

function seatAnchor(playerId: number, revealedFor: number): Anchor {
  return SEAT_ANCHORS[(playerId - revealedFor + 4) % 4];
}

export function PointStealFx({ state }: { state: GameState }) {
  const revealedFor = useGame((s) => s.revealedFor);
  const speed = useSettings((s) => s.settings.animationSpeed);
  const [groups, setGroups] = useState<FlightGroup[]>([]);
  const nextId = useRef(0);
  const snapshot = useRef<{ scores: number[]; phase: GameState["phase"] } | null>(null);
  // anchors are captured at creation; a ref keeps that read out of the deps
  const anchorCtx = useRef(revealedFor);
  anchorCtx.current = revealedFor;

  useEffect(() => {
    const prev = snapshot.current;
    snapshot.current = { scores: state.players.map((p) => p.score), phase: state.phase };
    // a match (re)start resets every score — that is not a theft
    if (!prev || prev.phase === "SETUP" || prev.phase === "DEALING") return;

    let toPlayerId = -1;
    let total = 0;
    for (const p of state.players) {
      const delta = p.score - prev.scores[p.id];
      if (delta > 0) {
        toPlayerId = p.id;
        total += delta;
      }
    }
    const edges: FlightEdge[] = [];
    for (const p of state.players) {
      const delta = prev.scores[p.id] - p.score;
      if (delta > 0) {
        edges.push({ playerId: p.id, amount: delta, from: seatAnchor(p.id, anchorCtx.current) });
      }
    }
    if (toPlayerId < 0 || edges.length === 0 || total === 0) return;

    const fast = speed === "fast";
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const f = fast ? 0.6 : 1;
    const arrivalMs =
      (LEAD_IN_S + edges.length * COINS_PER_PAYER * COIN_STAGGER_S + TRAVEL_S) * f * 1000;
    const group: FlightGroup = {
      id: nextId.current++,
      edges,
      toPlayerId,
      to: seatAnchor(toPlayerId, anchorCtx.current),
      total,
      fast,
      reduced,
      arrivalMs,
    };
    setGroups((g) => [...g, group]);
    // each group removes itself once the last marker has faded
    setTimeout(() => setGroups((g) => g.filter((x) => x.id !== group.id)), arrivalMs + 1100);

    const { audioEnabled, volume } = useSettings.getState().settings;
    if (audioEnabled) {
      setTimeout(() => play("score", volume), arrivalMs - 250);
    }
  }, [state, speed]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[45] overflow-hidden" aria-hidden>
      {groups.map((g) => (
        <div key={g.id}>
          {g.edges.map((e, i) => (
            <PayerEdge key={e.playerId} edge={e} group={g} edgeIndex={i} />
          ))}
          <WinnerBurst group={g} />
        </div>
      ))}
    </div>
  );
}

/** −N marker over the payer's seat plus the arcing coin stream. */
function PayerEdge({
  edge,
  group,
  edgeIndex,
}: {
  edge: FlightEdge;
  group: FlightGroup;
  edgeIndex: number;
}) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const dx = (group.to.x - edge.from.x) * vw;
  const dy = (group.to.y - edge.from.y) * vh;
  // hold until its coins land (plus a beat), but never past the group's fade
  const holdMs = Math.min((arrivalOf(group, edgeIndex) + 0.5) * 1000, group.arrivalMs + 400);

  return (
    <>
      <motion.div
        className="absolute"
        style={{ left: `${edge.from.x * 100}%`, top: `${edge.from.y * 100}%` }}
      >
        <motion.span
          className="counter absolute -translate-x-1/2 text-lg font-bold text-[#ff4d6d]"
          style={{ textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}
          initial={{ opacity: 0, y: 4, scale: 0.7 }}
          animate={{
            opacity: [0, 1, 1, 0],
            y: [4, 0, -6, -20],
            scale: [0.7, 1.1, 1, 0.95],
          }}
          transition={{ duration: holdMs / 1000, times: [0, 0.12, 0.7, 1], ease: "easeOut" }}
        >
          −{edge.amount.toLocaleString()}
        </motion.span>
      </motion.div>
      {!group.reduced &&
        Array.from({ length: COINS_PER_PAYER }).map((_, i) => (
          <Coin key={i} edge={edge} group={group} edgeIndex={edgeIndex} coinIndex={i} dx={dx} dy={dy} />
        ))}
    </>
  );
}

/** When this edge's coin #0 lands, in seconds (used to time markers). */
function arrivalOf(group: FlightGroup, edgeIndex: number): number {
  return (
    LEAD_IN_S + edgeIndex * COINS_PER_PAYER * COIN_STAGGER_S * (group.fast ? 0.6 : 1) + TRAVEL_S * (group.fast ? 0.6 : 1)
  );
}

function Coin({
  edge,
  group,
  edgeIndex,
  coinIndex,
  dx,
  dy,
}: {
  edge: FlightEdge;
  group: FlightGroup;
  edgeIndex: number;
  coinIndex: number;
  dx: number;
  dy: number;
}) {
  const f = group.fast ? 0.6 : 1;
  const delay = LEAD_IN_S + (edgeIndex * COINS_PER_PAYER + coinIndex) * COIN_STAGGER_S * f;
  // a gentle sideways bow so the stream reads as an arc, not a laser
  const bow = (coinIndex % 2 === 0 ? 1 : -1) * (26 + coinIndex * 9);
  const lift = -30 - coinIndex * 12;
  const jitter = ((coinIndex * 53 + edgeIndex * 29) % 21) - 10;

  return (
    <motion.span
      className="absolute h-3 w-3 rounded-full border border-[#f8e7bd]/70 bg-[#e6b54a]"
      style={{
        left: `${edge.from.x * 100}%`,
        top: `${edge.from.y * 100}%`,
        boxShadow: "0 0 10px rgba(230,181,74,0.55)",
      }}
      initial={{ x: 0, y: 0, opacity: 0, scale: 0.6, rotate: 0 }}
      animate={{
        x: [0, dx * 0.5 + bow, dx + jitter],
        y: [0, dy * 0.5 + lift, dy],
        opacity: [0, 1, 1, 0],
        scale: [0.6, 1, 1, 0.5],
        rotate: [0, 200, 420 + jitter * 3],
      }}
      transition={{
        duration: TRAVEL_S * f + 0.15,
        delay,
        times: [0, 0.45, 0.9, 1],
        ease: "easeInOut",
      }}
    />
  );
}

/** +N marker and a ring pulse where the coins land. */
function WinnerBurst({ group }: { group: FlightGroup }) {
  const at = group.arrivalMs / 1000;
  const hold = Math.max(0.9, at * 0.5);

  return (
    <motion.div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${group.to.x * 100}%`, top: `${group.to.y * 100}%` }}
    >
      {!group.reduced && (
        <motion.span
          className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#e6b54a]"
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: [0.3, 1.5], opacity: [0, 0.8, 0] }}
          transition={{ duration: 0.6, delay: at, ease: "easeOut" }}
        />
      )}
      <motion.span
        className="counter absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-2xl font-bold text-[#e6b54a]"
        style={{ textShadow: "0 0 16px rgba(230,181,74,0.6), 0 1px 8px rgba(0,0,0,0.8)" }}
        initial={{ opacity: 0, scale: 0.5, y: 10 }}
        animate={{
          opacity: [0, 1, 1, 0],
          scale: [0.5, 1.25, 1, 1],
          y: [10, 0, -6, -16],
        }}
        transition={{
          duration: hold,
          delay: group.reduced ? 0.2 : at,
          times: [0, 0.15, 0.7, 1],
          ease: "easeOut",
        }}
      >
        +{group.total.toLocaleString()}
      </motion.span>
    </motion.div>
  );
}
