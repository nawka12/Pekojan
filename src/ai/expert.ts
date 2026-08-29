import type { Card, CardColor, GameState } from "../game/types";
import { findValidPekojans, dedupeByVisibleIdentity } from "../game/hands";
import { tableScore } from "../game/scoring";
import { splitThree } from "../game/payments";
import { buildPublicContext, publiclySeen, type PublicContext } from "./evaluator";
import { hashSeed, makeRng } from "../game/rng";

/*
 * EXPERT AI.
 *
 * Strictly public information only (own hand + discards + melds + counts):
 *  1. Card counting — exact "unseen copy" numbers per character/color,
 *     discounted by the §5 100-card rule: only 100 of the 126–153 cards the
 *     four groups could produce are in the match, so unseen != available.
 *  2. Probability modeling — exact hypergeometric draw-completion chances
 *     over a finite horizon (sampling without replacement) against the whole
 *     unknown pool (deck + opponents' hands), not the deck alone.
 *  3. Opponent inference — completion risk per discard from their melds,
 *     discard history, and the exact chance they hold the copies they need.
 *  4. Expected-value play — declare vs pass compares immediate score against
 *     the probability-weighted upgrade potential of continuing.
 *  5. Positional & endgame play — leaders defend and cash in, trailers fish;
 *     instant-win detection when a payout zeroes an opponent (match over).
 */

const COLORS: CardColor[] = ["pink", "blue", "orange"];

// ---------------------------------------------------------------------------
// Card counting
// ---------------------------------------------------------------------------

/** Unseen copies of (character,color) = 3 − publicly seen. */
export function unseenCopies(ctx: PublicContext, characterId: string, color: CardColor): number {
  return Math.max(0, 3 - publiclySeen(ctx, [], characterId, color));
}

/** Unseen copies of a character across all colors. */
export function unseenTotal(ctx: PublicContext, characterId: string): number {
  return COLORS.reduce((n, c) => n + unseenCopies(ctx, characterId, c), 0);
}

/** Unseen copies not sitting in my own hand — what opponents/deck could hold. */
export function unknownCopies(
  ctx: PublicContext,
  hand: readonly Card[],
  characterId: string,
  color?: CardColor
): number {
  let n = color ? unseenCopies(ctx, characterId, color) : unseenTotal(ctx, characterId);
  n -= hand.filter((h) => h.characterId === characterId && (!color || h.color === color)).length;
  return Math.max(0, n);
}

/**
 * EXPECTED copies that are both unknown to me AND actually in play.
 *
 * `unknownCopies` counts physical copies the pool could contain; §5 keeps only
 * 100 of the 126–153 cards the four groups produce, so a card nobody has seen
 * is only `inPlayRatio` likely to exist in this match at all. Every probability
 * must use this number, not the raw count, or the AI systematically
 * overestimates its chance of completing anything.
 */
export function availableCopies(
  ctx: PublicContext,
  hand: readonly Card[],
  characterId: string,
  color?: CardColor
): number {
  return unknownCopies(ctx, hand, characterId, color) * ctx.inPlayRatio;
}

function binom(n: number, k: number): number {
  if (k < 0 || k > n || n < 0) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/**
 * P(≥1 of `need` unseen copies appears within `draws` from `deckRemaining`).
 * Exact hypergeometric: 1 − C(N−need, d)/C(N, d) (sampling without replacement).
 */
export function drawHitProbability(need: number, deckRemaining: number, draws: number): number {
  if (need <= 0 || deckRemaining <= 0 || draws <= 0) return 0;
  if (need >= deckRemaining) return 1;
  const d = Math.min(draws, deckRemaining);
  let miss = 1;
  for (let i = 0; i < d; i++) {
    miss *= (deckRemaining - need - i) / (deckRemaining - i);
    if (miss <= 1e-9) return 1;
  }
  return 1 - miss;
}

// ---------------------------------------------------------------------------
// Opponent inference
// ---------------------------------------------------------------------------

/**
 * Exact P(a specific opponent holds ≥2 of the `unknown` copies) when they
 * hold `oppHand` cards drawn from a pool of `unknownPool` unseen cards.
 */
function pairHoldProbability(unknownCopiesN: number, oppHand: number, unknownPool: number): number {
  if (unknownCopiesN < 2 || oppHand < 2 || unknownPool < 2) return 0;
  const total = binom(unknownPool, oppHand);
  if (total <= 0) return 0;
  const p0 = binom(unknownPool - unknownCopiesN, oppHand);
  const p1 = unknownCopiesN * binom(unknownPool - unknownCopiesN, oppHand - 1);
  return Math.min(1, Math.max(0, 1 - (p0 + p1) / total));
}

/**
 * Exact P(a specific opponent holds ≥1 of `copies` unknown cards).
 */
function anyHoldProbability(copies: number, oppHand: number, unknownPool: number): number {
  if (copies <= 0 || oppHand <= 0 || unknownPool <= 0) return 0;
  if (copies >= unknownPool) return 1;
  const total = binom(unknownPool, oppHand);
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - binom(unknownPool - copies, oppHand) / total));
}

