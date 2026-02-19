import fc from "fast-check";
import { Chips, SeatIndex } from "../src/brand.js";
import { createPlayer } from "../src/player.js";
import { card, RANKS, SUITS } from "../src/card.js";
import type { Rank, Suit } from "../src/card.js";

// ---------------------------------------------------------------------------
// Branded primitives
// ---------------------------------------------------------------------------

export const arbChips = fc.integer({ min: 0, max: 100_000 }).map(n => Chips(n));
export const arbPositiveChips = fc.integer({ min: 1, max: 100_000 }).map(n => Chips(n));
export const arbSeatIndex = fc.integer({ min: 0, max: 9 }).map(n => SeatIndex(n));

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export const arbRank = fc.constantFrom<Rank>(...RANKS);
export const arbSuit = fc.constantFrom<Suit>(...SUITS);
export const arbCard = fc.record({ rank: arbRank, suit: arbSuit }).map(({ rank, suit }) => card(rank, suit));

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export const arbPlayer = fc.tuple(arbSeatIndex, arbPositiveChips).map(([seat, chips]) => createPlayer(seat, chips));

export const arbPlayers = fc
  .integer({ min: 2, max: 6 })
  .chain(count =>
    fc.shuffledSubarray([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], { minLength: count, maxLength: count })
      .chain(seats => {
        const sorted = [...seats].sort((a, b) => a - b);
        return fc.tuple(
          fc.constant(sorted),
          fc.tuple(...sorted.map(() => fc.integer({ min: 1, max: 10_000 }).map(n => Chips(n)))),
        );
      })
  )
  .map(([seats, chipStacks]) =>
    seats.map((s, i) => {
      const chips = chipStacks[i];
      if (chips === undefined) throw new Error("chips undefined in arbPlayers");
      return createPlayer(SeatIndex(s), chips);
    }),
  );

// ---------------------------------------------------------------------------
// BettingPlayer for pot tests
// ---------------------------------------------------------------------------

export const arbBettingPlayer = (seat: number) =>
  fc.record({
    seatIndex: fc.constant(SeatIndex(seat)),
    currentBet: fc.integer({ min: 0, max: 1000 }).map(n => Chips(n)),
    isFolded: fc.boolean(),
    isAllIn: fc.boolean(),
  });

export const arbBettingPlayers = fc
  .integer({ min: 2, max: 10 })
  .chain(count =>
    fc.tuple(...Array.from({ length: count }, (_, i) => arbBettingPlayer(i))),
  );

// ---------------------------------------------------------------------------
// ForcedBets-like config
// ---------------------------------------------------------------------------

export const arbForcedBets = fc.record({
  smallBlind: fc.integer({ min: 1, max: 100 }).map(n => Chips(n)),
  bigBlind: fc.integer({ min: 2, max: 200 }).map(n => Chips(n)),
});
