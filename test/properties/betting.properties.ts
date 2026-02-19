import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Chips, chipsToNumber } from "../../src/brand.js";
import {
  createBettingRound,
  applyAction,
  activePlayer,
  getLegalActions,
} from "../../src/betting.js";
import type { BettingRoundState } from "../../src/betting.js";
import { Fold, Check, Call, AllIn, Raise, Bet } from "../../src/action.js";
import type { Action } from "../../src/action.js";
import { Either, Option } from "effect";
import { arbPlayers } from "../arbitraries.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbBettingRound = arbPlayers.map((players) => {
  const firstSeat = players[0]!.seatIndex;
  return createBettingRound("test", players, firstSeat, Chips(0), Chips(10));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function playActionByChoice(
  state: BettingRoundState,
  choice: number,
): BettingRoundState {
  const seat = activePlayer(state);
  if (Option.isNone(seat)) return state;

  const legal = getLegalActions(state);

  const candidates: Action[] = [];
  if (legal.canFold) candidates.push(Fold);
  if (legal.canCheck) candidates.push(Check);
  if (Option.isSome(legal.callAmount)) candidates.push(Call);
  if (legal.canAllIn) candidates.push(AllIn);

  if (candidates.length === 0) return state;

  const idx = ((choice % candidates.length) + candidates.length) % candidates.length;
  const action = candidates[idx]!;

  const result = applyAction(state, seat.value, action);
  if (Either.isRight(result)) return result.right.state;

  const foldResult = applyAction(state, seat.value, Fold);
  if (Either.isRight(foldResult)) return foldResult.right.state;

  return state;
}

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
        if (Option.isNone(seat)) return;

        const legal = getLegalActions(state);

        const hasAction =
          legal.canFold ||
          legal.canCheck ||
          Option.isSome(legal.callAmount) ||
          Option.isSome(legal.minBet) ||
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
          if (Option.isNone(seat)) return;

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
              if (Option.isNone(legal.callAmount)) return;
              action = Call;
              break;
            case "allIn":
              if (!legal.canAllIn) return;
              action = AllIn;
              break;
          }

          const result = applyAction(state, seat.value, action);
          if (Either.isLeft(result)) return;

          const newState = result.right.state;
          for (const p of newState.players) {
            expect(chipsToNumber(p.chips)).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });

  it("folding removes the player from activeSeatOrder", () => {
    fc.assert(
      fc.property(arbBettingRound, (state) => {
        const seat = activePlayer(state);
        if (Option.isNone(seat)) return;

        const result = applyAction(state, seat.value, Fold);
        if (Either.isLeft(result)) return;

        const newState = result.right.state;

        expect(newState.activeSeatOrder).not.toContain(seat.value);

        const foldedPlayer = newState.players.find(
          (p) => p.seatIndex === seat.value,
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
        if (Option.isNone(seat)) return;

        const legal = getLegalActions(state);
        const player = state.players.find((p) => p.seatIndex === seat.value)!;

        if (legal.canCheck) {
          expect(chipsToNumber(player.currentBet)).toBeGreaterThanOrEqual(
            chipsToNumber(state.biggestBet),
          );
        }
      }),
    );
  });

  it("all-in sets player chips to zero", () => {
    fc.assert(
      fc.property(arbBettingRound, (state) => {
        const seat = activePlayer(state);
        if (Option.isNone(seat)) return;

        const legal = getLegalActions(state);
        if (!legal.canAllIn) return;

        const result = applyAction(state, seat.value, AllIn);
        if (Either.isLeft(result)) return;

        const newState = result.right.state;
        const updatedPlayer = newState.players.find(
          (p) => p.seatIndex === seat.value,
        );
        expect(updatedPlayer).toBeDefined();
        expect(chipsToNumber(updatedPlayer!.chips)).toBe(0);
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
          if (Option.isNone(seat)) return;

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
              if (Option.isNone(legal.callAmount)) return;
              action = Call;
              break;
            case "allIn":
              if (!legal.canAllIn) return;
              action = AllIn;
              break;
          }

          const totalBefore = state.players.reduce(
            (sum, p) =>
              sum + chipsToNumber(p.chips) + chipsToNumber(p.currentBet),
            0,
          );

          const result = applyAction(state, seat.value, action);
          if (Either.isLeft(result)) return;

          const newState = result.right.state;
          const totalAfter = newState.players.reduce(
            (sum, p) =>
              sum + chipsToNumber(p.chips) + chipsToNumber(p.currentBet),
            0,
          );

          expect(totalAfter).toBe(totalBefore);
        },
      ),
    );
  });

  it("calling sets currentBet equal to biggestBet (unless short all-in)", () => {
    fc.assert(
      fc.property(arbBettingRound, (state) => {
        const seat = activePlayer(state);
        if (Option.isNone(seat)) return;

        const legal = getLegalActions(state);
        if (Option.isNone(legal.callAmount)) return;

        const result = applyAction(state, seat.value, Call);
        if (Either.isLeft(result)) return;

        const newState = result.right.state;
        const updatedPlayer = newState.players.find(
          (p) => p.seatIndex === seat.value,
        );
        expect(updatedPlayer).toBeDefined();

        if (updatedPlayer!.isAllIn) {
          // short all-in: currentBet may be less than biggestBet
          expect(chipsToNumber(updatedPlayer!.currentBet)).toBeLessThanOrEqual(
            chipsToNumber(newState.biggestBet),
          );
        } else {
          expect(chipsToNumber(updatedPlayer!.currentBet)).toBe(
            chipsToNumber(newState.biggestBet),
          );
        }
      }),
    );
  });

  it("after a raise, biggestBet strictly increases", () => {
    fc.assert(
      fc.property(arbBettingRound, (state) => {
        const seat = activePlayer(state);
        if (Option.isNone(seat)) return;

        const legal = getLegalActions(state);
        if (Option.isNone(legal.minRaise)) return;

        const raiseAmount = legal.minRaise.value;
        const result = applyAction(state, seat.value, Raise({ amount: raiseAmount }));
        if (Either.isLeft(result)) return;

        const newState = result.right.state;
        expect(chipsToNumber(newState.biggestBet)).toBeGreaterThan(
          chipsToNumber(state.biggestBet),
        );
      }),
    );
  });
});
