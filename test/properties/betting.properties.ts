import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Chips, SeatIndex } from "../../src/brand.js";
import { createPlayer } from "../../src/player.js";
import {
  createBettingRound,
  applyAction,
  activePlayer,
  getLegalActions,
} from "../../src/betting.js";
import type { BettingRoundState } from "../../src/betting.js";
import { Fold, Check, Call, AllIn } from "../../src/action.js";
import type { Action } from "../../src/action.js";
import { Either } from "effect";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generate a list of 2-6 players with unique seat indices and random stacks.
 * Stacks range from 1 to 10_000 to keep things realistic.
 */
const arbPlayers = fc
  .integer({ min: 2, max: 6 })
  .chain((count) => {
    // Pick `count` unique seat indices from 0..9
    return fc
      .shuffledSubarray(
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        { minLength: count, maxLength: count },
      )
      .chain((seats) => {
        const sorted = [...seats].sort((a, b) => a - b);
        return fc.tuple(
          fc.constant(sorted),
          fc.tuple(
            ...sorted.map(() =>
              fc.integer({ min: 1, max: 10_000 }).map((n) => Chips(n)),
            ),
          ),
        );
      });
  })
  .map(([seats, chipStacks]) =>
    seats.map((s, i) => createPlayer(SeatIndex(s), chipStacks[i]!)),
  );

/**
 * Generate a valid BettingRoundState from a random set of players.
 * Uses biggestBet=0 and minRaise equal to a small blind amount (e.g. 10).
 */
