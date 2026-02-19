import { Array as A, Chunk, Effect, Either, HashMap, Random, pipe } from "effect";
import type { Card } from "./card.js";
import { ALL_CARDS } from "./card.js";
import type { SeatIndex } from "./brand.js";
import { DeckExhausted } from "./error.js";

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
 * @returns Either a tuple of `[drawn, remaining]`, or `DeckExhausted`.
 */
export function draw(
  deck: Deck,
  count: number,
): Either.Either<[readonly Card[], Deck], DeckExhausted> {
  if (count > deck.length) {
    return Either.left(
      new DeckExhausted({ requested: count, remaining: deck.length }),
    );
  }
  const drawn: readonly Card[] = A.take(deck, count);
  const remaining: Deck = A.drop(deck, count);
  return Either.right([drawn, remaining]);
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
 * @returns Either a tuple of `[holeCardsMap, remaining]`, or `DeckExhausted`.
 */
export function dealHoleCards(
  deck: Deck,
  seatOrder: readonly SeatIndex[],
): Either.Either<
  [HashMap.HashMap<SeatIndex, readonly [Card, Card]>, Deck],
  DeckExhausted
> {
  const needed = seatOrder.length * 2;
  if (needed > deck.length) {
    return Either.left(
      new DeckExhausted({ requested: needed, remaining: deck.length }),
    );
  }

  let map = HashMap.empty<SeatIndex, readonly [Card, Card]>();
  let offset = 0;

  for (const seat of seatOrder) {
    const card1 = deck[offset];
    const card2 = deck[offset + 1];
    if (card1 === undefined || card2 === undefined) {
      return Either.left(
        new DeckExhausted({ requested: needed, remaining: deck.length }),
      );
    }
    map = HashMap.set(map, seat, [card1, card2] as const);
    offset += 2;
  }

  const remaining: Deck = A.drop(deck, offset);
  return Either.right([map, remaining]);
}

// ---------------------------------------------------------------------------
// dealFlop — burn 1, deal 3
// ---------------------------------------------------------------------------

/**
 * Deal the flop: burn one card, then deal three.
 *
 * @returns Either a tuple of `[flop, remaining]`, or `DeckExhausted`.
 */
export function dealFlop(
  deck: Deck,
): Either.Either<[readonly [Card, Card, Card], Deck], DeckExhausted> {
  if (deck.length < 4) {
    return Either.left(
      new DeckExhausted({ requested: 4, remaining: deck.length }),
    );
  }
  // burn 1, deal 3
  const c1 = deck[1];
  const c2 = deck[2];
  const c3 = deck[3];
  if (c1 === undefined || c2 === undefined || c3 === undefined) {
    return Either.left(
      new DeckExhausted({ requested: 4, remaining: deck.length }),
    );
  }
  const flop = [c1, c2, c3] as const;
  const remaining: Deck = A.drop(deck, 4);
  return Either.right([flop, remaining]);
}

// ---------------------------------------------------------------------------
// dealOne — burn 1, deal 1 (for turn / river)
// ---------------------------------------------------------------------------

/**
 * Deal a single community card: burn one, deal one.
 * Used for the turn and river.
 *
 * @returns Either a tuple of `[card, remaining]`, or `DeckExhausted`.
 */
export function dealOne(
  deck: Deck,
): Either.Either<[Card, Deck], DeckExhausted> {
  if (deck.length < 2) {
    return Either.left(
      new DeckExhausted({ requested: 2, remaining: deck.length }),
    );
  }
  // burn 1, deal 1
  const dealtCard = deck[1];
  if (dealtCard === undefined) {
    return Either.left(
      new DeckExhausted({ requested: 2, remaining: deck.length }),
    );
  }
  const remaining: Deck = A.drop(deck, 2);
  return Either.right([dealtCard, remaining]);
}
