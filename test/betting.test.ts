import { describe, it, expect } from "vitest";
import { Either } from "effect";
import { Chips, SeatIndex } from "../src/brand.js";
import { createPlayer } from "../src/player.js";
import {
  createBettingRound,
  applyAction,
  activePlayer,
} from "../src/betting.js";
import { Fold, Check, Call, Raise, Bet, AllIn } from "../src/action.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkPlayer(seat: number, chips: number) {
  return createPlayer(SeatIndex(seat), Chips(chips));
}

// ---------------------------------------------------------------------------
// createBettingRound
// ---------------------------------------------------------------------------

describe("createBettingRound", () => {
  it("sets correct active players and seat order starting from firstToActSeat", () => {
    const players = [mkPlayer(0, 1000), mkPlayer(2, 1000), mkPlayer(5, 1000)];

    const state = createBettingRound(
      "Flop",
      players,
      SeatIndex(2), // first to act
      Chips(0),
      Chips(20),
    );

    // Active seat order should start from seat 2, then 5, then 0 (wrapped).
    expect(state.activeSeatOrder).toEqual([
      SeatIndex(2),
      SeatIndex(5),
      SeatIndex(0),
    ]);
    expect(state.activeIndex).toBe(0);
    expect(state.isComplete).toBe(false);
    expect(state.name).toBe("Flop");
    expect(activePlayer(state)).toBe(SeatIndex(2));
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

    // Only seats 0 and 3 can act (1 is all-in, 2 is folded).
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
// applyAction
// ---------------------------------------------------------------------------

describe("applyAction", () => {
  it("fold removes player from active order", () => {
    const players = [mkPlayer(0, 1000), mkPlayer(1, 1000), mkPlayer(2, 1000)];
    const state = createBettingRound(
      "Flop",
      players,
      SeatIndex(0),
      Chips(0),
      Chips(20),
    );

    const result = applyAction(state, SeatIndex(0), Fold);
    expect(Either.isRight(result)).toBe(true);

    if (Either.isRight(result)) {
      const { state: s, events } = result.right;
      // Seat 0 should no longer be in the active order.
      expect(s.activeSeatOrder).not.toContain(SeatIndex(0));
      expect(s.activeSeatOrder).toEqual([SeatIndex(1), SeatIndex(2)]);

      // Should produce a PlayerActed event.
      expect(events.some((e) => e._tag === "PlayerActed")).toBe(true);
    }
  });

  it("check advances turn to next player", () => {
    const players = [mkPlayer(0, 1000), mkPlayer(1, 1000), mkPlayer(2, 1000)];
    const state = createBettingRound(
      "Flop",
      players,
      SeatIndex(0),
      Chips(0),
      Chips(20),
    );

    const result = applyAction(state, SeatIndex(0), Check);
    expect(Either.isRight(result)).toBe(true);

    if (Either.isRight(result)) {
      const { state: s } = result.right;
      expect(activePlayer(s)).toBe(SeatIndex(1));
      expect(s.activeSeatOrder).toHaveLength(3); // all still active
    }
  });

  it("call sets correct bet amount", () => {
    const players = [mkPlayer(0, 1000), mkPlayer(1, 1000), mkPlayer(2, 1000)];
    // Simulate a round where biggestBet is already 50 (e.g. after blinds).
    const state = createBettingRound(
      "Preflop",
      players,
      SeatIndex(0),
      Chips(50), // biggestBet
      Chips(50), // minRaise
    );

    const result = applyAction(state, SeatIndex(0), Call);
    expect(Either.isRight(result)).toBe(true);

    if (Either.isRight(result)) {
      const { state: s } = result.right;
      // Player 0 should now have bet 50 and have 950 chips.
      const player0 = s.players.find(
        (p) => p.seatIndex === SeatIndex(0),
      )!;
      expect(player0.currentBet).toBe(50);
      expect(player0.chips).toBe(950);
    }
  });

  it("raise updates biggestBet and resets actedThisRound", () => {
    const players = [mkPlayer(0, 1000), mkPlayer(1, 1000), mkPlayer(2, 1000)];
    const state = createBettingRound(
      "Preflop",
      players,
      SeatIndex(0),
      Chips(50), // biggestBet
      Chips(50), // minRaise
    );

    // Player 0 calls first.
    const r1 = applyAction(state, SeatIndex(0), Call);
    expect(Either.isRight(r1)).toBe(true);
    const s1 = (r1 as Extract<typeof r1, { _tag: "Right" }>).right.state;

    // Player 1 raises to 150 (min raise: biggestBet 50 + minRaise 50 = 100).
    const r2 = applyAction(s1, SeatIndex(1), Raise(Chips(150)));
    expect(Either.isRight(r2)).toBe(true);

    if (Either.isRight(r2)) {
      const { state: s2 } = r2.right;
      expect(s2.biggestBet).toBe(150);
      // actedThisRound should be reset (only the raiser is in the set).
      expect(s2.actedThisRound.has(SeatIndex(1))).toBe(true);
      expect(s2.actedThisRound.has(SeatIndex(0))).toBe(false);
      expect(s2.isComplete).toBe(false);
    }
  });

  it("wrong player's turn returns NotPlayersTurn", () => {
    const players = [mkPlayer(0, 1000), mkPlayer(1, 1000)];
    const state = createBettingRound(
      "Flop",
      players,
      SeatIndex(0),
      Chips(0),
      Chips(20),
    );

    // It's seat 0's turn, but seat 1 tries to act.
    const result = applyAction(state, SeatIndex(1), Check);
    expect(Either.isLeft(result)).toBe(true);

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("NotPlayersTurn");
    }
  });

  it("round completes when all players have acted", () => {
    const players = [mkPlayer(0, 1000), mkPlayer(1, 1000), mkPlayer(2, 1000)];
    const state = createBettingRound(
      "Flop",
      players,
      SeatIndex(0),
      Chips(0),
      Chips(20),
    );

    // All three players check.
    const r1 = applyAction(state, SeatIndex(0), Check);
    expect(Either.isRight(r1)).toBe(true);
    const s1 = (r1 as Extract<typeof r1, { _tag: "Right" }>).right.state;
    expect(s1.isComplete).toBe(false);

    const r2 = applyAction(s1, SeatIndex(1), Check);
    expect(Either.isRight(r2)).toBe(true);
    const s2 = (r2 as Extract<typeof r2, { _tag: "Right" }>).right.state;
    expect(s2.isComplete).toBe(false);

    const r3 = applyAction(s2, SeatIndex(2), Check);
    expect(Either.isRight(r3)).toBe(true);

    if (Either.isRight(r3)) {
      const { state: s3, events } = r3.right;
      expect(s3.isComplete).toBe(true);
      // Should have a BettingRoundEnded event.
      expect(events.some((e) => e._tag === "BettingRoundEnded")).toBe(true);
    }
  });

  it("round completes when only 1 non-folded player remains", () => {
    const players = [mkPlayer(0, 1000), mkPlayer(1, 1000), mkPlayer(2, 1000)];
    const state = createBettingRound(
      "Flop",
      players,
      SeatIndex(0),
      Chips(0),
      Chips(20),
    );

    // Seat 0 folds.
    const r1 = applyAction(state, SeatIndex(0), Fold);
    expect(Either.isRight(r1)).toBe(true);
    const s1 = (r1 as Extract<typeof r1, { _tag: "Right" }>).right.state;
    expect(s1.isComplete).toBe(false);

    // Seat 1 folds — only seat 2 is left non-folded.
    const r2 = applyAction(s1, SeatIndex(1), Fold);
    expect(Either.isRight(r2)).toBe(true);

    if (Either.isRight(r2)) {
      const { state: s2, events } = r2.right;
      expect(s2.isComplete).toBe(true);
      expect(events.some((e) => e._tag === "BettingRoundEnded")).toBe(true);
    }
  });

  it("heads-up: fold completes round immediately", () => {
    const players = [mkPlayer(0, 1000), mkPlayer(1, 1000)];
    const state = createBettingRound(
      "Flop",
      players,
      SeatIndex(0),
      Chips(0),
      Chips(20),
    );

    const result = applyAction(state, SeatIndex(0), Fold);
    expect(Either.isRight(result)).toBe(true);

    if (Either.isRight(result)) {
      const { state: s, events } = result.right;
      expect(s.isComplete).toBe(true);
      expect(events.some((e) => e._tag === "BettingRoundEnded")).toBe(true);
    }
  });

  it("bet opens the round and updates hasBetThisRound", () => {
    const players = [mkPlayer(0, 1000), mkPlayer(1, 1000)];
    const state = createBettingRound(
      "Flop",
      players,
      SeatIndex(0),
      Chips(0),
      Chips(20),
    );

    expect(state.hasBetThisRound).toBe(false);

    const result = applyAction(state, SeatIndex(0), Bet(Chips(100)));
    expect(Either.isRight(result)).toBe(true);

    if (Either.isRight(result)) {
      const { state: s } = result.right;
      expect(s.hasBetThisRound).toBe(true);
      expect(s.biggestBet).toBe(100);
      expect(s.lastAggressor).toBe(SeatIndex(0));
    }
  });

  it("all-in removes player from active order", () => {
    const players = [mkPlayer(0, 100), mkPlayer(1, 1000)];
    const state = createBettingRound(
      "Flop",
      players,
      SeatIndex(0),
      Chips(0),
      Chips(20),
    );

    const result = applyAction(state, SeatIndex(0), AllIn);
    expect(Either.isRight(result)).toBe(true);

    if (Either.isRight(result)) {
      const { state: s } = result.right;
      expect(s.activeSeatOrder).not.toContain(SeatIndex(0));
      const player0 = s.players.find(
        (p) => p.seatIndex === SeatIndex(0),
      )!;
      expect(player0.chips).toBe(0);
      expect(player0.isAllIn).toBe(true);
    }
  });
});
