import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Effect, Either, HashMap, Option } from "effect";
import {
  createTable,
  sitDown,
  standUp,
  startNextHand,
  act,
  getActivePlayer,
  getTableLegalActions,
} from "../../src/table.js";
import type { TableConfig, TableState } from "../../src/table.js";
import {
  Chips,
  SeatIndex,
  chipsToNumber,
  seatIndexToNumber,
} from "../../src/brand.js";
import { Fold, Call, Check, AllIn } from "../../src/action.js";
import type { Action } from "../../src/action.js";
import type { ForcedBets } from "../../src/hand.js";
import { arbPositiveChips, arbForcedBets } from "../arbitraries.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_BLINDS: ForcedBets = {
  smallBlind: Chips(1),
  bigBlind: Chips(2),
};

function createTableOrThrow(config: TableConfig): TableState {
  const result = createTable(config);
  if (Either.isLeft(result)) throw new Error(result.left.reason);
  return result.right;
}

function sitDownOrThrow(
  state: TableState,
  seat: SeatIndex,
  chips: Chips,
): TableState {
  const result = sitDown(state, seat, chips);
  if (Either.isLeft(result)) {
    throw new Error(`sitDown failed: ${JSON.stringify(result.left)}`);
  }
  return result.right;
}

function totalTableChips(table: TableState): number {
  let sum = 0;
  for (const player of HashMap.values(table.seats)) {
    sum += chipsToNumber(player.chips);
  }
  return sum;
}

function totalHandChips(table: TableState): number {
  if (Option.isNone(table.currentHand)) return 0;
  const hs = table.currentHand.value;
  let sum = 0;
  for (const p of hs.players) {
    sum += chipsToNumber(p.chips) + chipsToNumber(p.currentBet);
  }
  for (const pot of hs.pots) {
    sum += chipsToNumber(pot.amount);
  }
  return sum;
}

/**
 * Play the active player's turn by choosing from legal actions based on
 * a numeric choice (deterministic but varied). Returns the updated table.
 */
function playOneAction(table: TableState, choice: number): TableState {
  const seatOpt = getActivePlayer(table);
  if (Option.isNone(seatOpt)) return table;

  const legalOpt = getTableLegalActions(table);
  if (Option.isNone(legalOpt)) return table;

  const legal = legalOpt.value;
  const seat = seatOpt.value;

  const candidates: Action[] = [];
  if (legal.canFold) candidates.push(Fold);
  if (legal.canCheck) candidates.push(Check);
  if (Option.isSome(legal.callAmount)) candidates.push(Call);
  if (legal.canAllIn) candidates.push(AllIn);

  if (candidates.length === 0) return table;

  const idx = ((choice % candidates.length) + candidates.length) % candidates.length;
  const action = candidates[idx]!;

  const result = act(table, seat, action);
  if (Either.isRight(result)) return result.right;

  // Fallback: fold
  const foldResult = act(table, seat, Fold);
  if (Either.isRight(foldResult)) return foldResult.right;

  return table;
}

/**
 * Play a full hand until completion, using the choices array to drive
 * action selection. Returns the table after the hand is complete.
 */
