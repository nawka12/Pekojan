import type {
  Card,
  ClaimResponse,
  Difficulty,
  GameAction,
  GameState,
  Group,
  PlayerState,
  PekojanCandidate,
} from "./types";
import { buildMatchDeck, HAND_SIZE, PLAYER_COUNT } from "./deck";
import { findValidPekojans } from "./hands";
import { hashSeed, makeRng } from "./rng";
import { settlePayments } from "./payments";
import { computeClaimEligibility, turnDistance } from "./claims";
import { tableScore } from "./scoring";
import { GROUPS, CHARACTERS } from "../data/characters";

// ---------------------------------------------------------------------------
// Pekojan engine — explicit state machine (rule doc §29) built on
// serializable actions (§46). reduce() is pure: (state, action) -> new state.
//
// Automatic transitions are settled eagerly inside reduce(); the returned
// state always rests at an input-required phase or GAME_OVER:
//   SELF_PEKOJAN_DECISION | DISCARDING | DISCARD_CLAIM_WINDOW | GAME_OVER
// Replaying createGame(seed) plus the sequence of decision actions fully
// reconstructs a match — server-authoritative multiplayer can adopt this
// reducer unchanged later.
// ---------------------------------------------------------------------------

export const SEAT_NAMES = ["You", "Kotone", "Hibari", "Nodoka"];

export interface CreateGameOptions {
  seed: string;
  /** display names for all four seats */
  seatNames?: [string, string, string, string];
  /** which seats are humans (offline multiplayer). Default: [0] */
  humanSeats?: number[];
  /** difficulty applied to every AI seat. Default "normal" */
  aiDifficulty?: Difficulty;
  /** legacy: per-AI-seat difficulties for seats 1..3 */
  difficulties?: [Difficulty, Difficulty, Difficulty];
}

function freshPlayer(
  id: number,
  name: string,
  isHuman: boolean,
  difficulty?: Difficulty
): PlayerState {
  return {
    id,
    name,
    isHuman,
    difficulty,
    score: 1000,
    hand: [],
    melds: [],
    discards: [],
    pekojans: 0,
    selfDrawWins: 0,
    discardWins: 0,
    largestHand: 0,
    pointsGained: 0,
    pointsLost: 0,
    dangerousDiscards: 0,
    longestChain: 0,
  };
}

/** Minimum total characters across the 4 participating groups. */
export const MIN_MATCH_CHARACTERS = 14;

/** Randomly select 4 participating groups: >=3 members each, exclusivity
 *  honored, and at least MIN_MATCH_CHARACTERS characters combined. */
export function selectMatchGroups(rng: ReturnType<typeof makeRng>): Group[] {
  const pool = [...GROUPS.filter((g) => g.characterIds.length >= 3)];
  let guard = 0;
  while (guard++ < 2000) {
    const picked: Group[] = [];
    while (picked.length < 4 && guard++ < 2000) {
      const g = pool[Math.floor(rng.next() * pool.length)];
      if (picked.includes(g)) continue;
      if (
        picked.some(
          (p) =>
            p.mutuallyExclusiveWith?.includes(g.id) ||
            g.mutuallyExclusiveWith?.includes(p.id)
        )
      ) {
        continue; // e.g. 1st Gen and Gamers (shared Fubuki) never co-exist
      }
      picked.push(g);
    }
    if (picked.length < 4) break;
    const total = picked.reduce((n, g) => n + g.characterIds.length, 0);
    if (total >= MIN_MATCH_CHARACTERS) return picked;
    // too few characters in play — redraw the whole selection
  }
  throw new Error("could not select a valid group set");
}

/**
 * §30 — the seed controls group selection, bonus character, the 100-card
 * subset, shuffle order and first player.
 */
