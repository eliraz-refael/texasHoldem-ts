import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Either } from "effect";
import { evaluate, compare } from "../../src/evaluator.js";
import type { HandRank } from "../../src/evaluator.js";
import { ALL_CARDS, card } from "../../src/card.js";
import type { Card } from "../../src/card.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Evaluate cards or throw — for use in property bodies. */
function evalOrThrow(cards: readonly Card[]): HandRank {
  const result = evaluate(cards);
  if (Either.isLeft(result)) throw new Error(result.left.reason);
  return result.right;
}

/** A known royal flush (A-K-Q-J-T of spades). */
const ROYAL_FLUSH_CARDS: readonly Card[] = [
  card(14, "s"),
  card(13, "s"),
  card(12, "s"),
  card(11, "s"),
  card(10, "s"),
];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Random 5-card hand drawn from the full 52-card deck. */
const arbHand5 = fc.shuffledSubarray([...ALL_CARDS], {
  minLength: 5,
  maxLength: 5,
});

/** Random 5-7 card hand drawn from the full 52-card deck. */
const arbHand5to7 = fc.integer({ min: 5, max: 7 }).chain((n) =>
  fc.shuffledSubarray([...ALL_CARDS], { minLength: n, maxLength: n }),
);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("evaluator -- property-based", () => {
  it("determinism: same input always produces the same output", () => {
    fc.assert(
      fc.property(arbHand5, (hand) => {
        const a = evalOrThrow(hand);
        const b = evalOrThrow(hand);

        expect(a.name).toBe(b.name);
        expect(a.description).toBe(b.description);
        expect(a.rank).toBe(b.rank);
        expect(a.bestCards).toEqual(b.bestCards);
      }),
    );
  });

  it("compare is a total order (reflexive, antisymmetric, transitive)", () => {
    fc.assert(
      fc.property(arbHand5, arbHand5, arbHand5, (h1, h2, h3) => {
        const a = evalOrThrow(h1);
        const b = evalOrThrow(h2);
        const c = evalOrThrow(h3);

        // Reflexive: compare(a, a) === 0
        expect(compare(a, a)).toBe(0);

        // Antisymmetric: compare(a, b) + compare(b, a) === 0
        const ab = compare(a, b);
        const ba = compare(b, a);
        expect(ab + ba).toBe(0);

        // Transitive: if a >= b and b >= c then a >= c
        const bc = compare(b, c);
        if (ab >= 0 && bc >= 0) {
          expect(compare(a, c)).toBeGreaterThanOrEqual(0);
        }
        if (ab <= 0 && bc <= 0) {
          expect(compare(a, c)).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it("royal flush beats or ties any other hand", () => {
    fc.assert(
      fc.property(arbHand5, (hand) => {
        const royalFlush = evalOrThrow(ROYAL_FLUSH_CARDS);
        const other = evalOrThrow(hand);

        // Royal flush should never lose: compare >= 0
        expect(compare(royalFlush, other)).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("any valid 5-7 card subset of ALL_CARDS evaluates successfully", () => {
    fc.assert(
      fc.property(arbHand5to7, (hand) => {
        const result = evaluate(hand);

        expect(Either.isRight(result)).toBe(true);

        if (Either.isRight(result)) {
          const hr = result.right;
          expect(typeof hr.name).toBe("string");
          expect(hr.name.length).toBeGreaterThan(0);
          expect(typeof hr.rank).toBe("number");
          expect(hr.bestCards.length).toBeGreaterThan(0);
        }
      }),
    );
  });
});
