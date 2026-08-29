// ---------------------------------------------------------------------------
// Pekojan — Domain types
// ---------------------------------------------------------------------------

export type CardColor = "pink" | "blue" | "orange";

export interface Card {
  id: string;
  characterId: string;
  groupId: string;
  color: CardColor;
}

export interface Character {
  id: string;
  name: string;
  groupId: string;
  emoji: string; // placeholder portrait
  image?: string;
}

export interface Group {
  id: string;
  name: string;
  /** group crest shown on the cards' corner indices (e.g. "0" for 0th Gen) */
  symbol: string;
  /** compact label for the card's bottom-left corner (defaults to name) */
  shortLabel?: string;
  characterIds: string[];
  /** groups that cannot appear in the same match (shared members) */
  mutuallyExclusiveWith?: string[];
}

export type HandType = "three-of-kind" | "group";
export type Difficulty = "easy" | "normal" | "hard" | "expert";
export type SortMode = "group" | "character" | "color";

/** A legal winning combination. `cardIds` is always sorted for canonical identity. */
export interface PekojanCandidate {
  id: string; // canonical: type + sorted card ids
  type: HandType;
  groupId?: string; // only for group hands
  cardIds: string[];
  sameColor: boolean;
  baseScore: number; // from the scoring table
  bonusCount: number; // number of bonus-character cards used
  bonusScore: number; // bonusCount * BONUS_PER_CARD
  totalScore: number;
}

export interface ScoreBreakdown {
  baseScore: number;
  colorBonus: number;
  bonusCharacterScore: number;
  totalScore: number;
  handType: HandType;
  sameColor: boolean;
}

export type GamePhase =
  | "SETUP"
  | "DEALING"
  | "TURN_START"
  | "DRAWING"
  | "SELF_PEKOJAN_DECISION"
  | "PEKOJAN_RESOLUTION"
  | "REPLACEMENT_DRAW"
  | "DISCARDING"
  | "DISCARD_CLAIM_WINDOW"
  | "DISCARD_CLAIM_RESOLUTION"
  | "TURN_END"
  | "GAME_OVER";

/** Location of every physical card — invariant-checked each turn. */
export type CardLocation =
  | { kind: "deck" }
  | { kind: "hand"; playerId: number }
  | { kind: "discard"; playerId: number }
  | { kind: "meld"; playerId: number };

export interface CompletedHand {
  playerId: number;
  cards: Card[];
  handType: HandType;
  groupName?: string;
  claim: "self-draw" | "discard"; // discard means discarding player paid
  payerPlayerId?: number; // for discard claims
  score: number;
  chainIndex: number; // 1st, 2nd, ... pekojan of that resolution chain
}

export interface PlayerState {
  id: number;
  name: string;
  isHuman: boolean;
  difficulty?: Difficulty;
  score: number;
  hand: Card[];
  melds: CompletedHand[];
  discards: Card[];
  // match statistics per player
  pekojans: number;
  selfDrawWins: number;
  discardWins: number;
  largestHand: number;
  pointsGained: number;
  pointsLost: number;
  dangerousDiscards: number;
  longestChain: number;
}

export interface PendingClaim {
  playerId: number;
  candidate: PekojanCandidate;
  usesDiscardCardId: string;
}

/** What happens after the current resolution chain ends. */
export type PostChainMode =
  | "owner-discard" // the acting player finishes their own turn by discarding
  | "resume"; // a discard-claimer finished; play resumes after the discarder

export type ClaimResponse =
  | { kind: "pass" }
  /** calledAtMs: delay from the moment the discard hit the table —
   *  ties between equal-value claims go to the fastest call (original rule). */
  | { kind: "claim"; candidateId: string; calledAtMs: number };

/**
 * All automatic AI decisions are recorded as actions so a full game can be
 * replayed deterministically by re-issuing only the human/player decisions.
 */
export type GameAction =
  | { type: "START_GAME"; seed: string }
  | { type: "DRAW"; playerId: number }
  | { type: "DISCARD"; playerId: number; cardId: string }
  | { type: "DECLARE_PEKOJAN"; playerId: number; candidateId: string }
  | { type: "PASS_PEKOJAN"; playerId: number }
  | { type: "CLAIM_DISCARD"; playerId: number; candidateId: string; calledAtMs?: number }
  | { type: "PASS_CLAIM"; playerId: number }
  | { type: "NO_MORE_CLAIMS" };

export interface LogEntry {
  turn: number;
  text: string;
  kind: "draw" | "discard" | "pekojan" | "info" | "end";
}

export interface GameState {
  seed: string;
  rngState: number;

  phase: GamePhase;
  groups: Group[]; // 4 selected groups
  characters: Character[]; // members of the selected groups
  poolExcluded: Card[]; // generated but never entered the match
  deck: Card[];
  players: PlayerState[];
  currentPlayer: number;
  firstPlayer: number;
  bonusCharacterId: string;
  drawnCardId: string | null;
  /** most recent automatic draw, for deal/draw animations */
  lastDraw: { playerId: number; cardId: string } | null;
  pendingClaims: PendingClaim[];
  /** players who still owe a response during DISCARD_CLAIM_WINDOW */
  awaitingClaims: number[];
  /** responses collected so far in the claim window */
  claimResponses: Record<number, ClaimResponse>;
  /** id of the most recent discarder (for claim-window context + resume) */
  discarderId: number;
  postChain: PostChainMode;
  /** increments every time a decision phase is entered — feeds deterministic AI randomness */
  decisionCounter: number;
  activeChain: number; // current pekojan chain length this resolution
  recentPekojan: {
    /** unique per executed Pekojan — UI celebrates each exactly once */
    seq: number;
    playerId: number;
    cards: Card[];
    breakdown: ScoreBreakdown;
    chainIndex: number;
    claim: "self-draw" | "discard";
  } | null;
  /** monotonic counter incremented whenever a Pekojan resolves */
  pekojanSeq: number;
  turnNumber: number;
  endReason: "zero-score" | "deck-exhausted" | null;
  log: LogEntry[];
}
