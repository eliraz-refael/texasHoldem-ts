import { describe, it, expect } from "vitest";
import { HandId } from "../src/brand.js";

// Construction, ordering, and arithmetic tests are covered by brand.properties.ts.
// Only the HandId nominal brand test remains (not covered by properties).

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
