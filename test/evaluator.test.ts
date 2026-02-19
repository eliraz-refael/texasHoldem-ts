import { describe, it, expect } from "vitest";
import { evaluate, compare, winners, evaluateHoldem } from "../src/evaluator.js";
import { cardFromString } from "../src/card.js";

/** Helper to build an array of Cards from short strings. */
function cards(...strs: string[]) {
  return strs.map(cardFromString);
}

describe("evaluate", () => {
  it("detects a royal flush", () => {
    const hand = evaluate(cards("As", "Ks", "Qs", "Js", "Ts"));
    expect(hand.name).toBe("Royal Flush");
  });

  it("detects a straight flush", () => {
    const hand = evaluate(cards("9h", "8h", "7h", "6h", "5h"));
    expect(hand.name).toBe("Straight Flush");
  });

  it("detects four of a kind", () => {
    const hand = evaluate(cards("Ah", "Ad", "Ac", "As", "Kh"));
    expect(hand.name).toBe("Four of a Kind");
  });

  it("detects a full house", () => {
    const hand = evaluate(cards("Ah", "Ad", "Ac", "Kh", "Kd"));
    expect(hand.name).toBe("Full House");
  });

  it("detects a flush", () => {
    const hand = evaluate(cards("Ah", "9h", "7h", "5h", "3h"));
    expect(hand.name).toBe("Flush");
  });

  it("detects a straight", () => {
    const hand = evaluate(cards("9h", "8d", "7c", "6s", "5h"));
    expect(hand.name).toBe("Straight");
  });

  it("detects three of a kind", () => {
    const hand = evaluate(cards("Ah", "Ad", "Ac", "Kh", "Qd"));
    expect(hand.name).toBe("Three of a Kind");
  });

  it("detects two pair", () => {
    const hand = evaluate(cards("Ah", "Ad", "Kh", "Kd", "Qc"));
    expect(hand.name).toBe("Two Pair");
  });

  it("detects a pair", () => {
    const hand = evaluate(cards("Ah", "Ad", "Kh", "Qd", "Jc"));
    expect(hand.name).toBe("Pair");
  });

  it("detects high card", () => {
    const hand = evaluate(cards("Ah", "9d", "7c", "5s", "3h"));
    expect(hand.name).toBe("High Card");
  });
});

describe("compare", () => {
  it("royal flush beats full house", () => {
    const royalFlush = evaluate(cards("As", "Ks", "Qs", "Js", "Ts"));
    const fullHouse = evaluate(cards("Ah", "Ad", "Ac", "Kh", "Kd"));
    expect(compare(royalFlush, fullHouse)).toBe(1);
  });

  it("pair loses to flush", () => {
    const pair = evaluate(cards("Ah", "Ad", "Kh", "Qd", "Jc"));
    const flush = evaluate(cards("Ah", "9h", "7h", "5h", "3h"));
    expect(compare(pair, flush)).toBe(-1);
  });

  it("same rank returns 0", () => {
    const flush1 = evaluate(cards("Ah", "9h", "7h", "5h", "3h"));
    const flush2 = evaluate(cards("Ad", "9d", "7d", "5d", "3d"));
    expect(compare(flush1, flush2)).toBe(0);
  });
});

describe("winners", () => {
  it("returns empty array for empty input", () => {
    expect(winners([])).toEqual([]);
  });

  it("returns the single best hand", () => {
    const royalFlush = evaluate(cards("As", "Ks", "Qs", "Js", "Ts"));
    const pair = evaluate(cards("Ah", "Ad", "Kh", "Qd", "Jc"));
    const highCard = evaluate(cards("Ah", "9d", "7c", "5s", "3h"));

    const result = winners([royalFlush, pair, highCard]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(royalFlush);
  });

  it("returns multiple winners when hands are tied", () => {
    const flush1 = evaluate(cards("Ah", "9h", "7h", "5h", "3h"));
    const flush2 = evaluate(cards("Ad", "9d", "7d", "5d", "3d"));

    const result = winners([flush1, flush2]);
    expect(result).toHaveLength(2);
    expect(result).toContain(flush1);
    expect(result).toContain(flush2);
  });
});

describe("evaluateHoldem", () => {
  it("combines hole cards and community cards correctly", () => {
    const hole = cards("As", "Ks");
    const community = cards("Qs", "Js", "Ts", "2d", "3c");
    const hand = evaluateHoldem(hole, community);
    expect(hand.name).toBe("Royal Flush");
  });

  it("finds the best 5-card hand from 7 cards", () => {
    const hole = cards("Ah", "Ad");
    const community = cards("Ac", "Kh", "Kd", "2s", "3c");
    const hand = evaluateHoldem(hole, community);
    expect(hand.name).toBe("Full House");
  });
});
