import { describe, it, expect } from "vitest";
import { Effect, Either } from "effect";
import {
  startHand,
  act,
  activePlayer,
  isComplete,
  currentPhase,
  getEvents,
  getLegalActions,
} from "../src/hand.js";
import type { ForcedBets, HandState } from "../src/hand.js";
import { Chips, SeatIndex } from "../src/brand.js";
import { createPlayer } from "../src/player.js";
import { Fold, Check, Call } from "../src/action.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runStartHand(...args: Parameters<typeof startHand>) {
  return Effect.runSync(startHand(...args));
}

const DEFAULT_BLINDS: ForcedBets = {
  smallBlind: Chips(1),
  bigBlind: Chips(2),
};

function makePlayers(count: number, chips = 100): ReturnType<typeof createPlayer>[] {
  return Array.from({ length: count }, (_, i) =>
    createPlayer(SeatIndex(i), Chips(chips)),
  );
}

/**
 * Drive a hand action and unwrap the Either, throwing on Left.
 */
function actOrThrow(state: HandState, seat: SeatIndex, action: typeof Fold): HandState {
  const result = act(state, seat, action);
  if (Either.isLeft(result)) {
    throw new Error(`act failed: ${JSON.stringify(result.left)}`);
  }
  return result.right;
}

/**
 * Have every active player perform the given action until the phase changes
 * or the hand completes. Returns the updated state.
 */
function playRoundWith(state: HandState, makeAction: () => typeof Check): HandState {
  let current = state;
  const startPhase = current.phase;
  while (!isComplete(current) && current.phase === startPhase) {
    const seat = activePlayer(current);
    if (seat === null) break;
    current = actOrThrow(current, seat, makeAction());
  }
  return current;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("startHand", () => {
  it("creates a hand in the Preflop phase", () => {
    const players = makePlayers(2);
    const state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);
    expect(state.phase).toBe("Preflop");
  });

  it("deals 2 hole cards to each player", () => {
    const players = makePlayers(3);
    const state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);
    for (const p of state.players) {
      expect(p.holeCards).not.toBeNull();
      expect(p.holeCards).toHaveLength(2);
    }
  });

  it("posts small and big blinds", () => {
    const players = makePlayers(3);
    const state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);

    // With 3 players and button at seat 0:
    //   SB = seat 1, BB = seat 2
    const sb = state.players.find((p) => (p.seatIndex as number) === 1)!;
    const bb = state.players.find((p) => (p.seatIndex as number) === 2)!;

    expect(sb.chips as number).toBe(99); // 100 - 1 SB
    expect(bb.chips as number).toBe(98); // 100 - 2 BB
    expect(sb.currentBet as number).toBe(1);
    expect(bb.currentBet as number).toBe(2);
  });

  it("posts correct blinds in heads-up (button = SB)", () => {
    const players = makePlayers(2);
    const state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);

    // Heads-up: button (seat 0) posts SB, seat 1 posts BB
    const btn = state.players.find((p) => (p.seatIndex as number) === 0)!;
    const other = state.players.find((p) => (p.seatIndex as number) === 1)!;

    expect(btn.currentBet as number).toBe(1);
    expect(other.currentBet as number).toBe(2);
  });

  it("has community cards empty at Preflop", () => {
    const players = makePlayers(2);
    const state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);
    expect(state.communityCards).toHaveLength(0);
  });

  it("emits HandStarted, BlindsPosted, and HoleCardsDealt events", () => {
    const players = makePlayers(2);
    const state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);

    const tags = state.events.map((e) => e._tag);
    expect(tags).toContain("HandStarted");
    expect(tags).toContain("BlindsPosted");
    expect(tags.filter((t) => t === "HoleCardsDealt")).toHaveLength(2);
  });
});

describe("Heads-up fold preflop", () => {
  it("button folds → other player wins, hand is complete", () => {
    const players = makePlayers(2);
    const state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);

    // Heads-up preflop: button/SB (seat 0) acts first
    const btnSeat = activePlayer(state);
    expect(btnSeat).not.toBeNull();
    expect(btnSeat as number).toBe(0);

    const after = actOrThrow(state, btnSeat!, Fold);

    expect(isComplete(after)).toBe(true);
    expect(after.phase).toBe("Complete");

    // Seat 1 (BB) wins the pot: SB(1) + BB(2) = 3 chips
    const winner = after.players.find((p) => (p.seatIndex as number) === 1)!;
    // Winner started at 98 (100 - 2 BB) then won pot of 3 → 101
    expect(winner.chips as number).toBe(101);

    // Seat 0 (SB who folded) lost the 1 SB
    const loser = after.players.find((p) => (p.seatIndex as number) === 0)!;
    expect(loser.chips as number).toBe(99);
  });
});