export function createGame(opts: CreateGameOptions): GameState {
  const seed = opts.seed || `PK-${Date.now().toString(36).toUpperCase()}`;
  const rng = makeRng(hashSeed("pekojan:" + seed));
  const groups = selectMatchGroups(rng);
  const characterIds = groups.flatMap((g) => g.characterIds);
  const bonusCharacterId = characterIds[Math.floor(rng.next() * characterIds.length)];

  const { deck, excluded } = buildMatchDeck(groups, rng);

  const humans = new Set(opts.humanSeats ?? [0]);
  const aiSeats = [0, 1, 2, 3].filter((i) => !humans.has(i));
  const names = opts.seatNames ?? [...SEAT_NAMES] as [string, string, string, string];

  const players: PlayerState[] = [0, 1, 2, 3].map((id) =>
    freshPlayer(
      id,
      names[id] ?? SEAT_NAMES[id],
      humans.has(id),
      humans.has(id) ? undefined : opts.aiDifficulty ?? "normal"
    )
  );
  void aiSeats;

  for (const p of players) p.hand = deck.splice(0, HAND_SIZE); // 100 -> 72

  const firstPlayer = Math.floor(rng.next() * PLAYER_COUNT);

  const state: GameState = {
    seed,
    rngState: rng.state(),
    phase: "TURN_START",
    groups,
    characters: CHARACTERS.filter((c) => groups.some((g) => g.characterIds.includes(c.id))),
    poolExcluded: excluded,
    deck,
    players,
    currentPlayer: firstPlayer,
    firstPlayer,
    bonusCharacterId,
    drawnCardId: null,
    lastDraw: null,
    pendingClaims: [],
    awaitingClaims: [],
    claimResponses: {},
    discarderId: -1,
    postChain: "owner-discard",
    decisionCounter: 0,
    activeChain: 0,
    pekojanSeq: 0,
    recentPekojan: null,
    turnNumber: 1,
    endReason: null,
    log: [
      {
        turn: 0,
        text: `Match begins — ${groups.length} groups, bonus ${bonusCharacterId}. Player ${
          firstPlayer + 1
        } acts first.`,
        kind: "info",
      },
    ],
  };

  return settle(state);
}

// ---------------------------------------------------------------------------
// Internal helpers (operate on the mutable working copy created by reduce())
// ---------------------------------------------------------------------------

function log(s: GameState, text: string, kind: GameState["log"][number]["kind"] = "info") {
  s.log.push({ turn: s.turnNumber, text, kind });
}

function tryDrawOne(s: GameState, playerId: number): boolean {
  if (s.deck.length === 0) {
    gameOver(s, "deck-exhausted");
    return false;
  }
  const card = s.deck.shift()!;
  s.players[playerId].hand.push(card);
  s.lastDraw = { playerId, cardId: card.id };
  return true;
}

function gameOver(s: GameState, reason: NonNullable<GameState["endReason"]>) {
  s.phase = "GAME_OVER";
  s.endReason = reason;
  log(
    s,
    reason === "zero-score"
      ? `Game over — ${s.players.find((p) => p.score <= 0)?.name} hit 0 points.`
      : "Game over — the draw pile ran dry.",
    "end"
  );
}

function endGameIfZeroScore(s: GameState): boolean {
  if (s.players.some((p) => p.score <= 0)) {
    gameOver(s, "zero-score");
    return true;
  }
  return false;
}

function currentCandidates(s: GameState, who: number): PekojanCandidate[] {
  return findValidPekojans(s.players[who].hand, s.groups, s.bonusCharacterId);
}

function incrementWinStats(
  s: GameState,
  who: number,
  cand: PekojanCandidate,
  chainIndex: number,
  claim: "self-draw" | "discard"
) {
  const p = s.players[who];
  p.pekojans++;
  p.largestHand = Math.max(p.largestHand, cand.totalScore);
  if (claim === "self-draw") p.selfDrawWins++;
  else p.discardWins++;
  p.longestChain = Math.max(p.longestChain, chainIndex);
}

function beginOwnerTurnOptions(s: GameState, who: number) {
  // Decide between offering a Pekojan and moving straight to discarding.
  const candidates = currentCandidates(s, who);
  if (candidates.length > 0) {
    s.phase = "SELF_PEKOJAN_DECISION";
    s.decisionCounter++;
  } else {
    s.phase = "DISCARDING";
  }
}

/**
 * End of a resolution chain (after replacements were drawn):
 * offer another Pekojan (chaining!), or wrap up per the chain's post-mode.
 */
function advanceAfterReplacementDraw(s: GameState) {
  const who = s.currentPlayer;
  const candidates = currentCandidates(s, who);
  if (candidates.length > 0) {
    s.phase = "SELF_PEKOJAN_DECISION";
    s.decisionCounter++;
    return;
  }
  finishResolutionChain(s);
}

/** No more (willing) Pekojans — wrap up per the chain post-mode. */
function finishResolutionChain(s: GameState) {
  if (s.postChain === "owner-discard") {
    s.phase = "DISCARDING";
  } else {
    // A discard-claimer finished; play resumes clockwise after the discarder.
    const next = (s.discarderId + 1) % PLAYER_COUNT;
    s.currentPlayer = next;
    s.turnNumber++;
    s.activeChain = 0;
    s.postChain = "owner-discard";
    s.phase = "TURN_START";
  }
}

