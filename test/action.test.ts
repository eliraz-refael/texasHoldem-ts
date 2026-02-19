import { describe, it, expect } from "vitest";
import { Option } from "effect";
import { Chips } from "../src/brand.js";
import { computeLegalActions } from "../src/action.js";

// Generic validation tests (valid/invalid actions within/outside legal ranges)
// are covered by action.properties.ts. Only representative scenarios showing
// specific computed legal-action values remain.

describe("computeLegalActions — representative scenarios", () => {
  it("no bet yet (biggestBet=0): canCheck=true, canBet with minBet=bigBlind, no call, no raise", () => {
    const legal = computeLegalActions(
      Chips(1000),
      Chips(0),
      Chips(0),
      Chips(20),
      false,
    );

    expect(legal.canFold).toBe(true);
    expect(legal.canCheck).toBe(true);
    expect(Option.isNone(legal.callAmount)).toBe(true);
    expect(Option.isSome(legal.minBet)).toBe(true);
    if (Option.isSome(legal.minBet)) expect(legal.minBet.value).toBe(20);
    expect(Option.isSome(legal.maxBet)).toBe(true);
    if (Option.isSome(legal.maxBet)) expect(legal.maxBet.value).toBe(1000);
    expect(Option.isNone(legal.minRaise)).toBe(true);
    expect(Option.isNone(legal.maxRaise)).toBe(true);
    expect(legal.canAllIn).toBe(true);
    expect(legal.allInAmount).toBe(1000);
  });

  it("facing a bet: canCheck=false, callAmount correct, canRaise", () => {
    const legal = computeLegalActions(
      Chips(1000),
      Chips(0),
      Chips(50),
      Chips(50),
      true,
    );

    expect(legal.canCheck).toBe(false);
    expect(Option.isSome(legal.callAmount)).toBe(true);
    if (Option.isSome(legal.callAmount)) expect(legal.callAmount.value).toBe(50);
    expect(Option.isNone(legal.minBet)).toBe(true);
    expect(Option.isNone(legal.maxBet)).toBe(true);
    expect(Option.isSome(legal.minRaise)).toBe(true);
    if (Option.isSome(legal.minRaise)) expect(legal.minRaise.value).toBe(100);
    expect(Option.isSome(legal.maxRaise)).toBe(true);
    if (Option.isSome(legal.maxRaise)) expect(legal.maxRaise.value).toBe(1000);
    expect(legal.canAllIn).toBe(true);
  });

  it("player has less chips than call: can't call, can only allIn", () => {
    const legal = computeLegalActions(
      Chips(30),
      Chips(0),
      Chips(50),
      Chips(50),
      true,
    );

    expect(legal.canCheck).toBe(false);
    expect(Option.isNone(legal.callAmount)).toBe(true);
    expect(Option.isNone(legal.minRaise)).toBe(true);
    expect(Option.isNone(legal.maxRaise)).toBe(true);
    expect(legal.canAllIn).toBe(true);
    expect(legal.allInAmount).toBe(30);
  });

  it("player with zero chips cannot allIn but can still fold", () => {
    const legal = computeLegalActions(
      Chips(0),
      Chips(0),
      Chips(0),
      Chips(20),
      false,
    );

    expect(legal.canFold).toBe(true);
    expect(legal.canAllIn).toBe(false);
    expect(legal.allInAmount).toBe(0);
    expect(Option.isNone(legal.minBet)).toBe(true);
    expect(Option.isNone(legal.maxBet)).toBe(true);
  });
});
