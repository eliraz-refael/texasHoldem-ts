import { describe, it, expect } from "vitest";
import { Chips, SeatIndex, chipsToNumber } from "../src/brand.js";
import type { BettingPlayer, Pot } from "../src/pot.js";
import { collectBets, awardPots, totalPotSize, createPot } from "../src/pot.js";
import type { HandRank } from "../src/evaluator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bp(
  seat: number,
  currentBet: number,
  opts: { isFolded?: boolean; isAllIn?: boolean } = {},
): BettingPlayer {
  return {
    seatIndex: SeatIndex(seat),
    currentBet: Chips(currentBet),
    isFolded: opts.isFolded ?? false,
    isAllIn: opts.isAllIn ?? false,
  };
}

function handRank(rank: number): HandRank {
  return {
    name: `rank-${rank}`,
    description: `Hand with rank ${rank}`,
    rank,
    bestCards: [],
  };
}

// ---------------------------------------------------------------------------
// collectBets
// ---------------------------------------------------------------------------

// Basic conservation, bet zeroing, and eligibility tests are covered
// by pot.properties.ts. Only specific side-pot scenarios and merge tests remain.

describe("collectBets", () => {
  it("one short all-in produces 2 pots (main + side)", () => {
    const players = [
      bp(0, 50, { isAllIn: true }),
      bp(1, 100),
      bp(2, 100),
    ];
    const { pots } = collectBets(players, []);

    expect(pots).toHaveLength(2);
    expect(chipsToNumber(pots[0]!.amount)).toBe(150);
    expect([...pots[0]!.eligibleSeats].sort()).toEqual([
      SeatIndex(0),
      SeatIndex(1),
      SeatIndex(2),
    ]);
    expect(chipsToNumber(pots[1]!.amount)).toBe(100);
    expect([...pots[1]!.eligibleSeats].sort()).toEqual([
      SeatIndex(1),
      SeatIndex(2),
    ]);
  });

  it("two different all-ins produce 3 pots", () => {
    const players = [
      bp(0, 30, { isAllIn: true }),
      bp(1, 70, { isAllIn: true }),
      bp(2, 100),
    ];
    const { pots } = collectBets(players, []);

    expect(pots).toHaveLength(3);
    expect(chipsToNumber(pots[0]!.amount)).toBe(90);
    expect(pots[0]!.eligibleSeats).toHaveLength(3);
    expect(chipsToNumber(pots[1]!.amount)).toBe(80);
    expect([...pots[1]!.eligibleSeats].sort()).toEqual([
      SeatIndex(1),
      SeatIndex(2),
    ]);
    expect(chipsToNumber(pots[2]!.amount)).toBe(30);
    expect(pots[2]!.eligibleSeats).toEqual([SeatIndex(2)]);
  });

  it("merges with existing pots when eligible seats match", () => {
    const existingPots: readonly Pot[] = [
      createPot(Chips(200), [SeatIndex(0), SeatIndex(1), SeatIndex(2)]),
    ];

    const players = [bp(0, 50), bp(1, 50), bp(2, 50)];
    const { pots } = collectBets(players, existingPots);

    expect(pots).toHaveLength(1);
    expect(chipsToNumber(pots[0]!.amount)).toBe(350);
  });

  it("does not merge when eligible seats differ", () => {
    const existingPots: readonly Pot[] = [
      createPot(Chips(200), [SeatIndex(0), SeatIndex(1)]),
    ];

    const players = [bp(0, 50), bp(1, 50), bp(2, 50)];
    const { pots } = collectBets(players, existingPots);

    expect(pots).toHaveLength(2);
    expect(chipsToNumber(pots[0]!.amount)).toBe(200);
    expect(chipsToNumber(pots[1]!.amount)).toBe(150);
  });

});

// ---------------------------------------------------------------------------
// awardPots
// ---------------------------------------------------------------------------

describe("awardPots", () => {
  const seatOrder = [SeatIndex(0), SeatIndex(1), SeatIndex(2), SeatIndex(3)];

  it("single winner gets full pot", () => {
    const pots: readonly Pot[] = [
      createPot(Chips(300), [SeatIndex(0), SeatIndex(1), SeatIndex(2)]),
    ];
    const hands = new Map<SeatIndex, HandRank>([
      [SeatIndex(0), handRank(5)],
      [SeatIndex(1), handRank(3)],
      [SeatIndex(2), handRank(1)],
    ]);

    const awards = awardPots(pots, hands, SeatIndex(0), seatOrder);
    expect(awards).toHaveLength(1);
    expect(awards[0]!.seat).toBe(SeatIndex(0));
    expect(chipsToNumber(awards[0]!.amount)).toBe(300);
  });

  it("two-way tie splits evenly", () => {
    const pots: readonly Pot[] = [
      createPot(Chips(300), [SeatIndex(0), SeatIndex(1), SeatIndex(2)]),
    ];
    const hands = new Map<SeatIndex, HandRank>([
      [SeatIndex(0), handRank(5)],
      [SeatIndex(1), handRank(5)],
      [SeatIndex(2), handRank(1)],
    ]);

    const awards = awardPots(pots, hands, SeatIndex(2), seatOrder);
    expect(awards).toHaveLength(2);

    const seat0Award = awards.find((a) => a.seat === SeatIndex(0))!;
    const seat1Award = awards.find((a) => a.seat === SeatIndex(1))!;
    expect(chipsToNumber(seat0Award.amount)).toBe(150);
    expect(chipsToNumber(seat1Award.amount)).toBe(150);
  });

  it("odd chip goes to first player clockwise from button", () => {
    const pots: readonly Pot[] = [
      createPot(Chips(301), [SeatIndex(0), SeatIndex(1), SeatIndex(2)]),
    ];
    const hands = new Map<SeatIndex, HandRank>([
      [SeatIndex(0), handRank(5)],
      [SeatIndex(1), handRank(1)],
      [SeatIndex(2), handRank(5)],
    ]);

    const awards = awardPots(pots, hands, SeatIndex(1), seatOrder);
    expect(awards).toHaveLength(2);

    const seat0Award = awards.find((a) => a.seat === SeatIndex(0))!;
    const seat2Award = awards.find((a) => a.seat === SeatIndex(2))!;

    expect(chipsToNumber(seat2Award.amount)).toBe(151);
    expect(chipsToNumber(seat0Award.amount)).toBe(150);
  });

});

// ---------------------------------------------------------------------------
// totalPotSize
// ---------------------------------------------------------------------------

describe("totalPotSize", () => {
  it("sums amounts of all pots correctly", () => {
    const pots: readonly Pot[] = [
      createPot(Chips(150), [SeatIndex(0), SeatIndex(1)]),
      createPot(Chips(100), [SeatIndex(1), SeatIndex(2)]),
      createPot(Chips(50), [SeatIndex(2)]),
    ];

    expect(chipsToNumber(totalPotSize(pots))).toBe(300);
  });

  it("returns 0 for empty pots array", () => {
    expect(chipsToNumber(totalPotSize([]))).toBe(0);
  });
});