function startNextTurn(s: GameState) {
  s.pendingClaims = [];
  s.currentPlayer = (s.currentPlayer + 1) % PLAYER_COUNT;
  s.turnNumber++;
  s.activeChain = 0;
  s.postChain = "owner-discard";
  s.drawnCardId = null;
  s.lastDraw = null;
  s.phase = "TURN_START";
}

// ---------------------------------------------------------------------------
// Settlement routines
// ---------------------------------------------------------------------------

function executeSelfDrawPekojan(s: GameState, cand: PekojanCandidate) {
  const who = s.currentPlayer;
  const value = cand.totalScore;

  s.activeChain++;
  s.pekojanSeq++;
  s.recentPekojan = {
    seq: s.pekojanSeq,
    playerId: who,
    cards: [],
    breakdown: breakdownOf(cand),
    chainIndex: s.activeChain,
    claim: "self-draw",
  };

  // Points move first (split among the other three; clamp at payer's score).
  const others = s.players.filter((p) => p.id !== who).map((p) => p.id);
  const result = settlePayments(s.players, who, others, value);

  // Cards leave the hand into the meld area.
  const hand = s.players[who].hand;
  const used: Card[] = [];
  for (const id of cand.cardIds) {
    const idx = hand.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error(`engine invariant violated: winning card ${id} missing`);
    used.push(hand.splice(idx, 1)[0]);
  }
  s.players[who].melds.push({
    playerId: who,
    cards: used,
    handType: cand.type,
    groupName: cand.groupId ? s.groups.find((g) => g.id === cand.groupId)?.name : undefined,
    claim: "self-draw",
    score: result.received,
    chainIndex: s.activeChain,
  });
  s.recentPekojan.cards = used;
  incrementWinStats(s, who, cand, s.activeChain, "self-draw");
  log(
    s,
    `PEKOJAN ${s.players[who].name} completes ${
      cand.type === "group" ? s.groups.find((g) => g.id === cand.groupId)?.name : "a triple"
    }${cand.sameColor ? " (monochrome)" : ""}${s.activeChain > 1 ? ` — CHAIN ×${s.activeChain}` : ""} for ${result.received}.`,
    "pekojan"
  );

  if (endGameIfZeroScore(s)) return;

  // Replacement draws equal to consumed cards, then check for a chain.
  for (let i = 0; i < cand.cardIds.length; i++) {
    if (!tryDrawOne(s, who)) return; // game over inside
  }
  advanceAfterReplacementDraw(s);
}

function executeClaimedPekojan(s: GameState, claimWinnerId: number, cand: PekojanCandidate) {
  const payerId = s.discarderId;
  const value = cand.totalScore;
  const discardCardId = s.pendingClaims[0]?.usesDiscardCardId ?? lastDiscardId(s, payerId)!;

  s.activeChain = Math.max(s.activeChain, 1);
  s.pekojanSeq++;
  s.recentPekojan = {
    seq: s.pekojanSeq,
    playerId: claimWinnerId,
    cards: [],
    breakdown: breakdownOf(cand),
    chainIndex: 1,
    claim: "discard",
  };

  const result = settlePayments(s.players, claimWinnerId, [payerId], value);

  // Take the discard off the discarder's pile and lift the hand cards out.
  const payer = s.players[payerId];
  const dIdx = payer.discards.findIndex((c) => c.id === discardCardId);
  const discardCard = payer.discards.splice(dIdx, 1)[0];
  payer.dangerousDiscards++;

  const winner = s.players[claimWinnerId];
  const used: Card[] = [];
  for (const id of cand.cardIds) {
    if (id === discardCardId) continue; // comes from the discard pile, not the hand
    const idx = winner.hand.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error(`engine invariant violated: claim card ${id} missing`);
    used.push(winner.hand.splice(idx, 1)[0]);
  }
  const meldCards = [...used, discardCard];
  winner.melds.push({
    playerId: claimWinnerId,
    cards: meldCards,
    handType: cand.type,
    groupName: cand.groupId ? s.groups.find((g) => g.id === cand.groupId)?.name : undefined,
    claim: "discard",
    payerPlayerId: payerId,
    score: result.received,
    chainIndex: 1,
  });
  s.recentPekojan.cards = meldCards;
  incrementWinStats(s, claimWinnerId, cand, 1, "discard");
  log(
    s,
    `PEKOJAN ${winner.name} claims ${(s.characters.find((x) => x.id === discardCard.characterId)?.name ?? discardCard.characterId)} on ${payer.name}'s discard, paid ${result.received}.`,
    "pekojan"
  );

  if (endGameIfZeroScore(s)) return;

  s.currentPlayer = claimWinnerId;
  s.postChain = "resume";

  // Only cards taken from the winner's own hand are replaced — the claimed
  // discard itself is consumed by the completed hand (rule doc §17).
  for (let i = 0; i < used.length; i++) {
    if (!tryDrawOne(s, claimWinnerId)) return; // game over inside
  }
  advanceAfterReplacementDraw(s);
}

