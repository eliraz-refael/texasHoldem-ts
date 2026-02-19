import { describe, it, expect } from "vitest";
import { Either } from "effect";
import { Chips, SeatIndex } from "../src/brand.js";
import {
  computeLegalActions,
  validateAction,
  Fold,
  Check,
  Call,
  Bet,
  Raise,
  AllIn,
} from "../src/action.js";

// ---------------------------------------------------------------------------
// computeLegalActions
// ---------------------------------------------------------------------------

describe("computeLegalActions", () => {
  it("no bet yet (biggestBet=0): canCheck=true, canBet with minBet=bigBlind, no call, no raise", () => {
    const legal = computeLegalActions(
      Chips(1000), // playerChips
      Chips(0),    // playerCurrentBet
      Chips(0),    // biggestBet
      Chips(20),   // minRaiseIncrement (big blind)
      false,       // hasBetThisRound
    );

    expect(legal.canFold).toBe(true);
    expect(legal.canCheck).toBe(true);
    expect(legal.callAmount).toBeNull();
    expect(legal.minBet).toBe(20);
    expect(legal.maxBet).toBe(1000);
    expect(legal.minRaise).toBeNull();
    expect(legal.maxRaise).toBeNull();
    expect(legal.canAllIn).toBe(true);
    expect(legal.allInAmount).toBe(1000);
  });

  it("facing a bet: canCheck=false, callAmount correct, canRaise", () => {
    const legal = computeLegalActions(
      Chips(1000), // playerChips
      Chips(0),    // playerCurrentBet
      Chips(50),   // biggestBet
      Chips(50),   // minRaiseIncrement
      true,        // hasBetThisRound
    );

    expect(legal.canCheck).toBe(false);
    expect(legal.callAmount).toBe(50);
    expect(legal.minBet).toBeNull();
    expect(legal.maxBet).toBeNull();
    expect(legal.minRaise).toBe(100); // biggestBet + minRaiseIncrement = 50 + 50
    expect(legal.maxRaise).toBe(1000); // playerChips + playerCurrentBet = 1000 + 0
    expect(legal.canAllIn).toBe(true);
  });

  it("player has less chips than call: can't call, can only allIn", () => {
    const legal = computeLegalActions(
      Chips(30),  // playerChips (less than the 50 call gap)
      Chips(0),   // playerCurrentBet
      Chips(50),  // biggestBet
      Chips(50),  // minRaiseIncrement
      true,       // hasBetThisRound
    );

    expect(legal.canCheck).toBe(false);
    expect(legal.callAmount).toBeNull(); // can't call: chips < callGap
    expect(legal.minRaise).toBeNull();   // can't raise: maxRaiseTo(30) < minRaiseTo(100)
    expect(legal.maxRaise).toBeNull();
    expect(legal.canAllIn).toBe(true);
    expect(legal.allInAmount).toBe(30);
  });

  it("already bet in round: can raise but not bet", () => {
    const legal = computeLegalActions(
      Chips(500),  // playerChips
      Chips(50),   // playerCurrentBet (already put in 50)
      Chips(100),  // biggestBet (someone raised to 100)
      Chips(50),   // minRaiseIncrement
      true,        // hasBetThisRound
    );

    // Cannot bet (hasBetThisRound is true)
    expect(legal.minBet).toBeNull();
    expect(legal.maxBet).toBeNull();

    // Can call: callGap = 100 - 50 = 50, playerChips(500) >= 50
    expect(legal.callAmount).toBe(50);

    // Can raise: minRaiseTo = 100 + 50 = 150, maxRaiseTo = 500 + 50 = 550
    expect(legal.minRaise).toBe(150);
    expect(legal.maxRaise).toBe(550);
  });

  it("player with zero chips cannot allIn but can still fold", () => {
    const legal = computeLegalActions(
      Chips(0),   // playerChips
      Chips(0),   // playerCurrentBet
      Chips(0),   // biggestBet
      Chips(20),  // minRaiseIncrement
      false,      // hasBetThisRound
    );

    expect(legal.canFold).toBe(true);
    expect(legal.canAllIn).toBe(false);
    expect(legal.allInAmount).toBe(0);
    expect(legal.minBet).toBeNull();
    expect(legal.maxBet).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateAction
// ---------------------------------------------------------------------------

describe("validateAction", () => {
  // Helper to build a legal-actions object from computeLegalActions for common scenarios.
  const nobet = () =>
    computeLegalActions(Chips(1000), Chips(0), Chips(0), Chips(20), false);
  const facingBet = () =>
    computeLegalActions(Chips(1000), Chips(0), Chips(50), Chips(50), true);

  it("valid Fold returns Either.right", () => {
    const result = validateAction(Fold, nobet());
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right._tag).toBe("Fold");
    }
  });

  it("valid Check returns Either.right when no outstanding bet", () => {
    const result = validateAction(Check, nobet());
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right._tag).toBe("Check");
    }
  });

  it("valid Call returns Either.right when facing a bet", () => {
    const result = validateAction(Call, facingBet());
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right._tag).toBe("Call");
    }
  });

  it("valid Bet returns Either.right when amount is within range", () => {
    const legal = nobet();
    const result = validateAction(Bet(Chips(100)), legal);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right._tag).toBe("Bet");
    }
  });

  it("valid Raise returns Either.right when amount is within range", () => {
    const legal = facingBet();
    const result = validateAction(Raise(Chips(100)), legal);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right._tag).toBe("Raise");
    }
  });

  it("valid AllIn returns Either.right when player has chips", () => {
    const result = validateAction(AllIn, nobet());
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right._tag).toBe("AllIn");
    }
  });

  it("invalid Check when there is an outstanding bet returns Either.left", () => {
    const result = validateAction(Check, facingBet());
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("InvalidAction");
      expect(result.left.action).toBe("Check");
    }
  });

  it("Bet below minimum returns Either.left", () => {
    const legal = nobet(); // minBet = 20
    const result = validateAction(Bet(Chips(5)), legal);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("InvalidAction");
      expect(result.left.action).toBe("Bet");
      expect(result.left.reason).toContain("below the minimum");
    }
  });

  it("Bet above maximum returns Either.left", () => {
    const legal = nobet(); // maxBet = 1000
    const result = validateAction(Bet(Chips(2000)), legal);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("InvalidAction");
      expect(result.left.action).toBe("Bet");
      expect(result.left.reason).toContain("exceeds the maximum");
    }
  });

  it("Raise above maximum returns Either.left", () => {
    const legal = facingBet(); // maxRaise = 1000
    const result = validateAction(Raise(Chips(2000)), legal);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("InvalidAction");
      expect(result.left.action).toBe("Raise");
      expect(result.left.reason).toContain("exceeds the maximum");
    }
  });

  it("Raise below minimum returns Either.left", () => {
    const legal = facingBet(); // minRaise = 100
    const result = validateAction(Raise(Chips(60)), legal);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("InvalidAction");
      expect(result.left.action).toBe("Raise");
      expect(result.left.reason).toContain("below the minimum");
    }
  });

  it("Bet when a bet has already been made returns Either.left", () => {
    const legal = facingBet(); // hasBetThisRound=true, so minBet=null
    const result = validateAction(Bet(Chips(100)), legal);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("InvalidAction");
      expect(result.left.action).toBe("Bet");
    }
  });

  it("Raise when no bet has been made returns Either.left", () => {
    const legal = nobet(); // hasBetThisRound=false, so minRaise=null
    const result = validateAction(Raise(Chips(100)), legal);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("InvalidAction");
      expect(result.left.action).toBe("Raise");
    }
  });

  it("Call when no bet to match returns Either.left", () => {
    const legal = nobet(); // callAmount=null
    const result = validateAction(Call, legal);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("InvalidAction");
      expect(result.left.action).toBe("Call");
    }
  });
});
