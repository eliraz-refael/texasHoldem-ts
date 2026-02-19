import { describe, it, expect } from "vitest";
import { Option } from "effect";
import { createPlayer } from "../src/player.js";
import { Chips, SeatIndex, chipsToNumber } from "../src/brand.js";

// placeBet, fold, winChips, collectBet, dealCards, clearHand, and canAct
// are thoroughly covered by player.properties.ts.
// Only the createPlayer defaults sanity check remains.

describe("createPlayer", () => {
  it("creates a player with correct defaults", () => {
    const player = createPlayer(SeatIndex(3), Chips(1000));

    expect(player.seatIndex).toBe(3);
    expect(chipsToNumber(player.chips)).toBe(1000);
    expect(chipsToNumber(player.currentBet)).toBe(0);
    expect(player.isAllIn).toBe(false);
    expect(player.isFolded).toBe(false);
    expect(Option.isNone(player.holeCards)).toBe(true);
  });
});
