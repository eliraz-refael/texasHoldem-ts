import { describe, it, expect } from "vitest";
import { Chips, SeatIndex } from "../src/brand.js";
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

describe("collectBets", () => {
  it("all equal bets produce a single pot", () => {
    const players = [bp(0, 100), bp(1, 100), bp(2, 100)];
    const { pots, players: updated } = collectBets(players, []);

    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(300);
    expect([...pots[0]!.eligibleSeats].sort()).toEqual([
      SeatIndex(0),
      SeatIndex(1),
      SeatIndex(2),
    ]);

    // All currentBets should be zeroed out.
    for (const p of updated) {
      expect(p.currentBet).toBe(0);
    }
  });

  it("one short all-in produces 2 pots (main + side)", () => {
    // Seat 0 is all-in for 50, seats 1 and 2 each bet 100.
    const players = [
      bp(0, 50, { isAllIn: true }),
      bp(1, 100),
      bp(2, 100),
    ];
    const { pots } = collectBets(players, []);

    expect(pots).toHaveLength(2);

    // Main pot: 50 * 3 = 150, eligible: all three
    expect(pots[0]!.amount).toBe(150);
    expect([...pots[0]!.eligibleSeats].sort()).toEqual([
      SeatIndex(0),
      SeatIndex(1),
      SeatIndex(2),
    ]);

    // Side pot: 50 * 2 = 100, eligible: seats 1 and 2 only
    expect(pots[1]!.amount).toBe(100);
    expect([...pots[1]!.eligibleSeats].sort()).toEqual([
      SeatIndex(1),
      SeatIndex(2),
    ]);
  });

  it("two different all-ins produce 3 pots", () => {
    // Seat 0: 30 all-in, Seat 1: 70 all-in, Seat 2: 100.
    const players = [
      bp(0, 30, { isAllIn: true }),
      bp(1, 70, { isAllIn: true }),
      bp(2, 100),
    ];
    const { pots } = collectBets(players, []);

    expect(pots).toHaveLength(3);

    // Pot 1: 30 * 3 = 90, all three eligible
    expect(pots[0]!.amount).toBe(90);
    expect(pots[0]!.eligibleSeats).toHaveLength(3);

    // Pot 2: 40 * 2 = 80, seats 1 and 2
    expect(pots[1]!.amount).toBe(80);
    expect([...pots[1]!.eligibleSeats].sort()).toEqual([
      SeatIndex(1),
      SeatIndex(2),
    ]);

    // Pot 3: 30 * 1 = 30, seat 2 only
    expect(pots[2]!.amount).toBe(30);
    expect(pots[2]!.eligibleSeats).toEqual([SeatIndex(2)]);
  });

  it("merges with existing pots when eligible seats match", () => {
    // Existing pot: 200 with seats 0, 1, 2.
    const existingPots: readonly Pot[] = [
      createPot(Chips(200), [SeatIndex(0), SeatIndex(1), SeatIndex(2)]),
    ];

    // All equal bets again — same eligible set should merge.
    const players = [bp(0, 50), bp(1, 50), bp(2, 50)];
    const { pots } = collectBets(players, existingPots);

    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(350); // 200 + 150
  });

  it("does not merge when eligible seats differ", () => {
    const existingPots: readonly Pot[] = [
      createPot(Chips(200), [SeatIndex(0), SeatIndex(1)]),
    ];

    // Three players contribute equally — eligible set is 0,1,2 which differs from 0,1.
    const players = [bp(0, 50), bp(1, 50), bp(2, 50)];
    const { pots } = collectBets(players, existingPots);

    expect(pots).toHaveLength(2);
    expect(pots[0]!.amount).toBe(200);
    expect(pots[1]!.amount).toBe(150);
  });

  it("folded player contributes to pot but is not eligible", () => {
    const players = [
      bp(0, 100),
      bp(1, 100, { isFolded: true }),
      bp(2, 100),
    ];
    const { pots } = collectBets(players, []);

    expect(pots).toHaveLength(1);
    expect(pots[0]!.amount).toBe(300);
    // The folded player should not be eligible.
    expect(pots[0]!.eligibleSeats).toEqual(
      expect.arrayContaining([SeatIndex(0), SeatIndex(2)]),
    );
    expect(pots[0]!.eligibleSeats).not.toContain(SeatIndex(1));
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
    expect(awards[0]!.amount).toBe(300);
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
    expect(seat0Award.amount).toBe(150);
    expect(seat1Award.amount).toBe(150);
  });

  it("odd chip goes to first player clockwise from button", () => {
    // Pot of 301 split between seats 0 and 2 (tie).
    // Button is at seat 1.
    // Clockwise from button (seat 1): seat 2, seat 3, seat 0, seat 1.
    // First winner clockwise from button is seat 2.
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

    // 301 / 2 = 150 with remainder 1.
    // Seat 2 is first clockwise from button (seat 1), so gets the odd chip.
    expect(seat2Award.amount).toBe(151);
    expect(seat0Award.amount).toBe(150);
  });

  it("single eligible seat with a hand wins uncontested", () => {
    const pots: readonly Pot[] = [
      createPot(Chips(500), [SeatIndex(0)]),
    ];
    const hands = new Map<SeatIndex, HandRank>([
      [SeatIndex(0), handRank(1)],
    ]);

    const awards = awardPots(pots, hands, SeatIndex(0), seatOrder);
    expect(awards).toHaveLength(1);
    expect(awards[0]!.seat).toBe(SeatIndex(0));
    expect(awards[0]!.amount).toBe(500);
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

    expect(totalPotSize(pots)).toBe(300);
  });

  it("returns 0 for empty pots array", () => {
    expect(totalPotSize([])).toBe(0);
  });

  it("returns the single pot amount for a one-pot array", () => {
    const pots: readonly Pot[] = [
      createPot(Chips(999), [SeatIndex(0)]),
    ];
    expect(totalPotSize(pots)).toBe(999);
  });
});
