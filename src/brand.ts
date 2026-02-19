/**
 * Branded domain types for the Hold'em engine.
 *
 * Uses Effect's Brand module for compile-time type safety with optional
 * runtime validation, and Schema for encoding/decoding and fast-check
 * property-based testing integration.
 *
 * @module
 */

import { Brand, Schema } from "effect";

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

/**
 * A non-negative integer representing a chip count.
 *
 * Branded at the type level so that raw `number` values cannot be accidentally
 * passed where a validated chip amount is expected.
 */
export type Chips = number & Brand.Brand<"Chips">;

/**
 * Runtime constructor for {@link Chips}.
 *
 * Throws a `BrandError` when the supplied value is not a non-negative integer.
 *
 * @example
 * ```ts
 * const pot = Chips(500);  // ok
 * Chips(-1);               // throws
 * Chips(1.5);              // throws
 * ```
 */
export const Chips = Brand.refined<Chips>(
  (n) => Number.isInteger(n) && n >= 0,
  (n) => Brand.error(`Expected ${n} to be a non-negative integer`),
);

/**
 * Schema for {@link Chips} — a `Schema.Number` filtered to non-negative
 * integers and branded.  Useful with `@effect/schema` encode/decode pipelines
 * and `fast-check` Arbitrary generation via `Schema.Arbitrary`.
 */
export const ChipsSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
  Schema.fromBrand(Chips),
);

// ---------------------------------------------------------------------------
// SeatIndex
// ---------------------------------------------------------------------------

/** Maximum valid seat index (inclusive). */
const MAX_SEAT = 9;

/**
 * A seat index in the range `[0, 9]`.
 *
 * Branded so that arbitrary numbers cannot be used as seat references without
 * validation.
 */
export type SeatIndex = number & Brand.Brand<"SeatIndex">;

/**
 * Runtime constructor for {@link SeatIndex}.
 *
 * Throws a `BrandError` when the supplied value is not an integer in `[0, 9]`.
 *
 * @example
 * ```ts
 * const btn = SeatIndex(0);  // ok
 * SeatIndex(10);             // throws
 * SeatIndex(1.5);            // throws
 * ```
 */
export const SeatIndex = Brand.refined<SeatIndex>(
  (n) => Number.isInteger(n) && n >= 0 && n <= MAX_SEAT,
  (n) => Brand.error(`Expected ${n} to be an integer in [0, ${MAX_SEAT}]`),
);

/**
 * Schema for {@link SeatIndex} — a `Schema.Number` filtered to integers in
 * `[0, 9]` and branded.
 */
export const SeatIndexSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.between(0, MAX_SEAT),
  Schema.fromBrand(SeatIndex),
);

// ---------------------------------------------------------------------------
// HandId
// ---------------------------------------------------------------------------

/**
 * A unique identifier for a single hand of poker.
 *
 * Nominal brand only — no runtime validation is performed because any string
 * is a valid hand id.  The brand exists solely to prevent accidental mix-ups
 * with other `string` values.
 */
export type HandId = string & Brand.Brand<"HandId">;

/**
 * Constructor for {@link HandId}.
 *
 * No runtime checks are applied; the value is returned as-is with the brand
 * attached at the type level.
 *
 * @example
 * ```ts
 * const id = HandId("h_abc123");
 * ```
 */
export const HandId = Brand.nominal<HandId>();

/**
 * Schema for {@link HandId} — a `Schema.String` branded as `"HandId"`.
 * Suitable for serialisation boundaries and property-based testing.
 */
export const HandIdSchema = Schema.String.pipe(Schema.fromBrand(HandId));
