import { describe, it, expect } from "vitest";
import { Either, Option } from "effect";
import { Chips, SeatIndex, chipsToNumber } from "../src/brand.js";
import { createPlayer } from "../src/player.js";
import {
  createBettingRound,
  applyAction,
  activePlayer,
} from "../src/betting.js";
import { Fold, Check, Bet } from "../src/action.js";

// Generic chip conservation, fold removal, termination, all-in, and
// call/raise validation tests are covered by betting.properties.ts.
// Only seat ordering, specific blind-posting scenarios, and error cases remain.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkPlayer(seat: number, chips: number) {
  return createPlayer(SeatIndex(seat), Chips(chips));
}

// ---------------------------------------------------------------------------
// createBettingRound — seat ordering and edge cases
// ---------------------------------------------------------------------------

describe("createBettingRound", () => {
  it("sets correct active players and seat order starting from firstToActSeat", () => {
    const players = [mkPlayer(0, 1000), mkPlayer(2, 1000), mkPlayer(5, 1000)];

    const state = createBettingRound(
      "Flop",
      players,
      SeatIndex(2),
      Chips(0),
      Chips(20),
    );

    expect(state.activeSeatOrder).toEqual([
      SeatIndex(2),
      SeatIndex(5),
      SeatIndex(0),
    ]);
    expect(state.activeIndex).toBe(0);
    expect(state.isComplete).toBe(false);
    expect(state.name).toBe("Flop");
    const ap = activePlayer(state);
    expect(Option.isSome(ap)).toBe(true);
    if (Option.isSome(ap)) expect(ap.value).toBe(SeatIndex(2));
  });

  it("excludes folded and all-in players from active order", () => {
    const players = [
      mkPlayer(0, 1000),
      { ...mkPlayer(1, 0), isAllIn: true, chips: Chips(0) },
      { ...mkPlayer(2, 1000), isFolded: true },
      mkPlayer(3, 1000),
    ];

    const state = createBettingRound(
      "Turn",
      players,
      SeatIndex(0),
      Chips(0),
      Chips(20),
    );

    expect(state.activeSeatOrder).toEqual([SeatIndex(0), SeatIndex(3)]);
  });

  it("is immediately complete when only 1 non-folded player", () => {
    const players = [
      mkPlayer(0, 1000),
      { ...mkPlayer(1, 1000), isFolded: true },
      { ...mkPlayer(2, 1000), isFolded: true },
    ];

    const state = createBettingRound(
      "River",
      players,
      SeatIndex(0),
      Chips(0),
      Chips(20),
    );

    expect(state.isComplete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyAction — error cases and specific blind scenarios
// ---------------------------------------------------------------------------

describe("applyAction", () => {
  it("wrong player's turn returns NotPlayersTurn", () => {
    const players = [mkPlayer(0, 1000), mkPlayer(1, 1000)];
    const state = createBettingRound(
      "Flop",
      players,
      SeatIndex(0),
      Chips(0),
      Chips(20),
    );

    const result = applyAction(state, SeatIndex(1), Check);
    expect(Either.isLeft(result)).toBe(true);

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("NotPlayersTurn");
    }
  });

  it("bet opens the round and updates hasBetThisRound + lastAggressor", () => {
    const players = [mkPlayer(0, 1000), mkPlayer(1, 1000)];
    const state = createBettingRound(
      "Flop",
      players,
      SeatIndex(0),
      Chips(0),
      Chips(20),
    );

    expect(state.hasBetThisRound).toBe(false);

    const result = applyAction(state, SeatIndex(0), Bet({ amount: Chips(100) }));
    expect(Either.isRight(result)).toBe(true);

    if (Either.isRight(result)) {
      const { state: s } = result.right;
      expect(s.hasBetThisRound).toBe(true);
      expect(chipsToNumber(s.biggestBet)).toBe(100);
      expect(Option.isSome(s.lastAggressor)).toBe(true);
      if (Option.isSome(s.lastAggressor)) {
        expect(s.lastAggressor.value).toBe(SeatIndex(0));
      }
    }
  });
});