function lastDiscardId(s: GameState, playerId: number): string | undefined {
  const d = s.players[playerId]?.discards;
  return d?.length ? d[d.length - 1].id : undefined;
}

function breakdownOf(cand: PekojanCandidate) {
  const mixedBase =
    cand.type === "group" ? tableScore("group", cand.cardIds.length, false) : 120;
  return {
    baseScore: cand.baseScore,
    colorBonus: cand.sameColor ? cand.baseScore - mixedBase : 0,
    bonusCharacterScore: cand.bonusScore,
    totalScore: cand.totalScore,
    handType: cand.type,
    sameColor: cand.sameColor,
  };
}

function finishDiscardTurn(s: GameState) {
  s.pendingClaims = [];
  s.awaitingClaims = [];
  s.claimResponses = {};
  startNextTurn(s);
}

// ---------------------------------------------------------------------------
// Settle loop — advances through automatic phases to an input-required phase
// ---------------------------------------------------------------------------

const INPUT_PHASES = new Set(["SELF_PEKOJAN_DECISION", "DISCARDING", "DISCARD_CLAIM_WINDOW", "GAME_OVER"]);

export function settle(input: GameState): GameState {
  let guard = 0;
  while (!INPUT_PHASES.has(input.phase)) {
    if (++guard > 10000) throw new Error("engine runaway loop — state machine stuck");
    switch (input.phase) {
      case "SETUP":
      case "DEALING":
        input.phase = "TURN_START";
        break;
      case "TURN_START": {
        if (input.deck.length === 0) {
          gameOver(input, "deck-exhausted"); // rule doc §24-B
          break;
        }
        tryDrawOne(input, input.currentPlayer);
        input.drawnCardId = input.lastDraw?.cardId ?? null;
        log(input, `${input.players[input.currentPlayer].name} draws a card.`, "draw");
        beginOwnerTurnOptions(input, input.currentPlayer);
        break;
      }
      case "PEKOJAN_RESOLUTION":
      case "REPLACEMENT_DRAW":
        // handled inline by the declaring paths; reaching here is a bug.
        throw new Error(`unhandled phase ${input.phase}`);
      case "DISCARD_CLAIM_RESOLUTION": {
        // Double-call resolution (original rule): highest hand value wins the
        // card; equal values go to the FASTEST call; turn-order distance is
        // only the final fallback (e.g. two identical reaction times).
        const responses: {
          playerId: number;
          response: ClaimResponse & { kind: "claim" };
          calledAtMs: number;
          distance: number;
        }[] = [];
        for (const pid of Object.keys(input.claimResponses).map(Number)) {
          const r = input.claimResponses[pid];
          if (r.kind === "claim") {
            responses.push({
              playerId: pid,
              response: r,
              calledAtMs: r.calledAtMs,
              distance: turnDistance(input.discarderId, pid),
            });
          }
        }
        responses.sort(
          (a, b) =>
            (candidateById(input, b.response.candidateId)?.totalScore ?? 0) -
              (candidateById(input, a.response.candidateId)?.totalScore ?? 0) ||
            a.calledAtMs - b.calledAtMs ||
            a.distance - b.distance ||
            a.playerId - b.playerId
        );
        const top = responses[0];
        if (!top) {
          finishDiscardTurn(input);
          break;
        }
        const cand = candidateById(input, top.response.candidateId)!;
        executeClaimedPekojan(input, top.playerId, cand);
        break;
      }
      case "TURN_END":
        startNextTurn(input);
        break;
      default:
        throw new Error(`settle(): unknown phase ${input.phase}`);
    }
    if ((input.phase as string) === "GAME_OVER") break;
  }
  return input;
}

function candidateById(s: GameState, candidateId: string): PekojanCandidate | undefined {
  return s.pendingClaims.find((c) => c.candidate.id === candidateId)?.candidate;
}

// ---------------------------------------------------------------------------
// Public reducer
// ---------------------------------------------------------------------------

/** Thrown for any action that is illegal in the current phase. */
export class IllegalActionError extends Error {}