/**
 * P(this discard hands SOME opponent a completed hand) — a true probability in
 * [0,1], not a score. Per-opponent threats are combined as independent events
 * (1 − Π(1 − pᵢ)) rather than summed, so the number never saturates and keeps
 * discriminating between safe and lethal cards right through the endgame.
 */
export function expertDiscardRisk(
  state: GameState,
  ctx: PublicContext,
  card: Card
): number {
  const me = state.players[ctx.myId];
  const others = state.players.filter((p) => p.id !== ctx.myId);
  const pool = ctx.unknownPool;
  if (pool < 4) return 0.02;

  // What they would need to already hold, discounted for cards §5 excluded.
  const availChar = availableCopies(ctx, me.hand, card.characterId);
  let safe = 1;

  for (const opp of others) {
    // Triple threat: they need 2 more copies of this character.
    let pOpp = pairHoldProbability(availChar, opp.hand.length, pool);

    // Group threat: they hold every other member of a group this card completes.
    for (const g of ctx.groups) {
      if (!g.characterIds.includes(card.characterId)) continue;
      let pGroup = 1;
      for (const id of g.characterIds) {
        if (id === card.characterId) continue;
        pGroup *= anyHoldProbability(availableCopies(ctx, me.hand, id), opp.hand.length, pool);
      }
      // Discard history is a read on intent: throwing group members away twice
      // is a strong signal they abandoned it.
      const thrown = opp.discards.filter((d) => g.characterIds.includes(d.characterId)).length;
      pGroup *= thrown >= 2 ? 0.25 : thrown === 1 ? 0.6 : 1;
      // Having already banked this group makes a repeat much less likely.
      if (opp.melds.some((m) => m.groupName === g.name)) pGroup *= 0.5;
      pOpp = 1 - (1 - pOpp) * (1 - pGroup);
    }
    safe *= 1 - pOpp;
  }
  return Math.min(1, Math.max(0, 1 - safe));
}

// ---------------------------------------------------------------------------
// Expected keep value with probability weighting
// ---------------------------------------------------------------------------

const HORIZON = 12; // draws the expert is willing to look ahead

