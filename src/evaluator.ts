import { Array as A, Either, Order, pipe } from "effect";
import pokersolver from "pokersolver";
import type { Hand } from "pokersolver";
const { Hand: PokersolverHand } = pokersolver;
import type { Card } from "./card";
import { toPokersolverString } from "./card";
import { InvalidGameState } from "./error";

// ---------------------------------------------------------------------------
// HandRank — our public type that does NOT leak pokersolver internals
// ---------------------------------------------------------------------------

export interface HandRank {
  readonly name: string;
  readonly description: string;
  readonly rank: number;
  readonly bestCards: readonly string[];
  /** @internal pokersolver Hand object for accurate intra-category comparison. */
  readonly _solved?: Hand;
}

// ---------------------------------------------------------------------------
// HandRankOrder
// ---------------------------------------------------------------------------

/** Order instance for HandRank — higher rank = better hand. */
export const HandRankOrder: Order.Order<HandRank> = Order.mapInput(
  Order.number,
  (h: HandRank) => h.rank,
);

// ---------------------------------------------------------------------------
// evaluate — solve a set of cards and return a HandRank
// ---------------------------------------------------------------------------

export function evaluate(
  cards: readonly Card[],
): Either.Either<HandRank, InvalidGameState> {
  return Either.try({
    try: () => {
      const psStrings = cards.map(toPokersolverString);
      const solved = PokersolverHand.solve(psStrings);
      return {
        name: solved.name,
        description: solved.descr,
        rank: solved.rank,
        bestCards: Object.freeze(
          solved.cards.map((c) => `${c.value}${c.suit}`),
        ),
        _solved: solved,
      };
    },
    catch: (e) =>
      new InvalidGameState({
        state: "evaluate",
        reason: `pokersolver error: ${e instanceof Error ? e.message : String(e)}`,
      }),
  });
}

// ---------------------------------------------------------------------------
// compare — compare two HandRanks using HandRankOrder
// ---------------------------------------------------------------------------

export function compare(a: HandRank, b: HandRank): -1 | 0 | 1 {
  // Fast path: different categories are unambiguous
  if (a.rank !== b.rank) return HandRankOrder(a, b);

  // Same category: use pokersolver for intra-category comparison (kickers, pair values, etc.)
  if (a._solved && b._solved) {
    const ws = PokersolverHand.winners([a._solved, b._solved]);
    if (ws.length === 2) return 0;
    return ws[0] === a._solved ? 1 : -1;
  }

  // Fallback: category-only (for test data without _solved)
  return 0;
}

// ---------------------------------------------------------------------------
// winners — return the best hand(s) from a list (may be multiple for ties)
// ---------------------------------------------------------------------------

export function winners(hands: readonly HandRank[]): readonly HandRank[] {
  if (hands.length === 0) return [];

  // When all hands carry pokersolver objects, delegate to Hand.winners() for full accuracy
  const solvedObjects = hands.map((h) => h._solved).filter((s) => s != null);
  if (solvedObjects.length === hands.length) {
    const psWinners = new Set(PokersolverHand.winners(solvedObjects));
    return hands.filter((h) => h._solved != null && psWinners.has(h._solved));
  }

  // Fallback for test data without _solved
  const [first, ...rest] = hands;
  if (first === undefined) return [];
  const best = pipe(
    rest,
    A.reduce(first, (acc, h) => (compare(h, acc) === 1 ? h : acc)),
  );
  return pipe(
    hands,
    A.filter((h) => compare(h, best) === 0),
  );
}

// ---------------------------------------------------------------------------
// evaluateHoldem — combine hole + community cards and evaluate
// ---------------------------------------------------------------------------

export function evaluateHoldem(
  holeCards: readonly Card[],
  communityCards: readonly Card[],
): Either.Either<HandRank, InvalidGameState> {
  return evaluate([...holeCards, ...communityCards]);
}