const arbBettingRound = arbPlayers.map((players) => {
  const firstSeat = players[0]!.seatIndex;
  return createBettingRound("test", players, firstSeat, Chips(0), Chips(10));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Given a BettingRoundState and a choice index, pick and apply a valid action
 * from the set of legal actions. The choice index is used modulo the number of
 * available actions to select deterministically. Returns the new state, or the
 * same state if the round is already complete.
 */
function playActionByChoice(
  state: BettingRoundState,
  choice: number,
): BettingRoundState {
  const seat = activePlayer(state);
  if (seat === null) return state;

  const legal = getLegalActions(state);

  // Build a list of valid simple actions to choose from.
  const candidates: Action[] = [];
  if (legal.canFold) candidates.push(Fold);
  if (legal.canCheck) candidates.push(Check);
  if (legal.callAmount !== null) candidates.push(Call);
  if (legal.canAllIn) candidates.push(AllIn);

  // Should never be empty when a player is active, but guard just in case.
  if (candidates.length === 0) return state;

  const idx = ((choice % candidates.length) + candidates.length) % candidates.length;
  const action = candidates[idx]!;

  const result = applyAction(state, seat, action);
  if (Either.isRight(result)) return result.right.state;

  // Action was rejected -- fall back to fold (always legal).
  const foldResult = applyAction(state, seat, Fold);
  if (Either.isRight(foldResult)) return foldResult.right.state;

  return state; // should not happen
}

/**
 * Play actions until the round completes or the maximum iteration count is hit.
 * Returns [finalState, actionCount].
 */
function playUntilComplete(
  state: BettingRoundState,
  choices: readonly number[],
  maxActions: number,
): [BettingRoundState, number] {
  let current = state;
  let count = 0;
  while (!current.isComplete && count < maxActions) {
    current = playActionByChoice(current, choices[count % choices.length]!);
    count++;
  }
  return [current, count];
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("betting round -- property-based", () => {
  it("legal actions are always non-empty for the active player", () => {
    fc.assert(
      fc.property(arbBettingRound, (state) => {
        const seat = activePlayer(state);
        if (seat === null) return; // round already complete

        const legal = getLegalActions(state);

        const hasAction =
          legal.canFold ||
          legal.canCheck ||
          legal.callAmount !== null ||
          legal.minBet !== null ||
          legal.canAllIn;

        expect(hasAction).toBe(true);
      }),
    );
  });

  it("chips never go negative after any single valid action", () => {
    fc.assert(
      fc.property(
        arbBettingRound,
        fc.constantFrom("fold", "check", "call", "allIn"),
        (state, actionType) => {
          const seat = activePlayer(state);
          if (seat === null) return;

          const legal = getLegalActions(state);

          let action: Action;
          switch (actionType) {
            case "fold":
              action = Fold;
              break;
            case "check":
              if (!legal.canCheck) return;
              action = Check;
              break;
            case "call":
              if (legal.callAmount === null) return;
              action = Call;
              break;
            case "allIn":
              if (!legal.canAllIn) return;
              action = AllIn;
              break;
          }

          const result = applyAction(state, seat, action);
          if (Either.isLeft(result)) return; // invalid action -- skip

          const newState = result.right.state;
          for (const p of newState.players) {
            expect(p.chips as number).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });

  it("folding removes the player from activeSeatOrder", () => {
    fc.assert(
      fc.property(arbBettingRound, (state) => {
        const seat = activePlayer(state);
        if (seat === null) return;

        const result = applyAction(state, seat, Fold);
        if (Either.isLeft(result)) return; // shouldn't happen -- fold is always legal

        const newState = result.right.state;

        // The folded player should not appear in the active seat order.
        expect(newState.activeSeatOrder).not.toContain(seat);

        // The folded player should be marked as folded.
        const foldedPlayer = newState.players.find(
          (p) => p.seatIndex === seat,
        );
        expect(foldedPlayer).toBeDefined();
        expect(foldedPlayer!.isFolded).toBe(true);
      }),
    );
  });

  it("betting round always terminates within N*4 actions", () => {
    fc.assert(
      fc.property(
        arbBettingRound,
        fc.array(fc.integer({ min: 0, max: 1000 }), {
          minLength: 50,
          maxLength: 50,
        }),
        (state, choices) => {
          const maxActions = state.players.length * 4;

          const [finalState, actionCount] = playUntilComplete(
            state,
            choices,
            maxActions,
          );

          expect(finalState.isComplete).toBe(true);
          expect(actionCount).toBeLessThanOrEqual(maxActions);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("check is only available when no outstanding bet exists", () => {
    fc.assert(
      fc.property(arbBettingRound, (state) => {
        const seat = activePlayer(state);
        if (seat === null) return;

        const legal = getLegalActions(state);
        const player = state.players.find((p) => p.seatIndex === seat)!;

        if (legal.canCheck) {
          // Player's current bet must match or exceed the biggest bet
          expect(player.currentBet as number).toBeGreaterThanOrEqual(
            state.biggestBet as number,
          );
        }
      }),
    );
  });

  it("all-in sets player chips to zero", () => {
    fc.assert(
      fc.property(arbBettingRound, (state) => {
        const seat = activePlayer(state);
        if (seat === null) return;

        const legal = getLegalActions(state);
        if (!legal.canAllIn) return;

        const result = applyAction(state, seat, AllIn);
        if (Either.isLeft(result)) return;

        const newState = result.right.state;
        const updatedPlayer = newState.players.find(
          (p) => p.seatIndex === seat,
        );
        expect(updatedPlayer).toBeDefined();
        expect(updatedPlayer!.chips as number).toBe(0);
        expect(updatedPlayer!.isAllIn).toBe(true);
      }),
    );
  });

  it("total chips in play are conserved across any valid action", () => {
    fc.assert(
      fc.property(
        arbBettingRound,
        fc.constantFrom("fold", "check", "call", "allIn"),
        (state, actionType) => {
          const seat = activePlayer(state);
          if (seat === null) return;

          const legal = getLegalActions(state);

          let action: Action;
          switch (actionType) {
            case "fold":
              action = Fold;
              break;
            case "check":
              if (!legal.canCheck) return;
              action = Check;
              break;
            case "call":
              if (legal.callAmount === null) return;
              action = Call;
              break;
            case "allIn":
              if (!legal.canAllIn) return;
              action = AllIn;
              break;
          }

          // Total chips = sum of (chips + currentBet) for all players
          const totalBefore = state.players.reduce(
            (sum, p) =>
              sum + (p.chips as number) + (p.currentBet as number),
            0,
          );

          const result = applyAction(state, seat, action);
          if (Either.isLeft(result)) return;

          const newState = result.right.state;
          const totalAfter = newState.players.reduce(
            (sum, p) =>
              sum + (p.chips as number) + (p.currentBet as number),
            0,
          );

          expect(totalAfter).toBe(totalBefore);
        },
      ),
    );
  });
});
