import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Effect, Either, HashMap } from "effect";
import { shuffled, draw, dealHoleCards } from "../../src/deck.js";
import type { Deck } from "../../src/deck.js";
import { ALL_CARDS, toPokersolverString } from "../../src/card.js";
import { SeatIndex } from "../../src/brand.js";
import { arbSeatIndex } from "../arbitraries.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Serialize a deck (or card array) into a sorted array of pokersolver strings
 *  so we can compare multisets independent of ordering. */
const toSortedStrings = (cards: readonly { rank: number; suit: string }[]) =>
  cards.map((c) => toPokersolverString(c as any)).sort();

const ALL_CARDS_SORTED = toSortedStrings(ALL_CARDS);

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A freshly shuffled deck wrapped in an arbitrary (uses Effect.runSync). */
const arbDeck: fc.Arbitrary<Deck> = fc.constant(null).map(() =>
  Effect.runSync(shuffled),
);

/** A draw count in [0, 52]. */
const arbDrawCount = fc.integer({ min: 0, max: 52 });

/** A list of 2-10 unique seat indices, sorted ascending. */
const arbSeatOrder = fc
  .integer({ min: 2, max: 10 })
  .chain((count) =>
    fc
      .shuffledSubarray([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], {
        minLength: count,
        maxLength: count,
      })
      .map((seats) => [...seats].sort((a, b) => a - b).map((s) => SeatIndex(s))),
  );

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("deck -- property-based", () => {
  it("shuffled deck is a permutation of ALL_CARDS (same multiset)", () => {
    fc.assert(
      fc.property(arbDeck, (deck) => {
        expect(deck).toHaveLength(52);

        // Sorted serialized strings must match exactly
        const deckSorted = toSortedStrings(deck);
        expect(deckSorted).toEqual(ALL_CARDS_SORTED);
      }),
      { numRuns: 50 },
    );
  });

  it("draw(deck, n) returns exactly n cards with remaining = deck.length - n", () => {
    fc.assert(
      fc.property(arbDeck, arbDrawCount, (deck, n) => {
        const result = draw(deck, n);
        expect(Either.isRight(result)).toBe(true);

        if (Either.isRight(result)) {
          const [drawn, remaining] = result.right;
          expect(drawn).toHaveLength(n);
          expect(remaining).toHaveLength(52 - n);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("union of drawn + remaining equals the original deck (set preservation)", () => {
    fc.assert(
      fc.property(arbDeck, arbDrawCount, (deck, n) => {
        const result = draw(deck, n);
        expect(Either.isRight(result)).toBe(true);

        if (Either.isRight(result)) {
          const [drawn, remaining] = result.right;
          const reunited = [...drawn, ...remaining];

          // The concatenation of drawn ++ remaining must be the same cards
          // in the same order as the original deck.
          expect(reunited).toHaveLength(deck.length);
          const reunitedStrings = reunited.map(toPokersolverString);
          const deckStrings = deck.map(toPokersolverString);
          expect(reunitedStrings).toEqual(deckStrings);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("dealHoleCards gives 2 unique cards per seat, all distinct across seats", () => {
    fc.assert(
      fc.property(arbDeck, arbSeatOrder, (deck, seats) => {
        const result = dealHoleCards(deck, seats);
        expect(Either.isRight(result)).toBe(true);

        if (Either.isRight(result)) {
          const [holeMap, remaining] = result.right;

          // Correct number of seats dealt
          expect(HashMap.size(holeMap)).toBe(seats.length);

          // Collect every dealt card
          const allDealt: string[] = [];

          for (const seat of seats) {
            const opt = HashMap.get(holeMap, seat);
            expect(opt._tag).toBe("Some");
            if (opt._tag === "Some") {
              const [c1, c2] = opt.value;
              const s1 = toPokersolverString(c1);
              const s2 = toPokersolverString(c2);
              // Two cards within a seat are different
              expect(s1).not.toBe(s2);
              allDealt.push(s1, s2);
            }
          }

          // All dealt cards across all seats are distinct
          const uniqueDealt = new Set(allDealt);
          expect(uniqueDealt.size).toBe(allDealt.length);

          // Total dealt + remaining = 52
          expect(allDealt.length + remaining.length).toBe(52);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("drawing all 52 cards empties the deck", () => {
    fc.assert(
      fc.property(arbDeck, (deck) => {
        const result = draw(deck, 52);
        expect(Either.isRight(result)).toBe(true);

        if (Either.isRight(result)) {
          const [drawn, remaining] = result.right;
          expect(drawn).toHaveLength(52);
          expect(remaining).toHaveLength(0);

          // The drawn cards are the full standard deck
          const drawnSorted = toSortedStrings(drawn);
          expect(drawnSorted).toEqual(ALL_CARDS_SORTED);
        }
      }),
      { numRuns: 50 },
    );
  });
});
