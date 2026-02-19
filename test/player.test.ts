import { describe, it, expect } from "vitest";
import {
  createPlayer,
  placeBet,
  fold,
  winChips,
  collectBet,
  dealCards,
  clearHand,
  canAct,
} from "../src/player.js";
import { Chips, SeatIndex } from "../src/brand.js";
import { cardFromString } from "../src/card.js";

describe("createPlayer", () => {
  it("creates a player with correct defaults", () => {
    const player = createPlayer(SeatIndex(3), Chips(1000));

    expect(player.seatIndex).toBe(3);
    expect(player.chips).toBe(1000);
    expect(player.currentBet).toBe(0);
    expect(player.isAllIn).toBe(false);
    expect(player.isFolded).toBe(false);
    expect(player.holeCards).toBeNull();
  });
});

describe("placeBet", () => {
  it("reduces chips and increases currentBet", () => {
    const player = createPlayer(SeatIndex(0), Chips(1000));
    const afterBet = placeBet(player, Chips(200));

    expect(afterBet.chips).toBe(800);
    expect(afterBet.currentBet).toBe(200);
    expect(afterBet.isAllIn).toBe(false);
  });

  it("detects all-in when chips reach zero", () => {
    const player = createPlayer(SeatIndex(0), Chips(500));
    const afterBet = placeBet(player, Chips(500));

    expect(afterBet.chips).toBe(0);
    expect(afterBet.currentBet).toBe(500);
    expect(afterBet.isAllIn).toBe(true);
  });

  it("accumulates bets correctly", () => {
    const player = createPlayer(SeatIndex(0), Chips(1000));
    const bet1 = placeBet(player, Chips(100));
    const bet2 = placeBet(bet1, Chips(200));

    expect(bet2.chips).toBe(700);
    expect(bet2.currentBet).toBe(300);
  });
});

describe("fold", () => {
  it("sets isFolded to true", () => {
    const player = createPlayer(SeatIndex(0), Chips(1000));
    const folded = fold(player);

    expect(folded.isFolded).toBe(true);
    // other state unchanged
    expect(folded.chips).toBe(1000);
    expect(folded.seatIndex).toBe(0);
  });
});

describe("winChips", () => {
  it("increases chips", () => {
    const player = createPlayer(SeatIndex(0), Chips(1000));
    const winner = winChips(player, Chips(500));

    expect(winner.chips).toBe(1500);
  });
});

describe("collectBet", () => {
  it("resets currentBet to 0", () => {
    const player = createPlayer(SeatIndex(0), Chips(1000));
    const afterBet = placeBet(player, Chips(300));
    expect(afterBet.currentBet).toBe(300);

    const collected = collectBet(afterBet);
    expect(collected.currentBet).toBe(0);
    // chips remain reduced (bet already placed)
    expect(collected.chips).toBe(700);
  });
});

describe("dealCards", () => {
  it("sets holeCards", () => {
    const player = createPlayer(SeatIndex(0), Chips(1000));
    const c1 = cardFromString("As");
    const c2 = cardFromString("Kh");
    const dealt = dealCards(player, [c1, c2]);

    expect(dealt.holeCards).toEqual([c1, c2]);
  });
});

describe("clearHand", () => {
  it("resets all hand state", () => {
    let player = createPlayer(SeatIndex(0), Chips(1000));
    const c1 = cardFromString("As");
    const c2 = cardFromString("Kh");
    player = dealCards(player, [c1, c2]);
    player = placeBet(player, Chips(1000)); // all-in

    expect(player.isAllIn).toBe(true);
    expect(player.holeCards).not.toBeNull();
    expect(player.currentBet).toBe(1000);

    const cleared = clearHand(player);
    expect(cleared.currentBet).toBe(0);
    expect(cleared.isAllIn).toBe(false);
    expect(cleared.isFolded).toBe(false);
    expect(cleared.holeCards).toBeNull();
    // chips remain at 0 (all-in)
    expect(cleared.chips).toBe(0);
  });
});

describe("canAct", () => {
  it("returns true for a fresh player with chips", () => {
    const player = createPlayer(SeatIndex(0), Chips(1000));
    expect(canAct(player)).toBe(true);
  });

  it("returns false when player is folded", () => {
    const player = fold(createPlayer(SeatIndex(0), Chips(1000)));
    expect(canAct(player)).toBe(false);
  });

  it("returns false when player is all-in", () => {
    const player = placeBet(
      createPlayer(SeatIndex(0), Chips(500)),
      Chips(500),
    );
    expect(player.isAllIn).toBe(true);
    expect(canAct(player)).toBe(false);
  });

  it("returns false when player has zero chips", () => {
    const player = createPlayer(SeatIndex(0), Chips(0));
    expect(canAct(player)).toBe(false);
  });
});
