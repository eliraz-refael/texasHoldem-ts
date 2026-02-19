import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Chips, SeatIndex } from "../../src/brand.js";
import { collectBets, totalPotSize } from "../../src/pot.js";
import type { BettingPlayer } from "../../src/pot.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbBettingPlayer = (seat: number) =>
  fc.record({
    seatIndex: fc.constant(SeatIndex(seat)),
    currentBet: fc.integer({ min: 0, max: 1000 }).map((n) => Chips(n)),
    isFolded: fc.boolean(),
    isAllIn: fc.boolean(),
  });

/**
 * Generate a list of 2-10 BettingPlayers with unique, consecutive seat indices.
 */
const arbBettingPlayers = fc
  .integer({ min: 2, max: 10 })
  .chain((count) =>
    fc.tuple(...Array.from({ length: count }, (_, i) => arbBettingPlayer(i))),
  );

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("pot / collectBets — property-based", () => {
  it("chip conservation: sum of currentBets === totalPotSize after collection (no existing pots)", () => {
    fc.assert(
      fc.property(arbBettingPlayers, (players) => {
        const totalBetsBefore = players.reduce(
          (sum, p) => sum + (p.currentBet as number),
          0,
        );

        const { pots } = collectBets(players, []);
        const potTotal = totalPotSize(pots) as number;

        expect(potTotal).toBe(totalBetsBefore);
      }),
    );
  });

  it("all bets zeroed: every player has currentBet === 0 after collectBets", () => {
    fc.assert(
      fc.property(arbBettingPlayers, (players) => {
        const { players: updatedPlayers } = collectBets(players, []);

        for (const p of updatedPlayers) {
          expect(p.currentBet as number).toBe(0);
        }
      }),
    );
  });

  it("non-folded players who bet > 0 are eligible for at least the first pot", () => {
    fc.assert(
      fc.property(arbBettingPlayers, (players) => {
        // Only meaningful when at least one player has a non-zero bet.
        const hasBets = players.some((p) => (p.currentBet as number) > 0);
        if (!hasBets) return; // trivially true — no pots created

        const { pots } = collectBets(players, []);
        if (pots.length === 0) return; // no pots were created

        const firstPot = pots[0]!;

        for (const p of players) {
          if (!p.isFolded && (p.currentBet as number) > 0) {
            expect(firstPot.eligibleSeats).toContain(p.seatIndex);
          }
        }
      }),
    );
  });

  it("chip conservation with existing pots: total is preserved across merges", () => {
    fc.assert(
      fc.property(
        arbBettingPlayers,
        fc.integer({ min: 0, max: 5000 }).map((n) => Chips(n)),
        (players, existingAmount) => {
          // Create a single existing pot containing all player seats.
          const existingPots = [
            {
              amount: existingAmount,
              eligibleSeats: players.map((p) => p.seatIndex),
            },
          ];

          const totalBetsBefore = players.reduce(
            (sum, p) => sum + (p.currentBet as number),
            0,
          );

          const { pots } = collectBets(players, existingPots);
          const potTotal = totalPotSize(pots) as number;

          expect(potTotal).toBe(totalBetsBefore + (existingAmount as number));
        },
      ),
    );
  });

  it("number of pots <= number of distinct non-zero bet levels", () => {
    fc.assert(
      fc.property(arbBettingPlayers, (players) => {
        const distinctBetLevels = new Set(
          players
            .filter((p) => (p.currentBet as number) > 0)
            .map((p) => p.currentBet as number),
        );

        const { pots } = collectBets(players, []);

        // The algorithm produces at most one pot per distinct bet level.
        expect(pots.length).toBeLessThanOrEqual(
          Math.max(distinctBetLevels.size, 0),
        );
      }),
    );
  });

  it("folded players never appear in any pot's eligibleSeats", () => {
    fc.assert(
      fc.property(arbBettingPlayers, (players) => {
        const { pots } = collectBets(players, []);

        const foldedSeats = new Set(
          players.filter((p) => p.isFolded).map((p) => p.seatIndex),
        );

        for (const pot of pots) {
          for (const seat of pot.eligibleSeats) {
            expect(foldedSeats.has(seat)).toBe(false);
          }
        }
      }),
    );
  });
});
