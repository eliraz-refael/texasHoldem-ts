import { describe, it, expect } from "vitest";
import {
  ALL_CARDS,
  RANKS,
  SUITS,
  toPokersolverString,
  cardFromString,
  card,
} from "../src/card.js";

describe("RANKS and SUITS", () => {
  it("RANKS has 13 elements", () => {
    expect(RANKS).toHaveLength(13);
  });

  it("SUITS has 4 elements", () => {
    expect(SUITS).toHaveLength(4);
  });
});

describe("ALL_CARDS", () => {
  it("has exactly 52 cards", () => {
    expect(ALL_CARDS).toHaveLength(52);
  });

  it("has all unique cards", () => {
    const serialized = ALL_CARDS.map(toPokersolverString);
    const unique = new Set(serialized);
    expect(unique.size).toBe(52);
  });
});

describe("toPokersolverString", () => {
  it("converts ace of spades to 'As'", () => {
    expect(toPokersolverString({ rank: 14, suit: "s" })).toBe("As");
  });

  it("converts 10 of hearts to 'Th'", () => {
    expect(toPokersolverString({ rank: 10, suit: "h" })).toBe("Th");
  });

  it("converts 2 of clubs to '2c'", () => {
    expect(toPokersolverString({ rank: 2, suit: "c" })).toBe("2c");
  });

  it("converts king of diamonds to 'Kd'", () => {
    expect(toPokersolverString({ rank: 13, suit: "d" })).toBe("Kd");
  });

  it("converts jack of hearts to 'Jh'", () => {
    expect(toPokersolverString({ rank: 11, suit: "h" })).toBe("Jh");
  });

  it("converts queen of spades to 'Qs'", () => {
    expect(toPokersolverString({ rank: 12, suit: "s" })).toBe("Qs");
  });
});

describe("cardFromString", () => {
  it("parses 'As' to ace of spades", () => {
    const c = cardFromString("As");
    expect(c.rank).toBe(14);
    expect(c.suit).toBe("s");
  });

  it("parses 'Th' to 10 of hearts", () => {
    const c = cardFromString("Th");
    expect(c.rank).toBe(10);
    expect(c.suit).toBe("h");
  });

  it("roundtrips: cardFromString(toPokersolverString(card)) === card", () => {
    for (const c of ALL_CARDS) {
      const roundtripped = cardFromString(toPokersolverString(c));
      expect(roundtripped).toEqual(c);
    }
  });

  it("rejects empty string", () => {
    expect(() => cardFromString("")).toThrow();
  });

  it("rejects single character", () => {
    expect(() => cardFromString("A")).toThrow();
  });

  it("rejects three-character string", () => {
    expect(() => cardFromString("Asd")).toThrow();
  });

  it("rejects invalid rank character", () => {
    expect(() => cardFromString("Xs")).toThrow();
  });

  it("rejects invalid suit character", () => {
    expect(() => cardFromString("Ax")).toThrow();
  });
});
