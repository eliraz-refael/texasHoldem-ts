import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { shuffled, draw, dealHoleCards, dealFlop, dealOne } from "../src/deck.js";
import { toPokersolverString } from "../src/card.js";
import { SeatIndex } from "../src/brand.js";

describe("shuffled", () => {
  it("returns 52 cards", () => {
    const deck = Effect.runSync(shuffled);
    expect(deck).toHaveLength(52);
  });

  it("returns 52 unique cards", () => {
    const deck = Effect.runSync(shuffled);
    const serialized = deck.map(toPokersolverString);
    const unique = new Set(serialized);
    expect(unique.size).toBe(52);
  });
});

describe("draw", () => {
  it("draws the requested number of cards", () => {
    const deck = Effect.runSync(shuffled);
    const [drawn, remaining] = draw(deck, 5);
    expect(drawn).toHaveLength(5);
    expect(remaining).toHaveLength(47);
  });

  it("drawn cards come from the top of the deck", () => {
    const deck = Effect.runSync(shuffled);
    const [drawn, remaining] = draw(deck, 3);
    expect(drawn[0]).toEqual(deck[0]);
    expect(drawn[1]).toEqual(deck[1]);
    expect(drawn[2]).toEqual(deck[2]);
    expect(remaining[0]).toEqual(deck[3]);
  });

  it("throws when drawing more than available", () => {
    const deck = Effect.runSync(shuffled);
    const [, small] = draw(deck, 50);
    expect(() => draw(small, 3)).toThrow(
      /Cannot draw 3 card\(s\) from a deck with 2 card\(s\)/,
    );
  });

  it("draws zero cards without error", () => {
    const deck = Effect.runSync(shuffled);
    const [drawn, remaining] = draw(deck, 0);
    expect(drawn).toHaveLength(0);
    expect(remaining).toHaveLength(52);
  });
});

describe("dealHoleCards", () => {
  it("deals 2 cards per seat", () => {
    const deck = Effect.runSync(shuffled);
    const seats = [SeatIndex(0), SeatIndex(1), SeatIndex(2)];
    const [holeMap, remaining] = dealHoleCards(deck, seats);

    expect(holeMap.size).toBe(3);
    for (const seat of seats) {
      const hole = holeMap.get(seat);
      expect(hole).toBeDefined();
      expect(hole).toHaveLength(2);
    }
    // 3 seats x 2 cards = 6 cards dealt
    expect(remaining).toHaveLength(52 - 6);
  });

  it("deals cards in sequential order", () => {
    const deck = Effect.runSync(shuffled);
    const seats = [SeatIndex(0), SeatIndex(1)];
    const [holeMap] = dealHoleCards(deck, seats);

    const seat0 = holeMap.get(SeatIndex(0))!;
    const seat1 = holeMap.get(SeatIndex(1))!;
    expect(seat0[0]).toEqual(deck[0]);
    expect(seat0[1]).toEqual(deck[1]);
    expect(seat1[0]).toEqual(deck[2]);
    expect(seat1[1]).toEqual(deck[3]);
  });

  it("throws when deck is too small", () => {
    const [, small] = draw(Effect.runSync(shuffled), 51);
    expect(() => dealHoleCards(small, [SeatIndex(0)])).toThrow();
  });
});

describe("dealFlop", () => {
  it("returns 3 cards with 1 burn", () => {
    const deck = Effect.runSync(shuffled);
    const [flop, remaining] = dealFlop(deck);

    expect(flop).toHaveLength(3);
    // burn is deck[0], flop is deck[1], deck[2], deck[3]
    expect(flop[0]).toEqual(deck[1]);
    expect(flop[1]).toEqual(deck[2]);
    expect(flop[2]).toEqual(deck[3]);
    // 1 burn + 3 flop = 4 cards removed
    expect(remaining).toHaveLength(52 - 4);
  });

  it("throws when deck has fewer than 4 cards", () => {
    const [, small] = draw(Effect.runSync(shuffled), 49);
    expect(small).toHaveLength(3);
    expect(() => dealFlop(small)).toThrow();
  });
});

describe("dealOne", () => {
  it("returns 1 card with 1 burn", () => {
    const deck = Effect.runSync(shuffled);
    const [dealtCard, remaining] = dealOne(deck);

    // burn is deck[0], dealt card is deck[1]
    expect(dealtCard).toEqual(deck[1]);
    // 1 burn + 1 deal = 2 cards removed
    expect(remaining).toHaveLength(52 - 2);
  });

  it("throws when deck has fewer than 2 cards", () => {
    const [, small] = draw(Effect.runSync(shuffled), 51);
    expect(small).toHaveLength(1);
    expect(() => dealOne(small)).toThrow();
  });
});
