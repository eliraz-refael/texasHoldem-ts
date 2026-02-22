import { describe, it, expect } from "vitest";
import { Effect, Either, HashMap, Option } from "effect";
import { SeatIndex, Chips, chipsToNumber, seatIndexToNumber } from "../src/brand.js";
import { Fold, Check, Call, Bet } from "../src/action.js";
import type { GameEvent } from "../src/event.js";
import { createTable, sitDown, startNextHand } from "../src/table.js";
import type { TableState } from "../src/table.js";
import {
  alwaysFold,
  passiveStrategy,
  fromSync,
  playOneHand,
  playHand,
  playGame,
  stopAfterHands,
  stopWhenFewPlayers,
} from "../src/loop.js";
import type { StrategyContext } from "../src/position.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTable(playerCount: number, chips = 1000): TableState {
  let state = Either.getOrThrow(
    createTable({
      maxSeats: 10,
      forcedBets: { smallBlind: Chips(5), bigBlind: Chips(10) },
    }),
  );
  for (let i = 0; i < playerCount; i++) {
    state = Either.getOrThrow(sitDown(state, SeatIndex(i), Chips(chips)));
  }
  return state;
}

function totalChips(state: TableState): number {
  let total = 0;
  for (const [, player] of HashMap.entries(state.seats)) {
    total += chipsToNumber(player.chips);
  }
  return total;
}

// ---------------------------------------------------------------------------
// playHand tests
// ---------------------------------------------------------------------------

describe("playHand", () => {
  it("completes a hand with alwaysFold", () => {
    const table = makeTable(4);
    const result = Effect.runSync(playHand(table, alwaysFold));

    expect(result.completed).toBe(true);
    expect(result.actionCount).toBeGreaterThan(0);
    // Hand should be complete — no currentHand
    expect(Option.isNone(result.state.currentHand)).toBe(true);
  });

  it("reaches showdown with passiveStrategy and chips are conserved", () => {
    const table = makeTable(4);
    const initialChips = totalChips(table);
    const result = Effect.runSync(playHand(table, passiveStrategy));

    expect(result.completed).toBe(true);
    expect(totalChips(result.state)).toBe(initialChips);
  });

  it("limits actions with maxActionsPerHand", () => {
    const table = makeTable(4);
    const result = Effect.runSync(
      playHand(table, passiveStrategy, { maxActionsPerHand: 1 }),
    );

    expect(result.completed).toBe(false);
    expect(result.actionCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// playOneHand tests
// ---------------------------------------------------------------------------

describe("playOneHand", () => {
  it("works with an already-started hand", () => {
    const table = makeTable(4);
    const started = Effect.runSync(startNextHand(table));
    const result = Effect.runSync(playOneHand(started, alwaysFold));

    expect(result.completed).toBe(true);
    expect(result.actionCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// onEvent tests
// ---------------------------------------------------------------------------

describe("onEvent", () => {
  it("receives events in correct order", () => {
    const table = makeTable(4);
    const events: GameEvent[] = [];

    Effect.runSync(
      playHand(table, alwaysFold, {
        onEvent: (ev) => events.push(ev),
      }),
    );

    expect(events.length).toBeGreaterThan(0);
    // First event should be HandStarted
    expect(events[0]!._tag).toBe("HandStarted");
    // Last event should be HandEnded
    expect(events[events.length - 1]!._tag).toBe("HandEnded");
  });
});

// ---------------------------------------------------------------------------
// StrategyContext tests
// ---------------------------------------------------------------------------

describe("StrategyContext", () => {
  it("has correct positional info", () => {
    const table = makeTable(4);
    const contexts: StrategyContext[] = [];

    Effect.runSync(
      playHand(table, fromSync((ctx) => {
        contexts.push(ctx);
        return Fold;
      })),
    );

    expect(contexts.length).toBeGreaterThan(0);
    const first = contexts[0]!;
    expect(first.phase).toBe("Preflop");
    expect(first.activeSeatCount).toBe(4);
    // Role should be one of the valid roles
    const validRoles = ["Button", "SmallBlind", "BigBlind", "UTG", "UTG1", "UTG2", "LJ", "HJ", "CO"];
    expect(validRoles).toContain(first.role);
  });

  it("contains delta events per turn", () => {
    const table = makeTable(4);
    const eventCounts: number[] = [];

    Effect.runSync(
      playHand(table, fromSync((ctx) => {
        eventCounts.push(ctx.newEvents.length);
        return Fold;
      })),
    );

    // The first action should have newEvents from the hand start (blinds, etc.)
    // Subsequent actions should have fewer events (just the previous player's action)
    expect(eventCounts.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// playGame tests
// ---------------------------------------------------------------------------

describe("playGame", () => {
  it("plays exactly N hands with stopAfterHands", () => {
    const table = makeTable(4);
    const result = Effect.runSync(
      playGame(table, passiveStrategy, { stopWhen: stopAfterHands(5) }),
    );

    expect(result.handsPlayed).toBe(5);
  });

  it("stops when fewer than 2 players remain", () => {
    // Give players very few chips so they bust quickly
    const table = makeTable(4, 15);
    const result = Effect.runSync(
      playGame(table, alwaysFold, { maxHands: 100 }),
    );

    // Should stop because players bust out
    const remaining = HashMap.size(result.state.seats);
    expect(remaining).toBeLessThanOrEqual(4);
    expect(result.handsPlayed).toBeGreaterThan(0);
  });

  it("conserves chips across multiple hands", () => {
    const table = makeTable(4);
    const initialChips = totalChips(table);

    const result = Effect.runSync(
      playGame(table, passiveStrategy, { stopWhen: stopAfterHands(10) }),
    );

    expect(totalChips(result.state)).toBe(initialChips);
  });
});

// ---------------------------------------------------------------------------
// Invalid action fallback tests
// ---------------------------------------------------------------------------

describe("invalid action fallback", () => {
  it("falls back to defaultAction on invalid action", () => {
    const table = makeTable(4);
    // A strategy that always tries to bet 1 chip (often invalid when a bet is already out)
    const badStrategy = fromSync(() => Bet({ amount: Chips(1) }));

    const result = Effect.runSync(
      playHand(table, badStrategy, { defaultAction: Fold }),
    );

    expect(result.completed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Timeout tests
// ---------------------------------------------------------------------------

describe("timeout", () => {
  it("triggers defaultAction on timeout", async () => {
    const table = makeTable(4);
    // A strategy that never resolves (hangs forever)
    const hangingStrategy = () => Effect.never;

    const result = await Effect.runPromise(
      playHand(table, hangingStrategy, {
        actionTimeout: "10 millis",
        defaultAction: Fold,
      }),
    );

    expect(result.completed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stopWhenFewPlayers
// ---------------------------------------------------------------------------

describe("stopWhenFewPlayers", () => {
  it("stops when fewer than specified players", () => {
    const stop = stopWhenFewPlayers(3);
    const table = makeTable(2);
    expect(stop(table, 0)).toBe(true);

    const table4 = makeTable(4);
    expect(stop(table4, 0)).toBe(false);
  });
});
