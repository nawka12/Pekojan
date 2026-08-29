import { create } from "zustand";
import type { GameAction, GameState } from "../game/types";
import { createGame, IllegalActionError, reduce } from "../game/engine";
import { aiDecide } from "../ai";
import { useSettings } from "./settings";
import { play } from "../audio/sfx";

// ---------------------------------------------------------------------------
// The game store owns one in-flight match. Every mutation flows through
// reduce(state, action) so the same command stream could drive a future
// server-authoritative multiplayer session (rule doc §46).
// ---------------------------------------------------------------------------

/** Classic mode: shared spare time each player may spend across their turns. */
export const CLASSIC_COMPENSATION_SECONDS = 20;
/** Classic mode: base time before a seat's compensation pool starts draining. */
export const CLASSIC_TURN_BASE = { discard: 10, pekojan: 5 };

interface GameStore {
  state: GameState | null;
  debugOpen: boolean;
  /** Classic mode remaining spare time per seat */
  compensation: number[];
  /** when the current human decision turn started (classic mode) */
  turnStartedAt: number | null;
  /**
   * Hot-seat privacy: which human's hand the device is currently allowed
   * to show. Other humans' hands are never rendered; a pass-device screen
   * gates the transition between two different humans.
   */
  revealedFor: number;
  /**
   * Match-start roster reveal is on screen. The game is paused (no AI
   * moves, no classic clock) until a human dismisses it, so players get to
   * see which characters and which bonus character are in the deck.
   */
  revealOpen: boolean;
  start(seed?: string): void;
  dispatch(action: GameAction): void;
  dismissReveal(): void;
  revealFor(playerId: number): void;
  consumeCompensation(playerId: number, seconds: number): void;
  claimWindowOpenedAtMs(): number;
  setDebug(open: boolean): void;
}

let aiTimer: ReturnType<typeof setTimeout> | null = null;
let claimTimer: ReturnType<typeof setTimeout> | null = null;
let matchRecorded = false;
/** when the current claim window opened — measures human call speed */
let claimWindowOpenedAt = Number.POSITIVE_INFINITY;

function clearTimers() {
  if (aiTimer) clearTimeout(aiTimer);
  if (claimTimer) clearTimeout(claimTimer);
  aiTimer = claimTimer = null;
}

export const useGame = create<GameStore>((set, get) => {
  function schedule(s: GameState) {
    clearTimers();
    if (get().revealOpen) return; // paused on the match-start roster reveal
    if (s.phase === "GAME_OVER") {
      // settle statistics exactly once per match
      if (matchRecorded || !s.endReason) return;
      matchRecorded = true;
      recordMatchResult(s);
      return;
    }
    const fast = useSettings.getState().settings.animationSpeed === "fast";
    // AI pacing: a beat of "thinking" before each move so the table reads like
    // four humans playing. Slightly randomized so it doesn't feel mechanical.
    const thinkDelay = fast ? 600 : 1600 + Math.random() * 400;

    const isHumanDecision =
      (s.phase === "SELF_PEKOJAN_DECISION" || s.phase === "DISCARDING") &&
      s.players[s.currentPlayer].isHuman;
    if (isHumanDecision) return; // wait for input

    if (s.phase === "SELF_PEKOJAN_DECISION" || s.phase === "DISCARDING") {
      const decision = aiDecide(s, s.currentPlayer);
      console.log("[sched]", s.phase, "cur", s.currentPlayer, "decision", decision?.action.type ?? null);
      if (decision) {
        aiTimer = setTimeout(() => {
          console.log("[timer fired]", s.phase, s.currentPlayer);
          get().dispatch(decision.action);
        }, thinkDelay);
      }
      return;
    }

    if (s.phase === "DISCARD_CLAIM_WINDOW") {
      const [nextAwaiting] = s.awaitingClaims;
      if (nextAwaiting === undefined) return;
      const claimant = s.players[nextAwaiting];
      if (claimant.isHuman) {
        // The configurable claim window is a freestyle feature. In classic
        // mode the claim decision runs on the claimant's clock (pekojan base
        // + compensation pool, force-passed by ClassicTurnTimer on expiry),
        // per the declared game-mode timings.
        if (useSettings.getState().settings.gameMode !== "classic") {
          const secs = useSettings.getState().settings.claimWindowSeconds;
          claimTimer = setTimeout(() => {
            get().dispatch({ type: "PASS_CLAIM", playerId: nextAwaiting });
          }, secs * 1000);
        }
        return;
      }
      const decision = aiDecide(s, nextAwaiting);
      if (decision) {
        aiTimer = setTimeout(() => get().dispatch(decision.action), fast ? 400 : 900 + Math.random() * 300);
      }
    }
  }

  return {
    state: null,
    debugOpen: false,
    compensation: [20, 20, 20, 20],
    turnStartedAt: null,
    revealedFor: 0,
    revealOpen: false,
    start(seed?: string) {
      clearTimers();
      matchRecorded = false;
      const finalSeed = seed ?? `PK-${Date.now().toString(36).toUpperCase()}`;
      const { difficulty, humansCount, seatNames } = useSettings.getState().settings;
      const humanSeats = [0, 1, 2, 3].slice(0, Math.max(1, Math.min(4, humansCount)));
      const names = [0, 1, 2, 3].map((i) => {
        const given = seatNames[i]?.trim();
        if (given) return given;
        if (humanSeats.includes(i)) {
          return humansCount === 1 && i === 0 ? "You" : `Player ${i + 1}`;
        }
        return ["Kotone", "Hibari", "Nodoka"][i - 1] ?? `AI ${i}`;
      }) as [string, string, string, string];
      const s = createGame({
        seed: finalSeed,
        seatNames: names,
        humanSeats,
        aiDifficulty: difficulty,
      });
      useSettings.getState().update({ lastSeed: finalSeed });
      set({
        state: s,
        revealedFor: humanSeats[0],
        compensation: [20, 20, 20, 20],
        // the classic clock must not run while the roster reveal is up —
        // the reveal is paused game time, not part of the first turn
        turnStartedAt: null,
        revealOpen: true,
      });
      schedule(s); // no-ops until dismissReveal()
    },
    dismissReveal() {
      if (!get().revealOpen) return;
      const s = get().state;
      set({
        revealOpen: false,
        turnStartedAt: s ? humanTurnStart(s) : null,
      });
      if (s) schedule(s);
    },
    consumeCompensation(playerId, seconds) {
      const pool = [...get().compensation];
      pool[playerId] = Math.max(0, pool[playerId] - Math.max(0, seconds));
      set({ compensation: pool });
    },
    revealFor(playerId) {
      // CLASSIC: the turn clock must not run while the device is being passed.
      // Restart it when the player takes over so they get their full budget.
      const s = get().state;
      let turnStartedAt = get().turnStartedAt;
      if (
        useSettings.getState().settings.gameMode === "classic" &&
        s &&
        humanDecisionActor(s) === playerId
      ) {
        turnStartedAt = Date.now();
      }
      set({ revealedFor: playerId, turnStartedAt });
    },
    claimWindowOpenedAtMs() {
      return claimWindowOpenedAt;
    },
    dispatch(action) {
      const current = get().state;
      if (!current) return;
      if (get().revealOpen) {
        // the roster reveal pauses the match — nothing may move underneath it
        console.warn("action ignored while roster reveal is open", action);
        return;
      }
      clearTimers();

      // CLASSIC: account spare-time usage the instant a human acts — this must
      // happen before any state change so render ordering can never erase it.
      if (
        useSettings.getState().settings.gameMode === "classic" &&
        get().turnStartedAt !== null
      ) {
        const actor = humanDecisionActor(current);
        const actionPlayerId = "playerId" in action ? action.playerId : undefined;
        if (
          actor !== null &&
          actionPlayerId === actor &&
          (action.type === "DISCARD" ||
            action.type === "DECLARE_PEKOJAN" ||
            action.type === "PASS_PEKOJAN" ||
            action.type === "CLAIM_DISCARD" ||
            action.type === "PASS_CLAIM")
        ) {
          const spent = (Date.now() - get().turnStartedAt!) / 1000;
          const base =
            current.phase === "DISCARDING" ? CLASSIC_TURN_BASE.discard : CLASSIC_TURN_BASE.pekojan;
          const excess = Math.max(0, spent - base);
          if (excess > 0.05) get().consumeCompensation(actor, excess);
        }
      }
      try {
        const next = reduce(current, action);
        // timestamp claim windows so human calls can be measured for ties
        if (next.phase === "DISCARD_CLAIM_WINDOW" && current.phase !== "DISCARD_CLAIM_WINDOW") {
          claimWindowOpenedAt = performance.now();
        }
        set({
          state: next,
          turnStartedAt: humanTurnStart(next),
        });
        emitSound(action, next);
        schedule(next);
      } catch (e) {
        if (e instanceof IllegalActionError) {
          console.warn("illegal action ignored", action, e.message);
          schedule(current); // restore pacing
          return;
        }
        throw e;
      }
    },
    setDebug(open) {
      set({ debugOpen: open });
    },
  };
});

