import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Either, Option } from "effect";
import { Chips, chipsToNumber } from "../../src/brand.js";
import {
  computeLegalActions,
  validateAction,
  Fold,
  Check,
  Call,
  Bet,
  Raise,
  AllIn,
} from "../../src/action.js";
import type { Action, LegalActions } from "../../src/action.js";
import { arbPositiveChips, arbChips } from "../arbitraries.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generate valid inputs to computeLegalActions.
 *
 * Constraints:
 *  - playerChips >= 1    (active player has chips)
 *  - playerCurrentBet in [0, biggestBet]  (can't have bet more than the biggest)
 *  - biggestBet >= 0
 *  - minRaiseIncrement >= 1
 *  - hasBetThisRound is true iff biggestBet > 0
 */
const arbLegalActionInputs = fc
  .record({
    playerChips: fc.integer({ min: 1, max: 100_000 }).map((n) => Chips(n)),
    biggestBet: fc.integer({ min: 0, max: 10_000 }).map((n) => Chips(n)),
    minRaiseIncrement: fc.integer({ min: 1, max: 5_000 }).map((n) => Chips(n)),
  })
  .chain(({ playerChips, biggestBet, minRaiseIncrement }) =>
    fc
      .integer({ min: 0, max: chipsToNumber(biggestBet) })
      .map((pcb) => Chips(pcb))
      .map((playerCurrentBet) => ({
        playerChips,
        playerCurrentBet,
        biggestBet,
        minRaiseIncrement,
        hasBetThisRound: chipsToNumber(biggestBet) > 0,
      })),
  );

/**
 * Given a LegalActions, generate a random valid action that should pass
 * validateAction.
 */
function arbValidAction(legal: LegalActions): fc.Arbitrary<Action> {
  const candidates: fc.Arbitrary<Action>[] = [];

  if (legal.canFold) {
    candidates.push(fc.constant(Fold));
  }
  if (legal.canCheck) {
    candidates.push(fc.constant(Check));
  }
  if (Option.isSome(legal.callAmount)) {
    candidates.push(fc.constant(Call));
  }
  if (Option.isSome(legal.minBet) && Option.isSome(legal.maxBet)) {
    const min = chipsToNumber(legal.minBet.value);
    const max = chipsToNumber(legal.maxBet.value);
    candidates.push(
      fc.integer({ min, max }).map((n) => Bet({ amount: Chips(n) })),
    );
  }
  if (Option.isSome(legal.minRaise) && Option.isSome(legal.maxRaise)) {
    const min = chipsToNumber(legal.minRaise.value);
    const max = chipsToNumber(legal.maxRaise.value);
    candidates.push(
      fc.integer({ min, max }).map((n) => Raise({ amount: Chips(n) })),
    );
  }
  if (legal.canAllIn) {
    candidates.push(fc.constant(AllIn));
  }

  // There is always at least fold for an active player with chips
  return fc.oneof(...candidates);
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("action -- property-based", () => {
  it("computeLegalActions always includes fold for any active player", () => {
    fc.assert(
      fc.property(arbLegalActionInputs, (input) => {
        const legal = computeLegalActions(
          input.playerChips,
          input.playerCurrentBet,
          input.biggestBet,
          input.minRaiseIncrement,
          input.hasBetThisRound,
        );

        expect(legal.canFold).toBe(true);
      }),
    );
  });

  it("any action within legal ranges passes validateAction", () => {
    fc.assert(
      fc.property(
        arbLegalActionInputs.chain((input) => {
          const legal = computeLegalActions(
            input.playerChips,
            input.playerCurrentBet,
            input.biggestBet,
            input.minRaiseIncrement,
            input.hasBetThisRound,
          );
          return arbValidAction(legal).map((action) => ({ legal, action }));
        }),
        ({ legal, action }) => {
          const result = validateAction(action, legal);
          expect(Either.isRight(result)).toBe(true);
        },
      ),
    );
  });

  it("invalid amounts (outside legal ranges) fail validateAction", () => {
    fc.assert(
      fc.property(
        arbLegalActionInputs,
        fc.boolean(),
        fc.integer({ min: 1, max: 50_000 }),
        (input, useBet, offset) => {
          const legal = computeLegalActions(
            input.playerChips,
            input.playerCurrentBet,
            input.biggestBet,
            input.minRaiseIncrement,
            input.hasBetThisRound,
          );

          if (useBet) {
            // Test invalid Bet amounts
            if (Option.isNone(legal.minBet) || Option.isNone(legal.maxBet)) {
              // No bet allowed at all -- any Bet should fail
              const result = validateAction(
                Bet({ amount: Chips(offset) }),
                legal,
              );
              expect(Either.isLeft(result)).toBe(true);
            } else {
              const min = chipsToNumber(legal.minBet.value);
              const max = chipsToNumber(legal.maxBet.value);

              // Below minimum
              if (min > 1) {
                const belowMin = Chips(
                  Math.max(0, min - 1 - ((offset - 1) % min)),
                );
                if (chipsToNumber(belowMin) < min) {
                  const result = validateAction(
                    Bet({ amount: belowMin }),
                    legal,
                  );
                  expect(Either.isLeft(result)).toBe(true);
                }
              }

              // Above maximum
              const aboveMax = Chips(max + 1 + (offset % 10000));
              const result = validateAction(
                Bet({ amount: aboveMax }),
                legal,
              );
              expect(Either.isLeft(result)).toBe(true);
            }
          } else {
            // Test invalid Raise amounts
            if (
              Option.isNone(legal.minRaise) ||
              Option.isNone(legal.maxRaise)
            ) {
              // No raise allowed -- any Raise should fail
              const result = validateAction(
                Raise({ amount: Chips(offset) }),
                legal,
              );
              expect(Either.isLeft(result)).toBe(true);
            } else {
              const min = chipsToNumber(legal.minRaise.value);
              const max = chipsToNumber(legal.maxRaise.value);

              // Below minimum
              if (min > 1) {
                const belowMin = Chips(
                  Math.max(0, min - 1 - ((offset - 1) % min)),
                );
                if (chipsToNumber(belowMin) < min) {
                  const result = validateAction(
                    Raise({ amount: belowMin }),
                    legal,
                  );
                  expect(Either.isLeft(result)).toBe(true);
                }
              }

              // Above maximum
              const aboveMax = Chips(max + 1 + (offset % 10000));
              const result = validateAction(
                Raise({ amount: aboveMax }),
                legal,
              );
              expect(Either.isLeft(result)).toBe(true);
            }
          }
        },
      ),
    );
  });

  it("check is valid iff playerCurrentBet >= biggestBet", () => {
    fc.assert(
      fc.property(arbLegalActionInputs, (input) => {
        const legal = computeLegalActions(
          input.playerChips,
          input.playerCurrentBet,
          input.biggestBet,
          input.minRaiseIncrement,
          input.hasBetThisRound,
        );

        const checkResult = validateAction(Check, legal);
        const playerMeetsBet =
          chipsToNumber(input.playerCurrentBet) >=
          chipsToNumber(input.biggestBet);

        if (playerMeetsBet) {
          // Check should be valid
          expect(Either.isRight(checkResult)).toBe(true);
        } else {
          // Check should be invalid
          expect(Either.isLeft(checkResult)).toBe(true);
        }
      }),
    );
  });
});