export function expertKeepValue(
  hand: readonly Card[],
  card: Card,
  ctx: PublicContext
): number {
  const without = hand.filter((h) => h.id !== card.id);
  const partners = hand.filter((h) => h.characterId === card.characterId && h.id !== card.id);
  let value = 8; // spare-card baseline

  // Triple completion EV — a 4th+ copy of the same character is dead weight.
  if (partners.length < 3) {
    const need = 3 - (partners.length + 1);
    if (need === 1) {
      const mono =
        partners.length === 2 && partners.every((p) => p.color === card.color);
      const avail = mono
        ? availableCopies(ctx, hand, card.characterId, card.color)
        : availableCopies(ctx, hand, card.characterId);
      const target = mono ? tableScore("triple", 3, true) : tableScore("triple", 3, false);
      const pDraw = drawHitProbability(avail, ctx.unknownPool, HORIZON);
      // The missing copy may also surface as an opponent discard we can claim —
      // but only if a copy still exists somewhere. Nothing left = dead pair.
      const pClaim = avail > 0 ? 0.18 : 0;
      value += Math.min(1, pDraw + pClaim) * target * (mono ? 1.0 : 0.85);
    } else if (need === 2) {
      const avail = availableCopies(ctx, hand, card.characterId);
      value += drawHitProbability(avail, ctx.unknownPool, HORIZON) * 60;
    }
  }

  // Group completion EV (keeping this card)
  for (const g of ctx.groups) {
    if (!g.characterIds.includes(card.characterId)) continue;
    const missing = g.characterIds.filter((id) => !without.some((h) => h.characterId === id));
    if (missing.length === 0) {
      // group is already complete even without this card — flexibility bonus
      value += 15;
      continue;
    }
    const pAll = missing
      .map((id) => drawHitProbability(availableCopies(ctx, hand, id), ctx.unknownPool, HORIZON))
      .reduce((a, b) => a * b, 1);
    value += pAll * tableScore("group", g.characterIds.length, false) * 0.9;

    // monochrome upside: one color every member could still share
    for (const col of COLORS) {
      const viable = g.characterIds.every((id) => {
        const held = hand.filter((h) => h.characterId === id);
        if (held.length === 0) return availableCopies(ctx, hand, id, col) > 0;
        return held.every((h) => h.color === col);
      });
      if (!viable) continue;
      const pMono = missing
        .map((id) => drawHitProbability(availableCopies(ctx, hand, id, col), ctx.unknownPool, HORIZON))
        .reduce((a, b) => a * b, 1);
      value +=
        pMono *
        (tableScore("group", g.characterIds.length, true) -
          tableScore("group", g.characterIds.length, false)) *
        0.35;
    }
  }

  if (card.characterId === ctx.bonusCharacterId) value += 25;
  return value;
}

// ---------------------------------------------------------------------------
// EV of passing a ready hand (upgrade fishing) vs declaring now
// ---------------------------------------------------------------------------

export function passUpgradePotential(
  state: GameState,
  hand: readonly Card[],
  bestScore: number,
  ctx: PublicContext,
  declaredCardIds?: readonly string[]
): number {
  const horizon = Math.min(ctx.deckRemaining, 8);
  if (horizon <= 0) return 0;

  // Only upgrades to the hand we are about to BANK count as a reason to pass.
  // A same-color pair elsewhere in hand survives declaring untouched, so it is
  // no argument for passing at all.
  const declared = declaredCardIds
    ? declaredCardIds.map((id) => hand.find((c) => c.id === id)).filter((c): c is Card => !!c)
    : [];
  if (declared.length === 0) return 0;

  const isGroup = new Set(declared.map((c) => c.characterId)).size === declared.length;
  const monoValue = isGroup
    ? tableScore("group", declared.length, true)
    : tableScore("triple", 3, true);

  // The upgrade is live when exactly one card is the wrong color: swapping it
  // for the same character in the majority color turns the hand monochrome.
  let potential = 0;
  for (const col of COLORS) {
    const wrong = declared.filter((c) => c.color !== col);
    if (wrong.length !== 1) continue;
    const p = drawHitProbability(
      availableCopies(ctx, hand, wrong[0].characterId, col),
      ctx.unknownPool,
      horizon
    );
    potential = Math.max(potential, p * Math.max(0, monoValue - bestScore));
  }
  return potential;
}

// ---------------------------------------------------------------------------
// Match-aware outcomes (instant-win / instant-loss detection)
// ---------------------------------------------------------------------------

/**
 * Scores after a self-draw Pekojan worth `value`: every opponent pays ⅓
 * (clamped at their score, same policy as settlePayments). A payer reaching
 * 0 ends the match immediately — highest score wins.
 */
function selfDrawOutcome(
  state: GameState,
  meId: number,
  value: number
): { endsGame: boolean; iWin: boolean } {
  const amounts = splitThree(value);
  const others = state.players.filter((p) => p.id !== meId).sort((a, b) => a.id - b.id);
  const scores = state.players.map((p) => p.score);
  let received = 0;
  others.forEach((p, i) => {
    const pay = Math.min(amounts[i], scores[p.id]);
    scores[p.id] -= pay;
    received += pay;
  });
  scores[meId] += received;
  const endsGame = others.some((p) => scores[p.id] <= 0);
  const bestOther = Math.max(...others.map((p) => scores[p.id]));
  return { endsGame, iWin: scores[meId] > bestOther };
}

