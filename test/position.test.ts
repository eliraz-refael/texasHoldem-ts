import { describe, it, expect } from "vitest";
import { Arbitrary, FastCheck } from "effect";
import { Effect, Either, Option } from "effect";
import { SeatIndex, Chips, HandId, seatIndexToNumber } from "../src/brand.js";
import { createPlayer } from "../src/player.js";
import { createTable, sitDown, startNextHand } from "../src/table.js";
import type { TableState } from "../src/table.js";
import {
  computePositionalRoles,
  getSmallBlindSeat,
  getBigBlindSeat,
  getPlayersToActAfter,
  getPositionalRole,
  buildStrategyContext,
  toPlayerView,
  PositionalRoleSchema,
  PlayerViewSchema,
  StrategyContextSchema,
} from "../src/position.js";
import type { PositionalRole } from "../src/position.js";
import { startHand } from "../src/hand.js";
import type { ForcedBets } from "../src/hand.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_BLINDS: ForcedBets = {
  smallBlind: Chips(5),
  bigBlind: Chips(10),
};

function makeSeats(count: number): readonly SeatIndex[] {
  return Array.from({ length: count }, (_, i) => SeatIndex(i));
}

function makeTableWithPlayers(count: number): TableState {
  let state = Either.getOrThrow(
    createTable({ maxSeats: 10, forcedBets: DEFAULT_BLINDS }),
  );
  for (let i = 0; i < count; i++) {
    state = Either.getOrThrow(sitDown(state, SeatIndex(i), Chips(1000)));
  }
  return state;
}

function startedTable(count: number): TableState {
  const table = makeTableWithPlayers(count);
  return Effect.runSync(startNextHand(table));
}

// ---------------------------------------------------------------------------
// computePositionalRoles
// ---------------------------------------------------------------------------

describe("computePositionalRoles", () => {
  it("returns correct roles for 2 players (heads-up)", () => {
    const seats = makeSeats(2);
    const roles = computePositionalRoles(seats);

    expect(roles.get(seats[0]!)).toBe("Button");
    expect(roles.get(seats[1]!)).toBe("BigBlind");
  });

  it("returns correct roles for 4 players", () => {
    const seats = makeSeats(4);
    const roles = computePositionalRoles(seats);

    expect(roles.get(seats[0]!)).toBe("Button");
    expect(roles.get(seats[1]!)).toBe("SmallBlind");
    expect(roles.get(seats[2]!)).toBe("BigBlind");
    expect(roles.get(seats[3]!)).toBe("UTG");
  });

  it("returns correct roles for 6 players", () => {
    const seats = makeSeats(6);
    const roles = computePositionalRoles(seats);

    expect(roles.get(seats[0]!)).toBe("Button");
    expect(roles.get(seats[1]!)).toBe("SmallBlind");
    expect(roles.get(seats[2]!)).toBe("BigBlind");
    expect(roles.get(seats[3]!)).toBe("UTG");
    expect(roles.get(seats[4]!)).toBe("HJ");
    expect(roles.get(seats[5]!)).toBe("CO");
  });

  it("returns correct roles for 9 players", () => {
    const seats = makeSeats(9);
    const roles = computePositionalRoles(seats);

    expect(roles.get(seats[0]!)).toBe("Button");
    expect(roles.get(seats[1]!)).toBe("SmallBlind");
    expect(roles.get(seats[2]!)).toBe("BigBlind");
    expect(roles.get(seats[3]!)).toBe("UTG");
    expect(roles.get(seats[4]!)).toBe("UTG1");
    expect(roles.get(seats[5]!)).toBe("UTG2");
    expect(roles.get(seats[6]!)).toBe("LJ");
    expect(roles.get(seats[7]!)).toBe("HJ");
    expect(roles.get(seats[8]!)).toBe("CO");
  });
});

// ---------------------------------------------------------------------------
// getSmallBlindSeat / getBigBlindSeat
// ---------------------------------------------------------------------------

describe("getSmallBlindSeat", () => {
  it("returns button seat for heads-up", () => {
    const seats = makeSeats(2);
    expect(getSmallBlindSeat(seats)).toBe(seats[0]!);
  });

  it("returns seat 1 for multi-way", () => {
    const seats = makeSeats(4);
    expect(getSmallBlindSeat(seats)).toBe(seats[1]!);
  });
});

