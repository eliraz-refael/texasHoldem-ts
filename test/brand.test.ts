import { describe, it, expect } from "vitest";
import { Chips, SeatIndex, HandId } from "../src/brand.js";

describe("Chips", () => {
  it("accepts 0", () => {
    expect(Chips(0)).toBe(0);
  });

  it("accepts positive integers", () => {
    expect(Chips(1)).toBe(1);
    expect(Chips(100)).toBe(100);
    expect(Chips(999999)).toBe(999999);
  });

  it("rejects negative numbers", () => {
    expect(() => Chips(-1)).toThrow();
    expect(() => Chips(-100)).toThrow();
  });

  it("rejects floats", () => {
    expect(() => Chips(1.5)).toThrow();
    expect(() => Chips(0.1)).toThrow();
    expect(() => Chips(99.99)).toThrow();
  });

  it("rejects NaN", () => {
    expect(() => Chips(NaN)).toThrow();
  });
});

describe("SeatIndex", () => {
  it("accepts 0 through 9", () => {
    for (let i = 0; i <= 9; i++) {
      expect(SeatIndex(i)).toBe(i);
    }
  });

  it("rejects 10", () => {
    expect(() => SeatIndex(10)).toThrow();
  });

  it("rejects -1", () => {
    expect(() => SeatIndex(-1)).toThrow();
  });

  it("rejects floats", () => {
    expect(() => SeatIndex(1.5)).toThrow();
    expect(() => SeatIndex(0.5)).toThrow();
  });
});

describe("HandId", () => {
  it("accepts any string (nominal brand)", () => {
    const id1 = HandId("h_abc123");
    expect(id1).toBe("h_abc123");

    const id2 = HandId("");
    expect(id2).toBe("");

    const id3 = HandId("some-arbitrary-string-!@#$");
    expect(id3).toBe("some-arbitrary-string-!@#$");
  });
});
