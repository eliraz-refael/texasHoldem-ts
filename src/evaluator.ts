import { Hand as PokersolverHand } from "pokersolver";
import type { Card } from "./card.js";
import { toPokersolverString } from "./card.js";

// ---------------------------------------------------------------------------
// HandRank — our public type that does NOT leak pokersolver internals
// ---------------------------------------------------------------------------

export interface HandRank {
  readonly name: string;
  readonly description: string;
  readonly rank: number;
  readonly bestCards: readonly string[];
}

// ---------------------------------------------------------------------------
// evaluate — solve a set of cards and return a HandRank
// ---------------------------------------------------------------------------

export function evaluate(cards: readonly Card[]): HandRank {
  const psStrings = cards.map(toPokersolverString);
  const solved = PokersolverHand.solve(psStrings);

  return {
    name: solved.name,
    description: solved.descr,
    rank: solved.rank,
    bestCards: Object.freeze(
      solved.cards.map((c) => `${c.value}${c.suit}`),
    ),
  };
}

// ---------------------------------------------------------------------------
// compare — compare two HandRanks by rank (higher rank = better hand)
// ---------------------------------------------------------------------------

export function compare(a: HandRank, b: HandRank): -1 | 0 | 1 {
  if (a.rank > b.rank) return 1;
  if (a.rank < b.rank) return -1;
  return 0;
}

// ---------------------------------------------------------------------------
// winners — return the best hand(s) from a list (may be multiple for ties)
// ---------------------------------------------------------------------------

export function winners(hands: readonly HandRank[]): readonly HandRank[] {
  if (hands.length === 0) return [];

  let best = hands[0]!;
  for (let i = 1; i < hands.length; i++) {
    const hand = hands[i]!;
    if (compare(hand, best) > 0) {
      best = hand;
    }
  }

  return Object.freeze(hands.filter((h) => compare(h, best) === 0));
}

// ---------------------------------------------------------------------------
// evaluateHoldem — combine hole + community cards and evaluate
// ---------------------------------------------------------------------------

export function evaluateHoldem(
  holeCards: readonly Card[],
  communityCards: readonly Card[],
): HandRank {
  return evaluate([...holeCards, ...communityCards]);
}
