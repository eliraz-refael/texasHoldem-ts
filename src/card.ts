/**
 * Card primitives for Texas Hold'em poker.
 *
 * Provides the foundational types (Rank, Suit, Card), constructors,
 * serialization to/from pokersolver string format, and an Effect Schema
 * for property-based testing with fast-check.
 *
 * @module
 */

import { Schema } from "effect";

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

/** An immutable playing card. */
export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

/** Construct a Card value. */
export const card = (rank: Rank, suit: Suit): Card => ({ rank, suit });

// ---------------------------------------------------------------------------
// ALL_CARDS
// ---------------------------------------------------------------------------

/** Standard 52-card deck (RANKS x SUITS, ordered rank-major). */
export const ALL_CARDS: readonly Card[] = RANKS.flatMap((rank) =>
  SUITS.map((suit) => card(rank, suit)),
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

const VALID_SUITS = new Set<string>(SUITS);

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
 * @throws {Error} if the string is not a valid card representation.
 *
 * @example
 *   cardFromString("As"); // { rank: 14, suit: "s" }
 *   cardFromString("Th"); // { rank: 10, suit: "h" }
 */
export const cardFromString = (s: string): Card => {
  if (s.length !== 2) {
    throw new Error(`Invalid card string (expected 2 chars): "${s}"`);
  }

  const rankChar = s[0]!;
  const suitChar = s[1]!;

  const rank = CHAR_TO_RANK[rankChar];
  if (rank === undefined) {
    throw new Error(`Invalid rank character: "${rankChar}"`);
  }

  if (!VALID_SUITS.has(suitChar)) {
    throw new Error(`Invalid suit character: "${suitChar}"`);
  }

  return card(rank, suitChar as Suit);
};

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