describe("getBigBlindSeat", () => {
  it("returns seat 1 for heads-up", () => {
    const seats = makeSeats(2);
    expect(getBigBlindSeat(seats)).toBe(seats[1]!);
  });

  it("returns seat 2 for multi-way", () => {
    const seats = makeSeats(4);
    expect(getBigBlindSeat(seats)).toBe(seats[2]!);
  });
});

// ---------------------------------------------------------------------------
// getPlayersToActAfter
// ---------------------------------------------------------------------------

describe("getPlayersToActAfter", () => {
  it("returns correct count at start of preflop", () => {
    const table = startedTable(4);
    const hand = Option.getOrThrow(table.currentHand);

    // The active player should have some players after them
    if (Option.isSome(hand.bettingRound)) {
      const br = hand.bettingRound.value;
      if (br.activeSeatOrder.length > 0) {
        const firstSeat = br.activeSeatOrder[0]!;
        const after = getPlayersToActAfter(hand, firstSeat);
        expect(after).toBe(br.activeSeatOrder.length - 1);
      }
    }
  });

  it("returns 0 for a seat not in betting round", () => {
    const table = startedTable(4);
    const hand = Option.getOrThrow(table.currentHand);
    // SeatIndex(9) is not in the hand
    expect(getPlayersToActAfter(hand, SeatIndex(9))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildStrategyContext
// ---------------------------------------------------------------------------

describe("buildStrategyContext", () => {
  it("returns None when no hand in progress", () => {
    const table = makeTableWithPlayers(4);
    const ctx = buildStrategyContext(table, SeatIndex(0), []);
    expect(Option.isNone(ctx)).toBe(true);
  });

  it("returns Some with correct fields when hand is in progress", () => {
    const table = startedTable(4);
    const hand = Option.getOrThrow(table.currentHand);
    const seat = hand.seatOrder[0]!;

    const ctx = buildStrategyContext(table, seat, []);
    expect(Option.isSome(ctx)).toBe(true);

    if (Option.isSome(ctx)) {
      expect(ctx.value.seat).toBe(seat);
      expect(ctx.value.buttonSeat).toBe(hand.button);
      expect(ctx.value.phase).toBe("Preflop");
      expect(ctx.value.communityCards).toEqual([]);
      expect(ctx.value.activeSeatCount).toBe(4);
      expect(ctx.value.players.length).toBe(4);
    }
  });

  it("returns None for seat not in the hand", () => {
    const table = startedTable(4);
    const ctx = buildStrategyContext(table, SeatIndex(9), []);
    expect(Option.isNone(ctx)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toPlayerView
// ---------------------------------------------------------------------------

describe("toPlayerView", () => {
  it("converts a player to PlayerView with role", () => {
    const player = createPlayer(SeatIndex(0), Chips(1000));
    const view = toPlayerView(player, "Button");
    expect(view.seatIndex).toBe(player.seatIndex);
    expect(view.chips).toBe(player.chips);
    expect(view.role).toBe("Button");
    expect(view.isFolded).toBe(false);
    expect(view.isAllIn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Arbitrary generation tests
// ---------------------------------------------------------------------------

describe("Schema Arbitrary generation", () => {
  it("generates valid PositionalRoles", () => {
    const arb = Arbitrary.make(PositionalRoleSchema);
    FastCheck.assert(FastCheck.property(arb, (role) => {
      const validRoles: readonly string[] = [
        "Button", "SmallBlind", "BigBlind",
        "UTG", "UTG1", "UTG2", "LJ", "HJ", "CO",
      ];
      return validRoles.includes(role);
    }));
  });

  it("generates valid PlayerViews", () => {
    const arb = Arbitrary.make(PlayerViewSchema);
    FastCheck.assert(FastCheck.property(arb, (pv) => {
      return typeof pv.chips === "number" && typeof pv.isFolded === "boolean";
    }));
  });

  it("generates valid StrategyContexts", () => {
    const arb = Arbitrary.make(StrategyContextSchema);
    FastCheck.assert(
      FastCheck.property(arb, (ctx) => {
        return typeof ctx.seat === "number" && typeof ctx.phase === "string";
      }),
      { numRuns: 10 },
    );
  });
});