function require(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new IllegalActionError(msg);
}

export function reduce(prev: GameState, action: GameAction): GameState {
  const s: GameState = structuredClone(prev);
  s.lastDraw = prev.lastDraw ? { ...prev.lastDraw } : null;

  switch (action.type) {
      case "START_GAME":
        throw new IllegalActionError("use createGame() to start a match");

      case "DRAW": {
        // Drawing is an automatic engine step; the command exists for protocol
        // completeness (§46) and is accepted only in the exact situation the
        // engine would otherwise perform it.
        require(s.phase === "TURN_START" || s.phase === "DRAWING", "cannot draw now");
        break;
      }

      case "DECLARE_PEKOJAN": {
        require(s.phase === "SELF_PEKOJAN_DECISION", "not a pekojan decision moment");
        require(action.playerId === s.currentPlayer, "only the acting player may declare");
        const cand = currentCandidates(s, s.currentPlayer).find((c) => c.id === action.candidateId);
        require(cand, `candidate ${action.candidateId} is not currently valid`);
        s.drawnCardId = null;
        executeSelfDrawPekojan(s, cand!);
        break;
      }

      case "PASS_PEKOJAN": {
        require(s.phase === "SELF_PEKOJAN_DECISION", "not a pekojan decision moment");
        require(action.playerId === s.currentPlayer, "only the acting player may pass");
        log(s, `${s.players[action.playerId].name} passes on Pekojan.`, "info");
        s.drawnCardId = null;
        finishResolutionChain(s);
        break;
      }

      case "DISCARD": {
        require(s.phase === "DISCARDING", "not a discarding moment");
        require(action.playerId === s.currentPlayer, "only the acting player may discard");
        const p = s.players[action.playerId];
        const idx = p.hand.findIndex((c) => c.id === action.cardId);
        require(idx >= 0, "card is not in your hand");
        const card = p.hand.splice(idx, 1)[0];
        p.discards.push(card);
        s.discarderId = p.id;
        s.drawnCardId = null;
        s.lastDraw = null;
        log(s, `${p.name} discards a card.`, "discard");

        const eligibility = computeClaimEligibility(s, p.id, card);
        if (eligibility.length === 0) {
          finishDiscardTurn(s);
        } else {
          s.pendingClaims = eligibility.map((e) => ({
            playerId: e.playerId,
            candidate: e.best,
            usesDiscardCardId: card.id,
          }));
          s.claimResponses = {};
          s.awaitingClaims = eligibility.map((e) => e.playerId);
          s.decisionCounter++;
          s.phase = "DISCARD_CLAIM_WINDOW";
        }
        break;
      }

      case "CLAIM_DISCARD": {
        require(s.phase === "DISCARD_CLAIM_WINDOW", "no claim window open");
        require(s.awaitingClaims.includes(action.playerId), "you are not an eligible claimant");
        const elig = computeClaimEligibility(s, s.discarderId, discardCard(s)!);
        const mine = elig.find((e) => e.playerId === action.playerId);
        require(mine, "not eligible anymore");
        const cand = mine.candidates.find((c) => c.id === action.candidateId);
        require(cand, "invalid candidate selection");
        s.claimResponses[action.playerId] = {
          kind: "claim",
          candidateId: action.candidateId,
          calledAtMs: action.calledAtMs ?? Number.POSITIVE_INFINITY,
        };
        s.awaitingClaims = s.awaitingClaims.filter((id) => id !== action.playerId);
        if (s.awaitingClaims.length === 0) {
          s.phase = "DISCARD_CLAIM_RESOLUTION";
        }
        break;
      }

      case "PASS_CLAIM": {
        require(s.phase === "DISCARD_CLAIM_WINDOW", "no claim window open");
        require(s.awaitingClaims.includes(action.playerId), "not an eligible claimant");
        s.claimResponses[action.playerId] = { kind: "pass" };
        s.awaitingClaims = s.awaitingClaims.filter((id) => id !== action.playerId);
        log(s, `${s.players[action.playerId].name} passes the claim.`, "info");
        if (s.awaitingClaims.length === 0) {
          s.phase = "DISCARD_CLAIM_RESOLUTION";
        }
        break;
      }

      default:
        throw new IllegalActionError(`unknown action ${(action as GameAction).type}`);
    }

  if ((s.phase as string) === "GAME_OVER") return s;
  return settle(s);
}

function discardCard(s: GameState): Card | undefined {
  return s.players[s.discarderId]?.discards.at(-1);
}
