import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Either } from "effect";
import { evaluate, compare, winners } from "../../src/evaluator.js";
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

  it("same-category hands: better cards always win or tie, never lose to worse", () => {
    // Generate two distinct 5-card hands from the same deck
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...ALL_CARDS], { minLength: 10, maxLength: 10 }),
        (tenCards) => {
          const hand1 = tenCards.slice(0, 5);
          const hand2 = tenCards.slice(5, 10);
          const a = evalOrThrow(hand1);
          const b = evalOrThrow(hand2);

          // Only test same-category pairs
          if (a.rank !== b.rank) return;

          const cmp = compare(a, b);
          const rev = compare(b, a);

          // Antisymmetric within same category
          expect(cmp + rev).toBe(0);

          // If a beats b, winners() should agree
          if (cmp === 1) {
            const ws = winners([a, b]);
            expect(ws).toHaveLength(1);
            expect(ws[0]).toBe(a);
          } else if (cmp === -1) {
            const ws = winners([a, b]);
            expect(ws).toHaveLength(1);
            expect(ws[0]).toBe(b);
          } else {
            const ws = winners([a, b]);
            expect(ws).toHaveLength(2);
          }
        },
      ),
    );
  });

  it("winners() always returns a non-empty subset of input", () => {
    fc.assert(
      fc.property(
        fc.array(arbHand5, { minLength: 1, maxLength: 5 }),
        (hands) => {
          const evaluated = hands.map((h) => evalOrThrow(h));
          const ws = winners(evaluated);

          expect(ws.length).toBeGreaterThanOrEqual(1);
          expect(ws.length).toBeLessThanOrEqual(evaluated.length);
          for (const w of ws) {
            expect(evaluated).toContain(w);
          }
        },
      ),
    );
  });

  it("winners() result all compare equal to each other", () => {
    fc.assert(
      fc.property(
        fc.array(arbHand5, { minLength: 2, maxLength: 5 }),
        (hands) => {
          const evaluated = hands.map((h) => evalOrThrow(h));
          const ws = winners(evaluated);

          // All winners should compare as equal
          for (let i = 0; i < ws.length; i++) {
            for (let j = i + 1; j < ws.length; j++) {
              expect(compare(ws[i]!, ws[j]!)).toBe(0);
            }
          }

          // Each winner should beat or tie every non-winner
          const nonWinners = evaluated.filter((h) => !ws.includes(h));
          for (const w of ws) {
            for (const nw of nonWinners) {
              expect(compare(w, nw)).toBe(1);
            }
          }
        },
      ),
    );
  });
});
