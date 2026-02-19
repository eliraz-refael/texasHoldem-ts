import { describe, it, expect } from "vitest";
import { Effect, Either, HashMap, Option } from "effect";
import {
  createTable,
  sitDown,
  standUp,
  startNextHand,
  act,
  getActivePlayer,
} from "../src/table.js";
import type { TableConfig, TableState } from "../src/table.js";
import { Chips, SeatIndex, chipsToNumber } from "../src/brand.js";
import { Fold } from "../src/action.js";
import type { ForcedBets } from "../src/hand.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_BLINDS: ForcedBets = {
  smallBlind: Chips(1),
  bigBlind: Chips(2),
};

const DEFAULT_CONFIG: TableConfig = {
  maxSeats: 6,
  forcedBets: DEFAULT_BLINDS,
};

function createTableOrThrow(config: TableConfig): TableState {
  const result = createTable(config);
  if (Either.isLeft(result)) throw new Error(result.left.reason);
  return result.right;
}

function sitDownOrThrow(state: TableState, seat: number, chips: number): TableState {
  const result = sitDown(state, SeatIndex(seat), Chips(chips));
  if (Either.isLeft(result)) {
    throw new Error(`sitDown failed: ${JSON.stringify(result.left)}`);
  }
  return result.right;
}

function actOrThrow(state: TableState, seat: SeatIndex, action: typeof Fold): TableState {
  const result = act(state, seat, action);
  if (Either.isLeft(result)) {
    throw new Error(`act failed: ${JSON.stringify(result.left)}`);
  }
  return result.right;
}

function totalChips(table: TableState): number {
  let sum = 0;
  for (const player of HashMap.values(table.seats)) {
    sum += chipsToNumber(player.chips);
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createTable", () => {
  it("creates a table with empty seats and no hand", () => {
    const table = createTableOrThrow(DEFAULT_CONFIG);

    expect(HashMap.size(table.seats)).toBe(0);
    expect(Option.isNone(table.currentHand)).toBe(true);
    expect(Option.isNone(table.button)).toBe(true);
    expect(table.handCount).toBe(0);
    expect(table.events).toHaveLength(0);
  });

  it("stores the config correctly", () => {
    const table = createTableOrThrow(DEFAULT_CONFIG);
    expect(table.config).toEqual(DEFAULT_CONFIG);
  });

  it("returns Either.left for maxSeats < 2", () => {
    const result = createTable({ maxSeats: 1, forcedBets: DEFAULT_BLINDS });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("returns Either.left for maxSeats > 10", () => {
    const result = createTable({ maxSeats: 11, forcedBets: DEFAULT_BLINDS });
    expect(Either.isLeft(result)).toBe(true);
  });
});

// Basic sitDown/standUp and button rotation are covered by table.properties.ts.
// Only error cases and multi-hand integration scenarios remain.

describe("sitDown — error cases", () => {
  it("returns SeatOccupied error for duplicate seat", () => {
    let table = createTableOrThrow(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);

    const result = sitDown(table, SeatIndex(0), Chips(200));
    expect(Either.isLeft(result)).toBe(true);

    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SeatOccupied");
    }
  });
});

describe("standUp — error cases", () => {
  it("returns SeatEmpty error for empty seat", () => {
    const table = createTableOrThrow(DEFAULT_CONFIG);
    const result = standUp(table, SeatIndex(0));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SeatEmpty");
    }
  });

  it("returns HandInProgress error when a hand is active", () => {
    let table = createTableOrThrow(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);
    table = sitDownOrThrow(table, 1, 100);

    table = Effect.runSync(startNextHand(table));

    const result = standUp(table, SeatIndex(0));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("HandInProgress");
    }
  });
});

describe("startNextHand — error cases", () => {
  it("fails with NotEnoughPlayers when fewer than 2 players", () => {
    let table = createTableOrThrow(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);

    expect(() => Effect.runSync(startNextHand(table))).toThrow();
  });

  it("fails with HandInProgress when a hand is already running", () => {
    let table = createTableOrThrow(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);
    table = sitDownOrThrow(table, 1, 100);

    table = Effect.runSync(startNextHand(table));

    expect(() => Effect.runSync(startNextHand(table))).toThrow();
  });
});

describe("Full hand through table", () => {
  it("sitDown 2 players, startNextHand, fold, hand completes, chips transferred", () => {
    let table = createTableOrThrow(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);
    table = sitDownOrThrow(table, 1, 100);

    table = Effect.runSync(startNextHand(table));
    expect(Option.isSome(table.currentHand)).toBe(true);

    const activeSeat = Option.getOrThrow(getActivePlayer(table));
    table = actOrThrow(table, activeSeat, Fold);

    expect(Option.isNone(table.currentHand)).toBe(true);

    // Total chips conserved
    expect(totalChips(table)).toBe(200);

    // One player should have more than 100
    const chips: number[] = [];
    for (const p of HashMap.values(table.seats)) {
      chips.push(chipsToNumber(p.chips));
    }
    expect(chips.some((c) => c > 100)).toBe(true);

    // Hand events merged
    expect(table.events.some((e) => e._tag === "HandStarted")).toBe(true);
    expect(table.events.some((e) => e._tag === "HandEnded")).toBe(true);
  });
});
