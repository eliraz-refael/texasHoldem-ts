import { describe, it, expect } from "vitest";
import { Either } from "effect";
import {
  toPokersolverString,
  cardFromString,
  unsafeCardFromString,
} from "../src/card.js";

// ALL_CARDS, uniqueness, roundtrip, and invalid-string rejection are covered
// by card.properties.ts. Only known-value sanity checks and error cases remain.

describe("toPokersolverString — known values", () => {
  it("converts ace of spades to 'As'", () => {
    expect(toPokersolverString({ rank: 14, suit: "s" })).toBe("As");
  });

  it("converts 10 of hearts to 'Th'", () => {
    expect(toPokersolverString({ rank: 10, suit: "h" })).toBe("Th");
  });

  it("converts 2 of clubs to '2c'", () => {
    expect(toPokersolverString({ rank: 2, suit: "c" })).toBe("2c");
  });
});

describe("cardFromString — error cases", () => {
  it("returns Either.left for empty string", () => {
    expect(Either.isLeft(cardFromString(""))).toBe(true);
  });

  it("returns Either.left for single character", () => {
    expect(Either.isLeft(cardFromString("A"))).toBe(true);
  });

  it("returns Either.left for three-character string", () => {
    expect(Either.isLeft(cardFromString("Asd"))).toBe(true);
  });

  it("returns Either.left for invalid rank character", () => {
    const result = cardFromString("Xs");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("InvalidCard");
    }
  });

  it("returns Either.left for invalid suit character", () => {
    const result = cardFromString("Ax");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("InvalidCard");
    }
  });
});

describe("unsafeCardFromString", () => {
  it("throws for invalid string", () => {
    expect(() => unsafeCardFromString("XX")).toThrow();
  });
});
