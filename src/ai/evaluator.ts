import type { Card, GameState, PekojanCandidate } from "../game/types";
import { findValidPekojans } from "../game/hands";
import { COPIES_PER_COLOR, CARD_COLORS, TOTAL_ACTIVE_CARDS } from "../game/deck";

// ---------------------------------------------------------------------------
// Shared card-evaluation heuristics for AI decisions.
// IMPORTANT: these functions only ever receive information that a human
// player could legally know (own hand + public table state).
// ---------------------------------------------------------------------------

/** Physical copies of one (character,color) that a full pool would contain. */
export const COPIES_PER_IDENTITY = COPIES_PER_COLOR;

export interface PublicContext {
  /** characters/groups among which hands can be completed */
  groups: GameState["groups"];
  bonusCharacterId: string;
  deckRemaining: number;
  scores: number[];
  myId: number;
  seenByColor: Map<string, Map<string, number>>; // characterId -> color -> publicly visible copies
  /** cards the four groups could theoretically produce (rule doc §5) */
  theoreticalPool: number;
  /**
   * §5 — only TOTAL_ACTIVE_CARDS of `theoreticalPool` ever enter the match, so
   * a card that has not been seen is not necessarily *available*. This is the
   * chance an unidentified card is in play at all, conditioned on everything
   * the viewer has already located. Public knowledge: group sizes are visible,
   * and the excluded cards themselves are never inspected.
   */
  inPlayRatio: number;
  /** cards in play that the viewer cannot see: deck + opponents' hands. */
  unknownPool: number;
}

export function buildPublicContext(state: GameState, viewerId: number): PublicContext {
  const seen = new Map<string, Map<string, number>>();
  const bump = (c: Card) => {
    let m = seen.get(c.characterId);
    if (!m) {
      m = new Map();
      seen.set(c.characterId, m);
    }
    m.set(c.color, (m.get(c.color) ?? 0) + 1);
  };
  for (const p of state.players) {
    for (const d of p.discards) bump(d);
    for (const meld of p.melds) for (const c of meld.cards) bump(c);
  }
  // §5 availability model. `identified` = every card the viewer has physically
  // located (own hand + all discards + all melds); those are certainly in play.
  // The rest of the theoretical pool is in play with probability
  // (remaining active cards) / (remaining unlocated cards).
  const theoreticalPool =
    state.groups.reduce((n, g) => n + g.characterIds.length, 0) *
    CARD_COLORS.length *
    COPIES_PER_COLOR;
  const identified =
    state.players[viewerId].hand.length +
    state.players.reduce(
      (n, p) => n + p.discards.length + p.melds.reduce((m, x) => m + x.cards.length, 0),
      0
    );
  const inPlayRatio =
    theoreticalPool <= identified
      ? 1
      : Math.max(0, Math.min(1, (TOTAL_ACTIVE_CARDS - identified) / (theoreticalPool - identified)));
  const unknownPool =
    state.deck.length +
    state.players.reduce((n, p) => (p.id === viewerId ? n : n + p.hand.length), 0);

  return {
    groups: state.groups,
    bonusCharacterId: state.bonusCharacterId,
    deckRemaining: state.deck.length,
    scores: state.players.map((p) => p.score),
    myId: viewerId,
    seenByColor: seen,
    theoreticalPool,
    inPlayRatio,
    unknownPool,
  };
}

/** Publicly seen copies of (character,color) including cards in viewer's own hand. */
export function publiclySeen(ctx: PublicContext, hand: Card[], characterId: string, color: string): number {
  const base = ctx.seenByColor.get(characterId)?.get(color) ?? 0;
  return base + hand.filter((c) => c.characterId === characterId && c.color === color).length;
}

/**
 * Expected future value of keeping `card` in hand — how close it brings us to
 * triples / group completions, weighted by score potential and availability.
 */
export function keepValue(card: Card, hand: Card[], ctx: PublicContext): number {
  const sameChar = hand.filter((c) => c.characterId === card.characterId);
  let value = 0;

  // Triple proximity: every additional copy with this character is worth a lot.
  const tripleProgress = Math.min(sameChar.length, 3);
  value += [0, 40, 130, 260][Math.min(tripleProgress, 3)];

  // Group progress across all active groups this character belongs to.
  for (const g of ctx.groups) {
    if (!g.characterIds.includes(card.characterId)) continue;
    const members = g.characterIds.map((id) => ({
      id,
      present: hand.some((c) => c.characterId === id),
    }));
    if (members.every((m) => m.present)) {
      // near-complete/complete group
      value += 60 + g.characterIds.length * 22;
    } else if (members.filter((m) => m.present).length >= g.characterIds.length - 1) {
      value += 45; // one away
    } else if (members.some((m) => m.present && m.id !== card.characterId)) {
      value += 12;
    }
  }

  // Monochrome potential & scarcity-adjusted upside.
  const sameColorCopies = sameChar.filter((c) => c.color === card.color).length;
  if (sameColorCopies >= 2) value += 120;
  else if (sameColorCopies === 1) value += 25;

  // Bonus character synergy.
  if (card.characterId === ctx.bonusCharacterId) value += 30;

  // Diminishing availability of the remaining unseen copies we could still draw.
  const copiesUnseenPerColor =
    3 - publiclySeen(ctx, [], card.characterId, card.color) > 0 ? 1 : 0;
  void copiesUnseenPerColor;

  return value;
}

/** How likely is some opponent to be able to claim `card` right now? */
export function discardDanger(state: GameState, ctx: PublicContext, card: Card): number {
  // Without peeking at hidden hands, danger grows when:
  //  - the related groups are small,
  //  - few copies have been publicly seen,
  //  - and the discarder stands to lose heavily on claims.
  let danger = 0.15;
  for (const p of state.players) {
    if (p.id === ctx.myId) continue;
    for (const g of ctx.groups) {
      const relevantDiscards = p.discards.filter((d) => g.characterIds.includes(d.characterId));
      // A player collecting this group makes any member discard risky.
      if (relevantDiscards.length >= 2) danger += 0.04 * g.characterIds.length;
    }
    if (p.discards.some((d) => d.characterId === card.characterId)) danger -= 0.05;
  }
  const seen = ctx.seenByColor.get(card.characterId)?.get(card.color) ?? 0;
  if (seen >= 2) danger -= 0.08; // rarer they complete a fresh triple
  return Math.max(0.02, Math.min(danger, 0.6));
}

/** Evaluates whether claiming candidate `cand` via discard looks profitable. */
export function claimAppeal(cand: PekojanCandidate, ctx: PublicContext): number {
  // Claim = the discarder pays everything. Bigger wins are better targets.
  return cand.totalScore;
}
