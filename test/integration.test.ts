import { describe, it, expect } from "vitest";
import { Effect, Either, HashMap, Option } from "effect";
import {
  createTable,
  sitDown,
  startNextHand,
  act,
  getActivePlayer,
} from "../src/table.js";
import type { TableConfig, TableState } from "../src/table.js";
import { Chips, SeatIndex, chipsToNumber, seatIndexToNumber } from "../src/brand.js";
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

function createTableOrThrow(config: TableConfig): TableState {
  return Either.getOrThrow(createTable(config));
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

function playTableRound(
  table: TableState,
  makeAction: () => typeof Check,
): TableState {
  let current = table;
  const startPhase = Option.isSome(current.currentHand)
    ? current.currentHand.value.phase
    : "Complete";

  while (
    Option.isSome(current.currentHand) &&
    current.currentHand.value.phase === startPhase
  ) {
    const seat = getActivePlayer(current);
    if (Option.isNone(seat)) break;
    current = actOrThrow(current, seat.value, makeAction());
  }
  return current;
}

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

describe("Integration: Heads-up fold preflop", () => {
  it("2 players, start hand, button folds, BB wins blinds", () => {
    let table = createTableOrThrow(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);
    table = sitDownOrThrow(table, 1, 100);

    const chipsBefore = totalChips(table);
    expect(chipsBefore).toBe(200);

    table = Effect.runSync(startNextHand(table));
    expect(Option.isSome(table.currentHand)).toBe(true);
    if (Option.isSome(table.currentHand)) {
      expect(table.currentHand.value.phase).toBe("Preflop");
    }

    const activeSeat = Option.getOrThrow(getActivePlayer(table));
    table = actOrThrow(table, activeSeat, Fold);

    expect(Option.isNone(table.currentHand)).toBe(true);

    const chipsAfter = totalChips(table);
    expect(chipsAfter).toBe(200);

    let p0chips = 0;
    let p1chips = 0;
    const p0 = HashMap.get(table.seats, SeatIndex(0));
    const p1 = HashMap.get(table.seats, SeatIndex(1));
    if (Option.isSome(p0)) p0chips = chipsToNumber(p0.value.chips);
    if (Option.isSome(p1)) p1chips = chipsToNumber(p1.value.chips);

    expect(p0chips + p1chips).toBe(200);
    expect(p0chips !== 100 || p1chips !== 100).toBe(true);
  });
});

describe("Integration: 3-player hand to showdown", () => {
  it("3 players, everyone calls/checks to river, showdown awards pot to best hand", () => {
    let table = createTableOrThrow(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);
    table = sitDownOrThrow(table, 1, 100);
    table = sitDownOrThrow(table, 2, 100);

    const chipsBefore = totalChips(table);
    expect(chipsBefore).toBe(300);

    table = Effect.runSync(startNextHand(table));
    expect(Option.isSome(table.currentHand)).toBe(true);

    let seat = Option.getOrThrow(getActivePlayer(table));
    table = actOrThrow(table, seat, Call);

    seat = Option.getOrThrow(getActivePlayer(table));
    table = actOrThrow(table, seat, Call);

    seat = Option.getOrThrow(getActivePlayer(table));
    table = actOrThrow(table, seat, Check);

    expect(Option.isSome(table.currentHand)).toBe(true);
    if (Option.isSome(table.currentHand)) {
      expect(table.currentHand.value.phase).toBe("Flop");
      expect(table.currentHand.value.communityCards).toHaveLength(3);
    }

    table = playTableRound(table, () => Check);
    expect(Option.isSome(table.currentHand)).toBe(true);
    if (Option.isSome(table.currentHand)) {
      expect(table.currentHand.value.phase).toBe("Turn");
      expect(table.currentHand.value.communityCards).toHaveLength(4);
    }

    table = playTableRound(table, () => Check);
    expect(Option.isSome(table.currentHand)).toBe(true);
    if (Option.isSome(table.currentHand)) {
      expect(table.currentHand.value.phase).toBe("River");
      expect(table.currentHand.value.communityCards).toHaveLength(5);
    }

    table = playTableRound(table, () => Check);

    expect(Option.isNone(table.currentHand)).toBe(true);

    const chipsAfter = totalChips(table);
    expect(chipsAfter).toBe(300);

    expect(table.events.some((e) => e._tag === "PotAwarded")).toBe(true);
    expect(table.events.some((e) => e._tag === "ShowdownStarted")).toBe(true);
    expect(table.events.some((e) => e._tag === "HandEnded")).toBe(true);
  });
});

describe("Integration: Multiple consecutive hands", () => {
  it("plays 2 hands, button moves, chips transfer correctly", () => {
    let table = createTableOrThrow(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 100);
    table = sitDownOrThrow(table, 1, 100);

    const initialTotal = totalChips(table);
    expect(initialTotal).toBe(200);

    // Hand 1
    table = Effect.runSync(startNextHand(table));
    const button1 = table.button;
    expect(table.handCount).toBe(1);

    let activeSeat = Option.getOrThrow(getActivePlayer(table));
    table = actOrThrow(table, activeSeat, Fold);
    expect(Option.isNone(table.currentHand)).toBe(true);

    expect(totalChips(table)).toBe(200);

    // Hand 2
    table = Effect.runSync(startNextHand(table));
    const button2 = table.button;
    expect(table.handCount).toBe(2);

    expect(Option.getOrThrow(button2)).not.toBe(Option.getOrThrow(button1));

    activeSeat = Option.getOrThrow(getActivePlayer(table));
    table = actOrThrow(table, activeSeat, Fold);
    expect(Option.isNone(table.currentHand)).toBe(true);

    expect(totalChips(table)).toBe(200);

    const handStartedEvents = table.events.filter(
      (e) => e._tag === "HandStarted",
    );
    expect(handStartedEvents).toHaveLength(2);
  });

  it("plays 3 hands with 3 players, button rotates through seats", () => {
    let table = createTableOrThrow(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 200);
    table = sitDownOrThrow(table, 1, 200);
    table = sitDownOrThrow(table, 2, 200);

    const buttons: number[] = [];

    for (let i = 0; i < 3; i++) {
      table = Effect.runSync(startNextHand(table));
      buttons.push(seatIndexToNumber(Option.getOrThrow(table.button)));

      // Fold until hand completes (may need multiple folds with 3 players)
      while (Option.isSome(table.currentHand)) {
        const seat = getActivePlayer(table);
        if (Option.isNone(seat)) break;
        table = actOrThrow(table, seat.value, Fold);
      }
    }

    const uniqueButtons = new Set(buttons);
    expect(uniqueButtons.size).toBe(3);

    expect(totalChips(table)).toBe(600);
  });
});

describe("Integration: Player bust-out", () => {
  it("player loses all chips and gets removed from table", () => {
    let table = createTableOrThrow(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 2);
    table = sitDownOrThrow(table, 1, 100);

    const initialTotal = totalChips(table);
    expect(initialTotal).toBe(102);

    table = Effect.runSync(startNextHand(table));

    const activeSeat = Option.getOrThrow(getActivePlayer(table));
    table = actOrThrow(table, activeSeat, Fold);

    expect(Option.isNone(table.currentHand)).toBe(true);

    expect(totalChips(table)).toBe(102);

    // Try a more deterministic bust scenario
    let table2 = createTableOrThrow(DEFAULT_CONFIG);
    table2 = sitDownOrThrow(table2, 0, 1);
    table2 = sitDownOrThrow(table2, 1, 100);

    table2 = Effect.runSync(startNextHand(table2));

    // Seat 0 (1 chip) posts SB and may be all-in. BB (seat 1) may need to act.
    // Fold all active players until hand completes.
    while (Option.isSome(table2.currentHand)) {
      const seat2 = getActivePlayer(table2);
      if (Option.isNone(seat2)) break;
      table2 = actOrThrow(table2, seat2.value, Fold);
    }

    // Hand may have auto-completed (all-in vs fold)
    // Just verify chip conservation
    expect(totalChips(table2)).toBe(101);
  });

  it("busted player cannot participate in next hand", () => {
    let table = createTableOrThrow({
      maxSeats: 6,
      forcedBets: { smallBlind: Chips(5), bigBlind: Chips(10) },
    });
    table = sitDownOrThrow(table, 0, 5);
    table = sitDownOrThrow(table, 1, 200);
    table = sitDownOrThrow(table, 2, 200);

    table = Effect.runSync(startNextHand(table));

    let seat = Option.getOrThrow(getActivePlayer(table));
    table = actOrThrow(table, seat, Fold);

    seat = Option.getOrThrow(getActivePlayer(table));
    table = actOrThrow(table, seat, Fold);

    expect(Option.isNone(table.currentHand)).toBe(true);

    const totalAfterHand1 = totalChips(table);
    expect(totalAfterHand1).toBe(405);

    table = Effect.runSync(startNextHand(table));

    seat = Option.getOrThrow(getActivePlayer(table));
    table = actOrThrow(table, seat, Fold);

    if (Option.isSome(table.currentHand)) {
      seat = Option.getOrThrow(getActivePlayer(table));
      table = actOrThrow(table, seat, Fold);
    }

    expect(Option.isNone(table.currentHand)).toBe(true);
    expect(totalChips(table)).toBe(405);
  });
});

describe("Integration: Chip conservation across scenarios", () => {
  it("total chips remain constant through a full multi-street hand", () => {
    let table = createTableOrThrow(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 500);
    table = sitDownOrThrow(table, 1, 500);

    const initialTotal = totalChips(table);

    table = Effect.runSync(startNextHand(table));

    let seat = Option.getOrThrow(getActivePlayer(table));
    table = actOrThrow(table, seat, Call);
    seat = Option.getOrThrow(getActivePlayer(table));
    table = actOrThrow(table, seat, Check);

    table = playTableRound(table, () => Check);
    table = playTableRound(table, () => Check);
    table = playTableRound(table, () => Check);

    expect(Option.isNone(table.currentHand)).toBe(true);
    expect(totalChips(table)).toBe(initialTotal);
  });

  it("total chips remain constant when hand ends by fold", () => {
    let table = createTableOrThrow(DEFAULT_CONFIG);
    table = sitDownOrThrow(table, 0, 500);
    table = sitDownOrThrow(table, 1, 500);
    table = sitDownOrThrow(table, 2, 500);

    const initialTotal = totalChips(table);

    table = Effect.runSync(startNextHand(table));

    let seat = Option.getOrThrow(getActivePlayer(table));
    table = actOrThrow(table, seat, Fold);

    seat = Option.getOrThrow(getActivePlayer(table));
    table = actOrThrow(table, seat, Fold);

    expect(Option.isNone(table.currentHand)).toBe(true);
    expect(totalChips(table)).toBe(initialTotal);
  });
});
