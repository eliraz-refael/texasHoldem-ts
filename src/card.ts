/**
 * Card primitives for Texas Hold'em poker.
 *
 * Provides the foundational types (Rank, Suit, Card), constructors,
 * serialization to/from pokersolver string format, and an Effect Schema
 * for property-based testing with fast-check.
 *
 * @module
 */

import { Array as A, Data, Either, Schema, pipe } from "effect";
import { InvalidCard } from "./error.js";

// ---------------------------------------------------------------------------
// Rank
// ---------------------------------------------------------------------------

/** Numeric rank: 2-9 pip cards, 10, 11=J, 12=Q, 13=K, 14=A */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

/** All ranks in ascending order. */
export const RANKS: readonly Rank[] = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
] as const;

// ---------------------------------------------------------------------------
// Suit
// ---------------------------------------------------------------------------

/** Single-char suit: clubs, diamonds, hearts, spades. */
export type Suit = "c" | "d" | "h" | "s";

/** All suits in alphabetical order. */
export const SUITS: readonly Suit[] = ["c", "d", "h", "s"] as const;

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

/** An immutable playing card with structural equality via Data.struct. */
export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

/** Construct a Card value with structural equality. */
export const card = (rank: Rank, suit: Suit): Card =>
  Data.struct({ rank, suit });

// ---------------------------------------------------------------------------
// ALL_CARDS
// ---------------------------------------------------------------------------

/** Standard 52-card deck (RANKS x SUITS, ordered rank-major). */
export const ALL_CARDS: readonly Card[] = pipe(
  RANKS,
  A.flatMap((rank) => A.map(SUITS, (suit) => card(rank, suit))),
);

// ---------------------------------------------------------------------------
// Pokersolver string conversion
// ---------------------------------------------------------------------------

const RANK_TO_CHAR: Record<Rank, string> = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "T",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

const CHAR_TO_RANK: Record<string, Rank> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

function isSuit(s: string): s is Suit {
  return (SUITS as readonly string[]).includes(s);
}

/**
 * Convert a Card to its two-character pokersolver string.
 *
 * @example
 *   toPokersolverString({ rank: 14, suit: "s" }); // "As"
 *   toPokersolverString({ rank: 10, suit: "h" }); // "Th"
 */
export const toPokersolverString = (c: Card): string =>
  RANK_TO_CHAR[c.rank] + c.suit;

/**
 * Parse a two-character pokersolver string back into a Card.
 *
 * Returns `Either.right(Card)` on success, or `Either.left(InvalidCard)` on
 * failure.
 */
export const cardFromString = (s: string): Either.Either<Card, InvalidCard> => {
  if (s.length !== 2) {
    return Either.left(
      new InvalidCard({
        input: s,
        reason: `Expected 2 chars, got ${s.length}`,
      }),
    );
  }

  const rankChar = s[0];
  const suitChar = s[1];
  if (rankChar === undefined || suitChar === undefined) {
    return Either.left(
      new InvalidCard({ input: s, reason: `Expected 2 chars, got ${s.length}` }),
    );
  }

  const rank = CHAR_TO_RANK[rankChar];
  if (rank === undefined) {
    return Either.left(
      new InvalidCard({
        input: s,
        reason: `Invalid rank character: "${rankChar}"`,
      }),
    );
  }

  if (!isSuit(suitChar)) {
    return Either.left(
      new InvalidCard({
        input: s,
        reason: `Invalid suit character: "${suitChar}"`,
      }),
    );
  }

  return Either.right(card(rank, suitChar));
};

/**
 * Parse a card string, throwing on failure.
 * Convenience for tests and situations where invalid input is a programming error.
 */
export const unsafeCardFromString = (s: string): Card =>
  Either.getOrThrowWith(cardFromString(s), (e) => new Error(e.reason));

// ---------------------------------------------------------------------------
// Effect Schema (for Arbitrary / fast-check integration)
// ---------------------------------------------------------------------------

/** Schema for Rank — validates that a number is one of the 13 valid ranks. */
export const RankSchema: Schema.Schema<Rank> = Schema.Literal(
  ...RANKS,
);

/** Schema for Suit — validates that a string is one of the 4 valid suits. */
export const SuitSchema: Schema.Schema<Suit> = Schema.Literal(
  ...SUITS,
);

/** Schema for Card — a struct with validated rank and suit fields. */
export const CardSchema: Schema.Schema<Card> = Schema.Struct({
  rank: RankSchema,
  suit: SuitSchema,
});
