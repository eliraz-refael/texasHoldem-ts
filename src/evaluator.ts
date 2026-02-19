import { Array as A, Either, Order, pipe } from "effect";
import { Hand as PokersolverHand } from "pokersolver";
import type { Card } from "./card.js";
import { toPokersolverString } from "./card.js";
import { InvalidGameState } from "./error.js";

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
  return HandRankOrder(a, b);
}

// ---------------------------------------------------------------------------
// winners — return the best hand(s) from a list (may be multiple for ties)
// ---------------------------------------------------------------------------

export function winners(hands: readonly HandRank[]): readonly HandRank[] {
  const [first, ...rest] = hands;
  if (first === undefined) return [];

  const best = pipe(
    rest,
    A.reduce(first, (acc, h) =>
      Order.greaterThan(HandRankOrder)(h, acc) ? h : acc,
    ),
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