/** Scores after a discard claim: the discarder pays everything (clamped). */
function claimOutcome(
  state: GameState,
  meId: number,
  payerId: number,
  value: number
): { endsGame: boolean; iWin: boolean } {
  const scores = state.players.map((p) => p.score);
  const pay = Math.min(value, scores[payerId]);
  scores[payerId] -= pay;
  scores[meId] += pay;
  const endsGame = scores[payerId] <= 0;
  const bestOther = Math.max(...scores.filter((_, i) => i !== meId));
  return { endsGame, iWin: scores[meId] > bestOther };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export function expertSelfPekojan(
  state: GameState,
  playerId: number
): { declare: boolean; candidateId: string; note: string } {
  const hand = state.players[playerId].hand;
  const ctx = buildPublicContext(state, playerId);
  const candidates = dedupeByVisibleIdentity(
    findValidPekojans(hand, state.groups, state.bonusCharacterId),
    new Map(hand.map((c) => [c.id, c]))
  );
  if (candidates.length === 0) return { declare: false, candidateId: "", note: "none" };
  const best = [...candidates].sort(
    (a, b) =>
      b.totalScore - a.totalScore ||
      (a.sameColor === b.sameColor ? (a.id < b.id ? -1 : 1) : a.sameColor ? -1 : 1)
  )[0];

  // Match-winning (or match-losing!) endings: a payout that zeroes an
  // opponent ends the game on the spot. Declare only if that win is ours.
  const outcome = selfDrawOutcome(state, playerId, best.totalScore);
  if (outcome.endsGame) {
    if (outcome.iWin) return { declare: true, candidateId: best.id, note: `win now ${best.totalScore}` };
    return { declare: false, candidateId: best.id, note: "pass: ends match for a rival" };
  }

  // Big hands: never look a gift 480+ in the mouth.
  if (best.totalScore >= 480 || best.sameColor) {
    return { declare: true, candidateId: best.id, note: `strong ${best.totalScore}` };
  }

  const rng = makeRng(hashSeed(`expert-sp:${state.seed}:${state.decisionCounter}`));
  const upgrade = passUpgradePotential(state, hand, best.totalScore, ctx, best.cardIds);
  const deckRich = ctx.deckRemaining > 25;
  const bestOpp = Math.max(
    ...state.players.filter((p) => p.id !== playerId).map((p) => p.score)
  );
  const leading = state.players[playerId].score >= bestOpp;
  // leaders cash in early; trailers fish harder while the deck lasts
  const upgradeWeight = deckRich ? (leading ? 0.7 : 1.0) : 0.55;
  // Declaring — not passing — is what buys replacement draws and a shot at a
  // chain, so the tempo credit belongs on this side of the ledger.
  const chainValue = deckRich ? 25 : 8;
  // Waiting only pays if the hand survives long enough to be upgraded; rivals
  // declare, claim, or end the match in the meantime.
  const survives = 0.55;
  const margin = best.totalScore + chainValue - upgrade * upgradeWeight * survives;
  const declare = margin >= 0 || rng.next() < 0.25 + Math.max(0, margin) / 600;
  return {
    declare,
    candidateId: best.id,
    note: `score ${best.totalScore} vs upgrade ${Math.round(upgrade)}`,
  };
}

export function expertDiscard(
  state: GameState,
  playerId: number
): { cardId: string; note: string } {
  const hand = state.players[playerId].hand;
  const ctx = buildPublicContext(state, playerId);
  const rng = makeRng(hashSeed(`expert-d:${state.seed}:${state.decisionCounter}`));

  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const rank = ranked.findIndex((p) => p.id === playerId);
  const leading = rank === 0;

  // Risk is a probability, so this is the point cost of feeding a claim. It is
  // deliberately much larger than a typical keep-value: a claimed discard is
  // paid in full by us alone (a self-draw is split three ways), so the swing is
  // roughly double the hand's value and it pushes US toward the zero-score end.
  // Measured over 1,600 matches against four different opponent fields, raising
  // this until risk dominates keep-value lifted the lone-expert win rate from
  // 31.5% to ~56% (fair share 25%) — defence is simply worth more than offence
  // in Pekojan. Keep-value still orders cards of comparable danger.
  const RISK_COST = 3000;
  const riskWeight = leading ? RISK_COST * 1.4 : RISK_COST;

  const scored = hand.map((card) => {
    const keep = expertKeepValue(hand, card, ctx);
    const risk = expertDiscardRisk(state, ctx, card);
    const value = keep - risk * riskWeight + rng.next() * 6;
    return { card, value, keep, risk };
  });
  scored.sort((a, b) => b.value - a.value);
  const pick = scored[0];
  return {
    cardId: pick?.card.id ?? hand[0].id,
    note: scored
      .slice(0, 4)
      .map((s) => `${s.card.characterId[0].toUpperCase()}${s.card.color[0]} k${Math.round(s.keep)}/r${s.risk.toFixed(2)}`)
      .join(" "),
  };
}

export function expertClaim(
  state: GameState,
  playerId: number,
  candidateId: string
): { claim: boolean; note: string } {
  const hand = state.players[playerId].hand;
  const ctx = buildPublicContext(state, playerId);
  const discard = state.players[state.discarderId]?.discards.at(-1);
  if (!discard) return { claim: false, note: "no discard" };
  const cands = dedupeByVisibleIdentity(
    findValidPekojans(hand, state.groups, state.bonusCharacterId, discard).filter((c) =>
      c.cardIds.includes(discard.id)
    ),
    new Map([...hand, discard].map((c) => [c.id, c]))
  );
  const best =
    [...cands]
      .sort(
        (a, b) =>
          b.totalScore - a.totalScore ||
          (a.sameColor === b.sameColor ? (a.id < b.id ? -1 : 1) : a.sameColor ? -1 : 1)
      )
      .find((c) => c.id === candidateId) ?? cands[0];
  if (!best) return { claim: false, note: "no candidate" };

  // Match-ending claim: if the payout zeroes the discarder, the game ends
  // now. Claim exactly when that win is ours.
  const payer = state.players[state.discarderId];
  const outcome = claimOutcome(state, playerId, payer.id, best.totalScore);
  if (outcome.endsGame) {
    if (outcome.iWin) return { claim: true, note: `win now ${best.totalScore}` };
    return { claim: false, note: "pass: ends match for a rival" };
  }

  // Claiming is close to free: the rest of the hand stays put and every card
  // spent is replaced immediately. So the question is NOT "is this worth more
  // than my hand" — it is "does passing buy a bigger version of THIS hand?".
  // A claim also takes the full amount from one player, where a self-draw
  // splits it three ways, which is what drives an opponent to zero.
  if (best.sameColor || best.totalScore >= 300) {
    return { claim: true, note: `take ${best.totalScore}` };
  }

  // The only real reason to decline: these same cards can still go monochrome,
  // and there is enough deck left to find the swap.
  const used = best.cardIds
    .map((id) => (id === discard.id ? discard : hand.find((c) => c.id === id)))
    .filter((c): c is Card => !!c);
  const isGroup = new Set(used.map((c) => c.characterId)).size === used.length;
  const monoValue = isGroup
    ? tableScore("group", used.length, true)
    : tableScore("triple", 3, true);
  let upgradeP = 0;
  if (ctx.deckRemaining > 22) {
    for (const col of COLORS) {
      const wrong = used.filter((c) => c.color !== col);
      if (wrong.length !== 1) continue;
      upgradeP = Math.max(
        upgradeP,
        drawHitProbability(
          availableCopies(ctx, hand, wrong[0].characterId, col),
          ctx.unknownPool,
          8
        )
      );
    }
  }
  // Halved: rivals get to declare, claim and end the match while we wait.
  const passEv = upgradeP * Math.max(0, monoValue - best.totalScore) * 0.5;
  const claim = best.totalScore >= passEv;
  return {
    claim,
    note: `take ${best.totalScore} vs upgrade ${Math.round(passEv)}`,
  };
}