/** The human seat owing a timed decision, if any. In classic mode the
 *  discard-claim decision is a pekojan-turn decision on the claimant's
 *  clock (README game-mode timings), so it counts here too. */
function humanDecisionActor(s: GameState): number | null {
  if (s.phase === "SELF_PEKOJAN_DECISION" || s.phase === "DISCARDING") {
    return s.players[s.currentPlayer].isHuman ? s.currentPlayer : null;
  }
  if (s.phase === "DISCARD_CLAIM_WINDOW") {
    const claimant = s.awaitingClaims.find((id) => s.players[id].isHuman);
    return claimant ?? null;
  }
  return null;
}

/** Start the classic turn clock iff the state rests on a human decision. */
function humanTurnStart(s: GameState): number | null {
  return humanDecisionActor(s) !== null ? Date.now() : null;
}

function recordMatchResult(s: GameState) {
  // The first human seat's placement + aggregate stats snapshot into storage.
  const store = useSettings.getState();
  const ranked = [...s.players].sort((a, b) => b.score - a.score);
  const meSeat = s.players.find((p) => p.isHuman) ?? s.players[0];
  const place = ranked.findIndex((p) => p.id === meSeat.id) + 1;
  const me = meSeat;
  const monochrome = me.melds.filter((m) =>
    m.cards.every((c) => c.color === m.cards[0].color)
  ).length;
  const bonusHands = me.melds.filter((m) =>
    m.cards.some((c) => c.characterId === s.bonusCharacterId)
  ).length;
  store.recordMatch(place, {
    pekojans: me.pekojans,
    selfDrawWins: me.selfDrawWins,
    discardWins: me.discardWins,
    largestHand: me.largestHand,
    longestChain: me.longestChain,
    monochrome,
    bonusHands,
  });
}

function emitSound(action: GameAction, s: GameState) {
  const { audioEnabled, volume } = useSettings.getState().settings;
  if (!audioEnabled) return;
  switch (action.type) {
    case "DISCARD":
      play("discard", volume);
      break;
    case "DECLARE_PEKOJAN":
      play(s.recentPekojan && s.recentPekojan.breakdown.totalScore >= 480 ? "large" : "pekojan", volume);
      break;
    case "CLAIM_DISCARD":
      play("chain", volume);
      break;
    default:
      play(s.lastDraw ? "draw" : "button", Math.min(volume, 0.25));
  }
}