describe("3-player hand: everyone checks to showdown", () => {
  it("progresses through all phases and ends at Complete", () => {
    const players = makePlayers(3, 100);
    let state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);

    // Preflop: UTG (seat 0, first to act) calls, SB (seat 1) calls, BB (seat 2) checks
    expect(state.phase).toBe("Preflop");

    // UTG calls
    let seat = activePlayer(state)!;
    state = actOrThrow(state, seat, Call);

    // SB calls
    seat = activePlayer(state)!;
    state = actOrThrow(state, seat, Call);

    // BB checks
    seat = activePlayer(state)!;
    state = actOrThrow(state, seat, Check);

    // Should now be on the Flop
    expect(state.phase).toBe("Flop");
    expect(state.communityCards).toHaveLength(3);

    // Flop: everyone checks
    state = playRoundWith(state, () => Check);
    expect(state.phase).toBe("Turn");
    expect(state.communityCards).toHaveLength(4);

    // Turn: everyone checks
    state = playRoundWith(state, () => Check);
    expect(state.phase).toBe("River");
    expect(state.communityCards).toHaveLength(5);

    // River: everyone checks
    state = playRoundWith(state, () => Check);
    expect(isComplete(state)).toBe(true);
    expect(state.phase).toBe("Complete");
  });
});

describe("Phase progression", () => {
  it("follows Preflop → Flop → Turn → River → Showdown → Complete", () => {
    const players = makePlayers(2, 100);
    let state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);

    const phases: string[] = [state.phase];

    // Preflop: button calls, BB checks
    let seat = activePlayer(state)!;
    state = actOrThrow(state, seat, Call);
    seat = activePlayer(state)!;
    state = actOrThrow(state, seat, Check);
    phases.push(state.phase);

    // Flop: check check
    state = playRoundWith(state, () => Check);
    phases.push(state.phase);

    // Turn: check check
    state = playRoundWith(state, () => Check);
    phases.push(state.phase);

    // River: check check
    state = playRoundWith(state, () => Check);
    phases.push(state.phase);

    expect(phases).toEqual(["Preflop", "Flop", "Turn", "River", "Complete"]);

    // ShowdownStarted event should have been emitted
    const tags = getEvents(state).map((e) => e._tag);
    expect(tags).toContain("ShowdownStarted");
    expect(tags).toContain("HandEnded");
  });
});

describe("Community cards count", () => {
  it("0 after preflop, 3 after flop, 4 after turn, 5 after river", () => {
    const players = makePlayers(2, 100);
    let state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);

    // Preflop: 0 community cards
    expect(state.communityCards).toHaveLength(0);

    // Complete preflop: button calls, BB checks
    let seat = activePlayer(state)!;
    state = actOrThrow(state, seat, Call);
    seat = activePlayer(state)!;
    state = actOrThrow(state, seat, Check);

    // Flop: 3 community cards
    expect(state.communityCards).toHaveLength(3);

    // Complete flop
    state = playRoundWith(state, () => Check);

    // Turn: 4 community cards
    expect(state.communityCards).toHaveLength(4);

    // Complete turn
    state = playRoundWith(state, () => Check);

    // River: 5 community cards
    expect(state.communityCards).toHaveLength(5);
  });
});

describe("Events accumulation", () => {
  it("events accumulate correctly throughout hand", () => {
    const players = makePlayers(2, 100);
    let state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);

    const initialEventCount = state.events.length;
    expect(initialEventCount).toBeGreaterThan(0);

    // Each action adds at least 1 event (PlayerActed)
    let seat = activePlayer(state)!;
    state = actOrThrow(state, seat, Call);
    expect(state.events.length).toBeGreaterThan(initialEventCount);

    seat = activePlayer(state)!;
    state = actOrThrow(state, seat, Check);

    // After completing preflop, BettingRoundEnded and CommunityCardsDealt are added
    const tags = state.events.map((e) => e._tag);
    expect(tags).toContain("PlayerActed");
    expect(tags).toContain("BettingRoundEnded");
    expect(tags).toContain("CommunityCardsDealt");

    // Continue to showdown
    state = playRoundWith(state, () => Check); // flop
    state = playRoundWith(state, () => Check); // turn
    state = playRoundWith(state, () => Check); // river

    const finalTags = getEvents(state).map((e) => e._tag);
    expect(finalTags).toContain("HandStarted");
    expect(finalTags).toContain("BlindsPosted");
    expect(finalTags).toContain("ShowdownStarted");
    expect(finalTags).toContain("PotAwarded");
    expect(finalTags).toContain("HandEnded");

    // Events only grow, never shrink
    expect(getEvents(state).length).toBeGreaterThan(initialEventCount);
  });

  it("includes all PlayerActed events for every action taken", () => {
    const players = makePlayers(2, 100);
    let state = runStartHand(players, SeatIndex(0), DEFAULT_BLINDS);

    // Preflop: call + check = 2 actions
    let seat = activePlayer(state)!;
    state = actOrThrow(state, seat, Call);
    seat = activePlayer(state)!;
    state = actOrThrow(state, seat, Check);

    // Flop: check + check = 2 actions
    state = playRoundWith(state, () => Check);

    // Turn: check + check = 2 actions
    state = playRoundWith(state, () => Check);

    // River: check + check = 2 actions
    state = playRoundWith(state, () => Check);

    const playerActedCount = getEvents(state).filter(
      (e) => e._tag === "PlayerActed",
    ).length;

    // 8 total actions: 2 preflop + 2 flop + 2 turn + 2 river
    expect(playerActedCount).toBe(8);
  });
});
