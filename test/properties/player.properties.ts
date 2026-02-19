import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Option } from "effect";
import { Chips, chipsToNumber, ZERO_CHIPS } from "../../src/brand.js";
import {
  placeBet,
  fold,
  winChips,
  clearHand,
  canAct,
  dealCards,
} from "../../src/player.js";
import { arbPlayer, arbChips, arbPositiveChips, arbCard } from "../arbitraries.js";

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("player -- property-based", () => {
  it("placeBet conservation: chips + currentBet stays constant", () => {
    fc.assert(
      fc.property(
        arbPlayer,
        arbPlayer.chain((p) =>
          fc.integer({ min: 0, max: chipsToNumber(p.chips) }).map((n) => Chips(n)),
        ),
        (player, betAmount) => {
          // Guard: betAmount must not exceed player chips
          if (chipsToNumber(betAmount) > chipsToNumber(player.chips)) return;

          const totalBefore =
            chipsToNumber(player.chips) + chipsToNumber(player.currentBet);

          const afterBet = placeBet(player, betAmount);

          const totalAfter =
            chipsToNumber(afterBet.chips) + chipsToNumber(afterBet.currentBet);

          expect(totalAfter).toBe(totalBefore);
        },
      ),
    );
  });

  it("fold is idempotent: fold(fold(p)) equals fold(p)", () => {
    fc.assert(
      fc.property(arbPlayer, (player) => {
        const foldedOnce = fold(player);
        const foldedTwice = fold(foldedOnce);

        expect(foldedTwice.isFolded).toBe(foldedOnce.isFolded);
        expect(chipsToNumber(foldedTwice.chips)).toBe(
          chipsToNumber(foldedOnce.chips),
        );
        expect(chipsToNumber(foldedTwice.currentBet)).toBe(
          chipsToNumber(foldedOnce.currentBet),
        );
        expect(foldedTwice.isAllIn).toBe(foldedOnce.isAllIn);
        expect(foldedTwice.seatIndex).toBe(foldedOnce.seatIndex);
        expect(Option.getEquivalence(
          (a: readonly [unknown, unknown], b: readonly [unknown, unknown]) =>
            a[0] === b[0] && a[1] === b[1],
        )(foldedTwice.holeCards, foldedOnce.holeCards)).toBe(true);
      }),
    );
  });

  it("winChips increases chips by exact amount", () => {
    fc.assert(
      fc.property(arbPlayer, arbChips, (player, amount) => {
        const chipsBefore = chipsToNumber(player.chips);
        const afterWin = winChips(player, amount);
        const chipsAfter = chipsToNumber(afterWin.chips);

        expect(chipsAfter).toBe(chipsBefore + chipsToNumber(amount));
      }),
    );
  });

  it("clearHand resets all transient state", () => {
    fc.assert(
      fc.property(
        arbPlayer,
        arbCard,
        arbCard,
        (player, card1, card2) => {
          // Put the player into a "dirty" state with cards, a bet, and fold
          let dirty = dealCards(player, [card1, card2]);
          // Bet the entire stack to trigger isAllIn
          dirty = placeBet(dirty, dirty.chips);
          dirty = fold(dirty);

          const cleared = clearHand(dirty);

          expect(chipsToNumber(cleared.currentBet)).toBe(0);
          expect(cleared.isAllIn).toBe(false);
          expect(cleared.isFolded).toBe(false);
          expect(Option.isNone(cleared.holeCards)).toBe(true);
          // chips should remain unchanged by clearHand
          expect(chipsToNumber(cleared.chips)).toBe(
            chipsToNumber(dirty.chips),
          );
          // seatIndex should remain unchanged
          expect(cleared.seatIndex).toBe(dirty.seatIndex);
        },
      ),
    );
  });

  it("canAct characterization: true iff not folded, not all-in, and chips > 0", () => {
    fc.assert(
      fc.property(
        arbPlayer,
        fc.boolean(),
        fc.boolean(),
        (player, shouldFold, shouldAllIn) => {
          let p = player;

          if (shouldFold) {
            p = fold(p);
          }

          if (shouldAllIn && !shouldFold) {
            // Bet entire stack to go all-in
            p = placeBet(p, p.chips);
          }

          const expected =
            !p.isFolded && !p.isAllIn && chipsToNumber(p.chips) > 0;

          expect(canAct(p)).toBe(expected);
        },
      ),
    );
  });
});
