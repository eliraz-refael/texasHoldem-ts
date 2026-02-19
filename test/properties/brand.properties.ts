import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  Chips,
  SeatIndex,
  addChips,
  subtractChips,
  chipsToNumber,
  seatIndexToNumber,
  ChipsOrder,
  SeatIndexOrder,
} from "../../src/brand.js";
import { arbChips, arbSeatIndex } from "../arbitraries.js";

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("brand types -- property-based", () => {
  it("Chips construction succeeds iff non-negative integer", () => {
    fc.assert(
      fc.property(fc.double({ min: -1000, max: 100_000, noNaN: false }), (n) => {
        const isValid = Number.isInteger(n) && n >= 0;
        if (isValid) {
          expect(chipsToNumber(Chips(n))).toBe(n);
        } else {
          expect(() => Chips(n)).toThrow();
        }
      }),
    );
  });

  it("SeatIndex construction succeeds iff integer in [0, 9]", () => {
    fc.assert(
      fc.property(fc.double({ min: -10, max: 20, noNaN: false }), (n) => {
        const isValid = Number.isInteger(n) && n >= 0 && n <= 9;
        if (isValid) {
          expect(seatIndexToNumber(SeatIndex(n))).toBe(n);
        } else {
          expect(() => SeatIndex(n)).toThrow();
        }
      }),
    );
  });

  it("ChipsOrder is a total order (reflexive, transitive, antisymmetric)", () => {
    fc.assert(
      fc.property(arbChips, arbChips, arbChips, (a, b, c) => {
        // Reflexive: compare(a, a) === 0
        expect(ChipsOrder(a, a)).toBe(0);

        // Antisymmetric: if compare(a, b) <= 0 and compare(b, a) <= 0 then compare(a, b) === 0
        if (ChipsOrder(a, b) <= 0 && ChipsOrder(b, a) <= 0) {
          expect(ChipsOrder(a, b)).toBe(0);
        }

        // Transitive: if compare(a, b) <= 0 and compare(b, c) <= 0 then compare(a, c) <= 0
        if (ChipsOrder(a, b) <= 0 && ChipsOrder(b, c) <= 0) {
          expect(ChipsOrder(a, c)).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it("SeatIndexOrder is a total order (reflexive, transitive, antisymmetric)", () => {
    fc.assert(
      fc.property(arbSeatIndex, arbSeatIndex, arbSeatIndex, (a, b, c) => {
        // Reflexive
        expect(SeatIndexOrder(a, a)).toBe(0);

        // Antisymmetric
        if (SeatIndexOrder(a, b) <= 0 && SeatIndexOrder(b, a) <= 0) {
          expect(SeatIndexOrder(a, b)).toBe(0);
        }

        // Transitive
        if (SeatIndexOrder(a, b) <= 0 && SeatIndexOrder(b, c) <= 0) {
          expect(SeatIndexOrder(a, c)).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it("addChips is commutative: add(a, b) === add(b, a)", () => {
    fc.assert(
      fc.property(arbChips, arbChips, (a, b) => {
        expect(chipsToNumber(addChips(a, b))).toBe(
          chipsToNumber(addChips(b, a)),
        );
      }),
    );
  });

  it("subtractChips inverse: subtract(add(a, b), b) === a", () => {
    fc.assert(
      fc.property(arbChips, arbChips, (a, b) => {
        const sum = addChips(a, b);
        const result = subtractChips(sum, b);
        expect(chipsToNumber(result)).toBe(chipsToNumber(a));
      }),
    );
  });
});