function playHandToCompletion(
  table: TableState,
  choices: readonly number[],
  maxActions = 100,
): TableState {
  let current = table;
  let count = 0;
  while (Option.isSome(current.currentHand) && count < maxActions) {
    current = playOneAction(current, choices[count % choices.length]!);
    count++;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a list of 2-6 distinct seat indices (sorted ascending).
 */
const arbDistinctSeats = fc
  .integer({ min: 2, max: 6 })
  .chain((count) =>
    fc
      .shuffledSubarray([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], {
        minLength: count,
        maxLength: count,
      })
      .map((seats) => [...seats].sort((a, b) => a - b).map((s) => SeatIndex(s))),
  );

/**
 * Generates a table with 2-6 players seated, ready to start a hand.
 */
const arbSeatedTable = arbDistinctSeats.chain((seats) =>
  fc
    .tuple(...seats.map(() => fc.integer({ min: 100, max: 10_000 }).map((n) => Chips(n))))
    .map((chipStacks) => {
      const config: TableConfig = { maxSeats: 10, forcedBets: DEFAULT_BLINDS };
      let table = createTableOrThrow(config);
      for (let i = 0; i < seats.length; i++) {
        table = sitDownOrThrow(table, seats[i]!, chipStacks[i]!);
      }
      return table;
    }),
);

/**
 * Array of random choices used to drive action selection during a hand.
 */
const arbChoices = fc.array(fc.integer({ min: 0, max: 1000 }), {
  minLength: 100,
  maxLength: 100,
});

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("table -- property-based", () => {
  it("button rotates through occupied seats after each hand", () => {
    fc.assert(
      fc.property(arbSeatedTable, arbChoices, arbChoices, (table, choices1, choices2) => {
        // Play first hand
        let t = Effect.runSync(startNextHand(table));
        const button1 = Option.getOrThrow(t.button);

        t = playHandToCompletion(t, choices1);
        // Hand should be complete now
        if (Option.isSome(t.currentHand)) return; // skip if hand didn't complete

        // Need at least 2 eligible players to start another hand
        let eligibleCount = 0;
        for (const p of HashMap.values(t.seats)) {
          if (chipsToNumber(p.chips) > 0) eligibleCount++;
        }
        if (eligibleCount < 2) return;

        // Play second hand
        t = Effect.runSync(startNextHand(t));
        const button2 = Option.getOrThrow(t.button);

        t = playHandToCompletion(t, choices2);
        if (Option.isSome(t.currentHand)) return;

        eligibleCount = 0;
        for (const p of HashMap.values(t.seats)) {
          if (chipsToNumber(p.chips) > 0) eligibleCount++;
        }
        if (eligibleCount < 2) return;

        // Play third hand
        t = Effect.runSync(startNextHand(t));
        const button3 = Option.getOrThrow(t.button);

        // The button should move: each new button must differ from the previous one
        // (with 2+ players in distinct seats, the button must advance).
        // However, if only 2 seats remain, the button alternates between them.
        // In all cases the button must be an occupied seat.
        const occupiedSeats = new Set(
          Array.from(HashMap.keys(t.seats)).map(seatIndexToNumber),
        );
        expect(occupiedSeats.has(seatIndexToNumber(button3))).toBe(true);

        // With 2+ players, button should have changed at least once across the 3 hands
        const buttons = [button1, button2, button3].map(seatIndexToNumber);
        const uniqueButtons = new Set(buttons);
        expect(uniqueButtons.size).toBeGreaterThanOrEqual(2);
      }),
      { numRuns: 100 },
    );
  });

  it("chip conservation: total chips before = total chips after a full hand", () => {
    fc.assert(
      fc.property(arbSeatedTable, arbChoices, (table, choices) => {
        const chipsBefore = totalTableChips(table);

        let t = Effect.runSync(startNextHand(table));

        t = playHandToCompletion(t, choices);
        if (Option.isSome(t.currentHand)) return; // skip if hand didn't complete

        // After hand completes, total chips across seated players must match
        const chipsAfter = totalTableChips(t);

        expect(chipsAfter).toBe(chipsBefore);
      }),
      { numRuns: 200 },
    );
  });

  it("sitDown/standUp inverse: standUp(sitDown(table, seat)) restores seat count", () => {
    fc.assert(
      fc.property(
        arbSeatedTable,
        fc.integer({ min: 0, max: 9 }).map((n) => SeatIndex(n)),
        fc.integer({ min: 1, max: 10_000 }).map((n) => Chips(n)),
        (table, seat, chips) => {
          // Check if the seat is already occupied
          const isOccupied = Option.isSome(HashMap.get(table.seats, seat));

          if (isOccupied) {
            // If seat is occupied, sitDown should fail (tested in property 4)
            return;
          }

          // Check if table is full
          if (HashMap.size(table.seats) >= table.config.maxSeats) return;

          // sitDown then standUp
          const afterSit = sitDown(table, seat, chips);
          expect(Either.isRight(afterSit)).toBe(true);
          if (Either.isLeft(afterSit)) return;

          const tableWithPlayer = afterSit.right;
          expect(HashMap.size(tableWithPlayer.seats)).toBe(
            HashMap.size(table.seats) + 1,
          );
          expect(
            Option.isSome(HashMap.get(tableWithPlayer.seats, seat)),
          ).toBe(true);

          // No hand in progress, so standUp should succeed
          const afterStand = standUp(tableWithPlayer, seat);
          expect(Either.isRight(afterStand)).toBe(true);
          if (Either.isLeft(afterStand)) return;

          const restored = afterStand.right;

          // The seat map should have the same size as before
          expect(HashMap.size(restored.seats)).toBe(HashMap.size(table.seats));

          // The seat should now be empty
          expect(Option.isNone(HashMap.get(restored.seats, seat))).toBe(true);

          // Verify original seats are all still present
          for (const key of HashMap.keys(table.seats)) {
            expect(
              Option.isSome(HashMap.get(restored.seats, key)),
            ).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("cannot sit in an occupied seat", () => {
    fc.assert(
      fc.property(
        arbSeatedTable,
        fc.integer({ min: 1, max: 10_000 }).map((n) => Chips(n)),
        (table, chips) => {
          // Try to sit in every occupied seat — each attempt should fail
          for (const seat of HashMap.keys(table.seats)) {
            const result = sitDown(table, seat, chips);
            expect(Either.isLeft(result)).toBe(true);
            if (Either.isLeft(result)) {
              expect(result.left._tag).toBe("SeatOccupied");
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("busted players (0 chips) are removed after a hand", () => {
    fc.assert(
      fc.property(
        // Use small chip stacks so busts are more likely
        fc
          .integer({ min: 2, max: 4 })
          .chain((count) =>
            fc
              .shuffledSubarray([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], {
                minLength: count,
                maxLength: count,
              })
              .map((seats) =>
                [...seats].sort((a, b) => a - b).map((s) => SeatIndex(s)),
              ),
          )
          .chain((seats) =>
            fc
              .tuple(
                ...seats.map(() =>
                  fc.integer({ min: 2, max: 20 }).map((n) => Chips(n)),
                ),
              )
              .map((chipStacks) => {
                const config: TableConfig = {
                  maxSeats: 10,
                  forcedBets: DEFAULT_BLINDS,
                };
                let table = createTableOrThrow(config);
                for (let i = 0; i < seats.length; i++) {
                  table = sitDownOrThrow(table, seats[i]!, chipStacks[i]!);
                }
                return table;
              }),
          ),
        arbChoices,
        (table, choices) => {
          let t: TableState;
          try {
            t = Effect.runSync(startNextHand(table));
          } catch {
            return; // not enough players or other issue
          }

          t = playHandToCompletion(t, choices);
          if (Option.isSome(t.currentHand)) return; // skip if hand didn't complete

          // After a completed hand, no player with 0 chips should remain seated
          for (const player of HashMap.values(t.seats)) {
            expect(chipsToNumber(player.chips)).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
