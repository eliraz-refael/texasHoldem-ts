import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Either } from "effect";
import {
  ALL_CARDS,
  RANKS,
  SUITS,
  toPokersolverString,
  cardFromString,
} from "../../src/card.js";
import { arbCard } from "../arbitraries.js";

// ---------------------------------------------------------------------------
// Valid rank and suit characters (for building invalid-string arbitraries)
// ---------------------------------------------------------------------------

const VALID_RANK_CHARS = new Set(["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]);
const VALID_SUIT_CHARS = new Set(["c", "d", "h", "s"]);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("card -- property-based", () => {
  it("toPokersolverString always produces a 2-char string", () => {
    fc.assert(
      fc.property(arbCard, (c) => {
        const s = toPokersolverString(c);
        expect(s).toHaveLength(2);
      }),
    );
  });

  it("roundtrip: cardFromString(toPokersolverString(c)) reconstructs the card", () => {
    fc.assert(
      fc.property(arbCard, (c) => {
        const result = cardFromString(toPokersolverString(c));
        expect(Either.isRight(result)).toBe(true);
        if (Either.isRight(result)) {
          expect(result.right.rank).toBe(c.rank);
          expect(result.right.suit).toBe(c.suit);
        }
      }),
    );
  });

  it("ALL_CARDS covers all 13x4 = 52 rank x suit combinations", () => {
    // This is a deterministic property but we express it as an assertion block
    // consistent with the property style: every (rank, suit) pair appears.
    const seen = new Set<string>();
    for (const c of ALL_CARDS) {
      seen.add(`${c.rank}-${c.suit}`);
    }

    for (const rank of RANKS) {
      for (const suit of SUITS) {
        expect(seen.has(`${rank}-${suit}`)).toBe(true);
      }
    }

    expect(seen.size).toBe(52);
  });

  it("cardFromString rejects random invalid 2-char strings", () => {
    // Generate 2-char strings where at least one character is not a valid
    // rank or suit in its respective position.
    const arbInvalid2Char = fc
      .tuple(
        fc.string({ minLength: 1, maxLength: 1 }),
        fc.string({ minLength: 1, maxLength: 1 }),
      )
      .filter(([r, s]) => !VALID_RANK_CHARS.has(r) || !VALID_SUIT_CHARS.has(s))
      .map(([r, s]) => r + s);

    fc.assert(
      fc.property(arbInvalid2Char, (s) => {
        const result = cardFromString(s);
        expect(Either.isLeft(result)).toBe(true);
      }),
    );
  });

  it("every card in ALL_CARDS is unique (no duplicate rank+suit pairs)", () => {
    // Property: for any two distinct indices i, j in ALL_CARDS,
    // the cards differ in rank or suit.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: ALL_CARDS.length - 1 }),
        fc.integer({ min: 0, max: ALL_CARDS.length - 1 }),
        (i, j) => {
          if (i === j) return; // same index, trivially same card
          const a = ALL_CARDS[i]!;
          const b = ALL_CARDS[j]!;
          const same = a.rank === b.rank && a.suit === b.suit;
          expect(same).toBe(false);
        },
      ),
    );
  });
});
