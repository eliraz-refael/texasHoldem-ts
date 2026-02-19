import { describe, it, expect } from "vitest";
import { Effect, Either, Option } from "effect";
import {
  startHand,
  act,
  activePlayer,
  isComplete,
} from "../src/hand.js";
import type { ForcedBets, HandState } from "../src/hand.js";
import { Chips, SeatIndex, HandId, chipsToNumber, seatIndexToNumber } from "../src/brand.js";
import { createPlayer } from "../src/player.js";
import { Fold, Check, Call } from "../src/action.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runStartHand(
  players: Parameters<typeof startHand>[0],
  button: Parameters<typeof startHand>[1],
  forcedBets: Parameters<typeof startHand>[2],
  handId?: Parameters<typeof startHand>[3],
) {
  return Effect.runSync(
    startHand(players, button, forcedBets, handId ?? HandId("test-hand")),
  );
}

const DEFAULT_BLINDS: ForcedBets = {
  smallBlind: Chips(1),
  bigBlind: Chips(2),
};

function makePlayers(count: number, chips = 100) {
  return Array.from({ length: count }, (_, i) =>
    createPlayer(SeatIndex(i), Chips(chips)),
  );
}

function actOrThrow(state: HandState, seat: SeatIndex, action: typeof Fold): HandState {
  const result = act(state, seat, action);
  if (Either.isLeft(result)) {
    throw new Error(`act failed: ${JSON.stringify(result.left)}`);
  }
  return result.right;
}

function playRoundWith(state: HandState, makeAction: () => typeof Check): HandState {
  let current = state;
  const startPhase = current.phase;
  while (!isComplete(current) && current.phase === startPhase) {
    const seat = activePlayer(current);
    if (Option.isNone(seat)) break;
    current = actOrThrow(current, seat.value, makeAction());
  }
  return current;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Basic phase progression, chip conservation, community card counts, hole
// card dealing, and termination are covered by hand.properties.ts.
// Only specific blind posting and full-hand integration scenarios remain.

describe("startHand — blind posting", () => {
  it("posts small and big blinds with known amounts", () => {
    const players = makePlayers(3);
    const state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);

    const sb = state.players.find((p) => seatIndexToNumber(p.seatIndex) === 1);
    expect(sb).toBeDefined();
    if (sb === undefined) return;
    const bb = state.players.find((p) => seatIndexToNumber(p.seatIndex) === 2);
    expect(bb).toBeDefined();
    if (bb === undefined) return;

    expect(chipsToNumber(sb.chips)).toBe(99);
    expect(chipsToNumber(bb.chips)).toBe(98);
    expect(chipsToNumber(sb.currentBet)).toBe(1);
    expect(chipsToNumber(bb.currentBet)).toBe(2);
  });

  it("posts correct blinds in heads-up (button = SB)", () => {
    const players = makePlayers(2);
    const state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);

    const btn = state.players.find((p) => seatIndexToNumber(p.seatIndex) === 0);
    expect(btn).toBeDefined();
    if (btn === undefined) return;
    const other = state.players.find((p) => seatIndexToNumber(p.seatIndex) === 1);
    expect(other).toBeDefined();
    if (other === undefined) return;

    expect(chipsToNumber(btn.currentBet)).toBe(1);
    expect(chipsToNumber(other.currentBet)).toBe(2);
  });
});

describe("Heads-up fold preflop", () => {
  it("button folds -> other player wins, hand is complete", () => {
    const players = makePlayers(2);
    const state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);

    const btnSeat = activePlayer(state);
    expect(Option.isSome(btnSeat)).toBe(true);
    if (Option.isSome(btnSeat)) {
      expect(seatIndexToNumber(btnSeat.value)).toBe(0);
    }

    const after = actOrThrow(state, Option.getOrThrow(btnSeat), Fold);

    expect(isComplete(after)).toBe(true);
    expect(after.phase).toBe("Complete");

    const winner = after.players.find((p) => seatIndexToNumber(p.seatIndex) === 1);
    expect(winner).toBeDefined();
    if (winner === undefined) return;
    expect(chipsToNumber(winner.chips)).toBe(101);

    const loser = after.players.find((p) => seatIndexToNumber(p.seatIndex) === 0);
    expect(loser).toBeDefined();
    if (loser === undefined) return;
    expect(chipsToNumber(loser.chips)).toBe(99);
  });
});

describe("3-player hand: everyone checks to showdown", () => {
  it("progresses through all phases and ends at Complete", () => {
    const players = makePlayers(3, 100);
    let state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);

    expect(state.phase).toBe("Preflop");

    let seat = Option.getOrThrow(activePlayer(state));
    state = actOrThrow(state, seat, Call);

    seat = Option.getOrThrow(activePlayer(state));
    state = actOrThrow(state, seat, Call);

    seat = Option.getOrThrow(activePlayer(state));
    state = actOrThrow(state, seat, Check);

    expect(state.phase).toBe("Flop");
    expect(state.communityCards).toHaveLength(3);

    state = playRoundWith(state, () => Check);
    expect(state.phase).toBe("Turn");
    expect(state.communityCards).toHaveLength(4);

    state = playRoundWith(state, () => Check);
    expect(state.phase).toBe("River");
    expect(state.communityCards).toHaveLength(5);

    state = playRoundWith(state, () => Check);
    expect(isComplete(state)).toBe(true);
    expect(state.phase).toBe("Complete");
  });
});

