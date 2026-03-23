import { describe, it, expect } from "vitest";
import { Either } from "effect";
import { evaluate, compare, winners, evaluateHoldem } from "../src/evaluator.js";
import { unsafeCardFromString } from "../src/card.js";

/** Helper to build an array of Cards from short strings. */
function cards(...strs: string[]) {
  return strs.map(unsafeCardFromString);
}

/** Helper to unwrap evaluate result */
function evalOrThrow(...strs: string[]) {
  const result = evaluate(cards(...strs));
  if (Either.isLeft(result)) throw new Error(result.left.reason);
  return result.right;
}

describe("evaluate", () => {
  it("detects a royal flush", () => {
    const hand = evalOrThrow("As", "Ks", "Qs", "Js", "Ts");
    // pokersolver uses name="Straight Flush", description="Royal Flush"
    expect(hand.description).toBe("Royal Flush");
  });

  it("detects a straight flush", () => {
    const hand = evalOrThrow("9h", "8h", "7h", "6h", "5h");
    expect(hand.name).toBe("Straight Flush");
  });

  it("detects four of a kind", () => {
    const hand = evalOrThrow("Ah", "Ad", "Ac", "As", "Kh");
    expect(hand.name).toBe("Four of a Kind");
  });

  it("detects a full house", () => {
    const hand = evalOrThrow("Ah", "Ad", "Ac", "Kh", "Kd");
    expect(hand.name).toBe("Full House");
  });

  it("detects a flush", () => {
    const hand = evalOrThrow("Ah", "9h", "7h", "5h", "3h");
    expect(hand.name).toBe("Flush");
  });

  it("detects a straight", () => {
    const hand = evalOrThrow("9h", "8d", "7c", "6s", "5h");
    expect(hand.name).toBe("Straight");
  });

  it("detects three of a kind", () => {
    const hand = evalOrThrow("Ah", "Ad", "Ac", "Kh", "Qd");
    expect(hand.name).toBe("Three of a Kind");
  });

  it("detects two pair", () => {
    const hand = evalOrThrow("Ah", "Ad", "Kh", "Kd", "Qc");
    expect(hand.name).toBe("Two Pair");
  });

  it("detects a pair", () => {
    const hand = evalOrThrow("Ah", "Ad", "Kh", "Qd", "Jc");
    expect(hand.name).toBe("Pair");
  });

  it("detects high card", () => {
    const hand = evalOrThrow("Ah", "9d", "7c", "5s", "3h");
    expect(hand.name).toBe("High Card");
  });

  it("returns Either.right for valid cards", () => {
    const result = evaluate(cards("As", "Ks", "Qs", "Js", "Ts"));
    expect(Either.isRight(result)).toBe(true);
  });
});

describe("compare", () => {
  it("royal flush beats full house", () => {
    const royalFlush = evalOrThrow("As", "Ks", "Qs", "Js", "Ts");
    const fullHouse = evalOrThrow("Ah", "Ad", "Ac", "Kh", "Kd");
    expect(compare(royalFlush, fullHouse)).toBe(1);
  });

  it("pair loses to flush", () => {
    const pair = evalOrThrow("Ah", "Ad", "Kh", "Qd", "Jc");
    const flush = evalOrThrow("Ah", "9h", "7h", "5h", "3h");
    expect(compare(pair, flush)).toBe(-1);
  });

  it("same rank returns 0", () => {
    const flush1 = evalOrThrow("Ah", "9h", "7h", "5h", "3h");
    const flush2 = evalOrThrow("Ad", "9d", "7d", "5d", "3d");
    expect(compare(flush1, flush2)).toBe(0);
  });

  it("pair of 4s beats pair of 3s (same category, different value)", () => {
    const pair3 = evalOrThrow("3h", "3d", "7c", "8s", "Jd");
    const pair4 = evalOrThrow("4h", "4d", "7c", "8s", "Jd");
    expect(pair3.rank).toBe(pair4.rank); // same category
    expect(compare(pair4, pair3)).toBe(1);
    expect(compare(pair3, pair4)).toBe(-1);
  });

  it("same pair, higher kicker wins", () => {
    const kingsWithAce = evalOrThrow("Kh", "Kd", "Ac", "5s", "3d");
    const kingsWithQueen = evalOrThrow("Kc", "Ks", "Qc", "5h", "3h");
    expect(kingsWithAce.rank).toBe(kingsWithQueen.rank);
    expect(compare(kingsWithAce, kingsWithQueen)).toBe(1);
  });

  it("identical hands (same values, different suits) tie", () => {
    const pair1 = evalOrThrow("Kh", "Kd", "Ac", "Qs", "Jd");
    const pair2 = evalOrThrow("Kc", "Ks", "Ah", "Qd", "Jc");
    expect(compare(pair1, pair2)).toBe(0);
  });

  it("higher flush beats lower flush", () => {
    const highFlush = evalOrThrow("Ah", "Kh", "9h", "5h", "3h");
    const lowFlush = evalOrThrow("Kd", "Qd", "9d", "5d", "3d");
    expect(highFlush.rank).toBe(lowFlush.rank);
    expect(compare(highFlush, lowFlush)).toBe(1);
  });
});

describe("winners", () => {
  it("returns empty array for empty input", () => {
    expect(winners([])).toEqual([]);
  });

  it("returns the single best hand", () => {
    const royalFlush = evalOrThrow("As", "Ks", "Qs", "Js", "Ts");
    const pair = evalOrThrow("Ah", "Ad", "Kh", "Qd", "Jc");
    const highCard = evalOrThrow("Ah", "9d", "7c", "5s", "3h");

    const result = winners([royalFlush, pair, highCard]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(royalFlush);
  });

  it("returns multiple winners when hands are tied", () => {
    const flush1 = evalOrThrow("Ah", "9h", "7h", "5h", "3h");
    const flush2 = evalOrThrow("Ad", "9d", "7d", "5d", "3d");

    const result = winners([flush1, flush2]);
    expect(result).toHaveLength(2);
    expect(result).toContain(flush1);
    expect(result).toContain(flush2);
  });

  it("picks the better hand within same category (pair of 4s > pair of 3s)", () => {
    const pair3 = evalOrThrow("3h", "3d", "7c", "8s", "Jd");
    const pair4 = evalOrThrow("4h", "4d", "7c", "8s", "Jd");

    const result = winners([pair3, pair4]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(pair4);
  });

  it("same pair with identical kickers splits", () => {
    const pair1 = evalOrThrow("Kh", "Kd", "Ac", "Qs", "Jd");
    const pair2 = evalOrThrow("Kc", "Ks", "Ah", "Qd", "Jc");

    const result = winners([pair1, pair2]);
    expect(result).toHaveLength(2);
  });
});

describe("evaluateHoldem", () => {
  it("combines hole cards and community cards correctly", () => {
    const hole = cards("As", "Ks");
    const community = cards("Qs", "Js", "Ts", "2d", "3c");
    const result = evaluateHoldem(hole, community);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.description).toBe("Royal Flush");
    }
  });

  it("finds the best 5-card hand from 7 cards", () => {
    const hole = cards("Ah", "Ad");
    const community = cards("Ac", "Kh", "Kd", "2s", "3c");
    const result = evaluateHoldem(hole, community);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.name).toBe("Full House");
    }
  });
});
