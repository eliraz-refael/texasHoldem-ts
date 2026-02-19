import { describe, it, expect } from "vitest";
import { Effect, Either } from "effect";
import { shuffled, draw, dealHoleCards, dealFlop, dealOne } from "../src/deck.js";
import { SeatIndex } from "../src/brand.js";

// Basic draw/shuffle/deal count tests are covered by deck.properties.ts.
// Only error scenarios and ordering-specific checks remain.

describe("draw — error case", () => {
  it("returns Either.left (DeckExhausted) when drawing more than available", () => {
    const deck = Effect.runSync(shuffled);
    const r1 = draw(deck, 50);
    expect(Either.isRight(r1)).toBe(true);
    const small = Either.getOrThrow(r1)[1];
    const result = draw(small, 3);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("DeckExhausted");
    }
  });
});

describe("draw — ordering", () => {
  it("drawn cards come from the top of the deck", () => {
    const deck = Effect.runSync(shuffled);
    const result = draw(deck, 3);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const [drawn, remaining] = result.right;
      expect(drawn[0]).toEqual(deck[0]);
      expect(drawn[1]).toEqual(deck[1]);
      expect(drawn[2]).toEqual(deck[2]);
      expect(remaining[0]).toEqual(deck[3]);
    }
  });
});

describe("dealHoleCards — error case", () => {
  it("returns Either.left when deck is too small", () => {
    const deck = Effect.runSync(shuffled);
    const r1 = draw(deck, 51);
    expect(Either.isRight(r1)).toBe(true);
    const small = Either.getOrThrow(r1)[1];
    const result = dealHoleCards(small, [SeatIndex(0)]);
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("dealFlop — burn and ordering", () => {
  it("returns 3 cards with 1 burn", () => {
    const deck = Effect.runSync(shuffled);
    const result = dealFlop(deck);
    expect(Either.isRight(result)).toBe(true);

    if (Either.isRight(result)) {
      const [flop, remaining] = result.right;

      expect(flop).toHaveLength(3);
      expect(flop[0]).toEqual(deck[1]);
      expect(flop[1]).toEqual(deck[2]);
      expect(flop[2]).toEqual(deck[3]);
      expect(remaining).toHaveLength(52 - 4);
    }
  });

  it("returns Either.left when deck has fewer than 4 cards", () => {
    const deck = Effect.runSync(shuffled);
    const r1 = draw(deck, 49);
    expect(Either.isRight(r1)).toBe(true);
    const small = (r1 as Extract<typeof r1, { _tag: "Right" }>).right[1];
    expect(small).toHaveLength(3);
    const result = dealFlop(small);
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("dealOne — burn and ordering", () => {
  it("returns 1 card with 1 burn", () => {
    const deck = Effect.runSync(shuffled);
    const result = dealOne(deck);
    expect(Either.isRight(result)).toBe(true);

    if (Either.isRight(result)) {
      const [dealtCard, remaining] = result.right;
      expect(dealtCard).toEqual(deck[1]);
      expect(remaining).toHaveLength(52 - 2);
    }
  });

  it("returns Either.left when deck has fewer than 2 cards", () => {
    const deck = Effect.runSync(shuffled);
    const r1 = draw(deck, 51);
    expect(Either.isRight(r1)).toBe(true);
    const small = (r1 as Extract<typeof r1, { _tag: "Right" }>).right[1];
    expect(small).toHaveLength(1);
    const result = dealOne(small);
    expect(Either.isLeft(result)).toBe(true);
  });
});
