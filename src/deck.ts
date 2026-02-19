import { Effect, Random, Chunk } from "effect";
import type { Card } from "./card.js";
import { ALL_CARDS } from "./card.js";
import type { SeatIndex } from "./brand.js";

// ---------------------------------------------------------------------------
// Deck type
// ---------------------------------------------------------------------------

/** A deck is an ordered, immutable sequence of cards. */
export type Deck = readonly Card[];

// ---------------------------------------------------------------------------
// shuffled — the ONLY effectful operation in the entire engine
// ---------------------------------------------------------------------------

/**
 * Returns a freshly shuffled 52-card deck.
 *
 * This is the single effectful entry point for the engine: every other
 * function in every other module is pure.
 */
export const shuffled: Effect.Effect<Deck> = Effect.map(
  Random.shuffle(ALL_CARDS),
  (chunk): Deck => Chunk.toReadonlyArray(chunk),
);

// ---------------------------------------------------------------------------
// draw — take N cards from the top of the deck
// ---------------------------------------------------------------------------

/**
 * Draw `count` cards from the top of the deck.
 *
 * @returns A tuple of `[drawn, remaining]`.
 * @throws {Error} If the deck does not contain enough cards (programming error).
 */
export function draw(deck: Deck, count: number): [readonly Card[], Deck] {
  if (count > deck.length) {
    throw new Error(
      `Cannot draw ${count} card(s) from a deck with ${deck.length} card(s)`,
    );
  }
  const drawn: readonly Card[] = deck.slice(0, count);
  const remaining: Deck = deck.slice(count);
  return [drawn, remaining];
}

// ---------------------------------------------------------------------------
// dealHoleCards — deal 2 cards per seat, sequentially
// ---------------------------------------------------------------------------

/**
 * Deal two hole cards to each seat in order.
 *
 * Cards are dealt sequentially: seat_0 gets [card_0, card_1],
 * seat_1 gets [card_2, card_3], and so on.
 *
 * @returns A tuple of `[holeCardsMap, remaining]`.
 */
export function dealHoleCards(
  deck: Deck,
  seatOrder: readonly SeatIndex[],
): [ReadonlyMap<SeatIndex, readonly [Card, Card]>, Deck] {
  const needed = seatOrder.length * 2;
  if (needed > deck.length) {
    throw new Error(
      `Cannot deal hole cards to ${seatOrder.length} seat(s): need ${needed} cards but deck has ${deck.length}`,
    );
  }

  const map = new Map<SeatIndex, readonly [Card, Card]>();
  let offset = 0;

  for (const seat of seatOrder) {
    const card1 = deck[offset]!;
    const card2 = deck[offset + 1]!;
    map.set(seat, [card1, card2] as const);
    offset += 2;
  }

  const remaining: Deck = deck.slice(offset);
  return [map, remaining];
}

// ---------------------------------------------------------------------------
// dealFlop — burn 1, deal 3
// ---------------------------------------------------------------------------

/**
 * Deal the flop: burn one card, then deal three.
 *
 * @returns A tuple of `[flop, remaining]` where `flop` is exactly 3 cards.
 */
export function dealFlop(
  deck: Deck,
): [readonly [Card, Card, Card], Deck] {
  if (deck.length < 4) {
    throw new Error(
      `Cannot deal flop: need 4 cards (1 burn + 3 flop) but deck has ${deck.length}`,
    );
  }
  // burn 1, deal 3
  const flop = [deck[1]!, deck[2]!, deck[3]!] as const;
  const remaining: Deck = deck.slice(4);
  return [flop, remaining];
}

// ---------------------------------------------------------------------------
// dealOne — burn 1, deal 1 (for turn / river)
// ---------------------------------------------------------------------------

/**
 * Deal a single community card: burn one, deal one.
 * Used for the turn and river.
 *
 * @returns A tuple of `[card, remaining]`.
 */
export function dealOne(deck: Deck): [Card, Deck] {
  if (deck.length < 2) {
    throw new Error(
      `Cannot deal one card: need 2 cards (1 burn + 1 deal) but deck has ${deck.length}`,
    );
  }
  // burn 1, deal 1
  const card = deck[1]!;
  const remaining: Deck = deck.slice(2);
  return [card, remaining];
}
