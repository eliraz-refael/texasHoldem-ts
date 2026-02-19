import { describe, it, expect } from "vitest";
import { Effect, Either } from "effect";
import {
  createTable,
  sitDown,
  standUp,
  startNextHand,
  act,
  getActivePlayer,
} from "../src/table.js";
import type { TableConfig, TableState } from "../src/table.js";
import { Chips, SeatIndex } from "../src/brand.js";
import { Fold, Call, Check } from "../src/action.js";
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

function sitDownOrThrow(state: TableState, seat: number, chips: number): TableState {
  const result = sitDown(state, SeatIndex(seat), Chips(chips));
  if (Either.isLeft(result)) {
    throw new Error(`sitDown failed: ${JSON.stringify(result.left)}`);
  }
  return result.right;
}

function actOrThrow(state: TableState, seat: number, action: typeof Fold): TableState {
  const result = act(state, SeatIndex(seat), action);
  if (Either.isLeft(result)) {
    throw new Error(`act failed: ${JSON.stringify(result.left)}`);
  }
  return result.right;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createTable", () => {
  it("creates a table with empty seats and no hand", () => {
    const table = createTable(DEFAULT_CONFIG);

    expect(table.seats.size).toBe(0);
    expect(table.currentHand).toBeNull();
    expect(table.button).toBeNull();
    expect(table.handCount).toBe(0);
    expect(table.events).toHaveLength(0);
  });

  it("stores the config correctly", () => {
    const table = createTable(DEFAULT_CONFIG);
    expect(table.config).toEqual(DEFAULT_CONFIG);
  });

  it("throws for maxSeats < 2", () => {
    expect(() => createTable({ maxSeats: 1, forcedBets: DEFAULT_BLINDS })).toThrow();
  });

  it("throws for maxSeats > 10", () => {
    expect(() => createTable({ maxSeats: 11, forcedBets: DEFAULT_BLINDS })).toThrow();
  });
});

describe("sitDown", () => {
  it("adds a player and emits PlayerSatDown event", () => {
    const table = createTable(DEFAULT_CONFIG);
    const result = sitDown(table, SeatIndex(0), Chips(100));

    expect(Either.isRight(result)).toBe(true);
    const newTable = Either.getOrThrow(result);

    expect(newTable.seats.size).toBe(1);
    expect(newTable.seats.has(SeatIndex(0))).toBe(true);

    const player = newTable.seats.get(SeatIndex(0))!;
    expect(player.chips as number).toBe(100);
    expect(player.seatIndex as number).toBe(0);

    expect(newTable.events).toHaveLength(1);
    expect(newTable.events[0]!._tag).toBe("PlayerSatDown");
  });

  it("returns SeatOccupied error for duplicate seat", () => {
    let table = createTable(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);

    const result = sitDown(table, SeatIndex(0), Chips(200));
    expect(Either.isLeft(result)).toBe(true);

    const error = (result as Either.Either<never, { _tag: string }>).left;
    expect(error._tag).toBe("SeatOccupied");
  });

  it("allows seating multiple players at different seats", () => {
    let table = createTable(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);
    table = sitDownOrThrow(table, 3, 200);
    table = sitDownOrThrow(table, 5, 150);

    expect(table.seats.size).toBe(3);
    expect(table.events).toHaveLength(3);
  });
});

describe("standUp", () => {
  it("removes a player and emits PlayerStoodUp event", () => {
    let table = createTable(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);

    const result = standUp(table, SeatIndex(0));
    expect(Either.isRight(result)).toBe(true);
    const newTable = Either.getOrThrow(result);

    expect(newTable.seats.size).toBe(0);
    expect(newTable.seats.has(SeatIndex(0))).toBe(false);

    const lastEvent = newTable.events[newTable.events.length - 1]!;
    expect(lastEvent._tag).toBe("PlayerStoodUp");
  });

  it("returns SeatEmpty error for empty seat", () => {
    const table = createTable(DEFAULT_CONFIG);
    const result = standUp(table, SeatIndex(0));

    expect(Either.isLeft(result)).toBe(true);
    const error = (result as Either.Either<never, { _tag: string }>).left;
    expect(error._tag).toBe("SeatEmpty");
  });

  it("returns HandInProgress error when a hand is active", () => {
    let table = createTable(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);
    table = sitDownOrThrow(table, 1, 100);

    table = Effect.runSync(startNextHand(table));

    const result = standUp(table, SeatIndex(0));
    expect(Either.isLeft(result)).toBe(true);
    const error = (result as Either.Either<never, { _tag: string }>).left;
    expect(error._tag).toBe("HandInProgress");
  });
});

describe("startNextHand", () => {
  it("moves the button and starts a hand", () => {
    let table = createTable(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);
    table = sitDownOrThrow(table, 1, 100);

    const newTable = Effect.runSync(startNextHand(table));

    expect(newTable.button).not.toBeNull();
    expect(newTable.currentHand).not.toBeNull();
    expect(newTable.handCount).toBe(1);
    expect(newTable.currentHand!.phase).toBe("Preflop");
  });

  it("fails with NotEnoughPlayers when fewer than 2 players", () => {
    let table = createTable(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);

    expect(() => Effect.runSync(startNextHand(table))).toThrow();
  });

  it("fails with HandInProgress when a hand is already running", () => {
    let table = createTable(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);
    table = sitDownOrThrow(table, 1, 100);

    table = Effect.runSync(startNextHand(table));

    expect(() => Effect.runSync(startNextHand(table))).toThrow();
  });

  it("advances the button between consecutive hands", () => {
    let table = createTable(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);
    table = sitDownOrThrow(table, 1, 100);

    // First hand
    table = Effect.runSync(startNextHand(table));
    const firstButton = table.button;

    // Complete the hand with a fold
    const activeSeat = getActivePlayer(table);
    table = actOrThrow(table, activeSeat as number, Fold);

    // Second hand
    table = Effect.runSync(startNextHand(table));
    const secondButton = table.button;

    expect(secondButton).not.toBe(firstButton);
  });
});

describe("Full hand through table", () => {
  it("sitDown 2 players, startNextHand, fold, hand completes, chips transferred", () => {
    let table = createTable(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);
    table = sitDownOrThrow(table, 1, 100);

    // Start a hand
    table = Effect.runSync(startNextHand(table));
    expect(table.currentHand).not.toBeNull();

    // The active player folds
    const activeSeat = getActivePlayer(table)!;
    table = actOrThrow(table, activeSeat as number, Fold);

    // Hand should be complete, cleared from table
    expect(table.currentHand).toBeNull();

    // Chips should be transferred: one player gained blinds, other lost
    const p0 = table.seats.get(SeatIndex(0));
    const p1 = table.seats.get(SeatIndex(1));

    // Total chips should be conserved
    const total = (p0 ? (p0.chips as number) : 0) + (p1 ? (p1.chips as number) : 0);
    expect(total).toBe(200);

    // One player should have more than 100, the other less (or equal if somehow both kept 100)
    const chips = [p0 ? (p0.chips as number) : 0, p1 ? (p1.chips as number) : 0];
    expect(chips.some((c) => c > 100)).toBe(true);

    // Hand events merged into table events
    expect(table.events.some((e) => e._tag === "HandStarted")).toBe(true);
    expect(table.events.some((e) => e._tag === "HandEnded")).toBe(true);
  });
});
