/**
 * Typed error hierarchy for the Hold'em engine.
 *
 * Every error extends `Data.TaggedError` so that it is:
 *
 *  - structurally equal (via Effect's `Equal` trait),
 *  - yieldable inside Effect generators,
 *  - discriminated by `_tag` for exhaustive pattern matching.
 *
 * @module
 */

import { Data } from "effect";

import type { Chips, SeatIndex } from "./brand.js";

// ---------------------------------------------------------------------------
// Action / turn errors
// ---------------------------------------------------------------------------

/** The player attempted an action that is not valid in the current context. */
export class InvalidAction extends Data.TaggedError("InvalidAction")<{
  readonly action: string;
  readonly reason: string;
}> {}

/** An action was received from a player who is not the current actor. */
export class NotPlayersTurn extends Data.TaggedError("NotPlayersTurn")<{
  readonly seat: SeatIndex;
  readonly expectedSeat: SeatIndex;
}> {}

// ---------------------------------------------------------------------------
// Game-state errors
// ---------------------------------------------------------------------------

/** The engine reached a state that should be unreachable. */
export class InvalidGameState extends Data.TaggedError("InvalidGameState")<{
  readonly state: string;
  readonly reason: string;
}> {}

/** A player does not have enough chips to perform the requested action. */
export class InsufficientChips extends Data.TaggedError("InsufficientChips")<{
  readonly seat: SeatIndex;
  readonly required: Chips;
  readonly available: Chips;
}> {}

// ---------------------------------------------------------------------------
// Seating errors
// ---------------------------------------------------------------------------

/** A player tried to sit in a seat that is already taken. */
export class SeatOccupied extends Data.TaggedError("SeatOccupied")<{
  readonly seat: SeatIndex;
}> {}

/** An operation targeted an empty seat. */
export class SeatEmpty extends Data.TaggedError("SeatEmpty")<{
  readonly seat: SeatIndex;
}> {}

/** No seats are available at the table. */
export class TableFull extends Data.TaggedError("TableFull")<{}> {}

// ---------------------------------------------------------------------------
// Hand lifecycle errors
// ---------------------------------------------------------------------------

/** A hand cannot start because there are not enough players seated. */
export class NotEnoughPlayers extends Data.TaggedError("NotEnoughPlayers")<{
  readonly count: number;
  readonly minimum: number;
}> {}

/** An operation requires no hand to be active, but one is in progress. */
export class HandInProgress extends Data.TaggedError("HandInProgress")<{}> {}

/** An operation requires an active hand, but none is in progress. */
export class NoHandInProgress extends Data.TaggedError("NoHandInProgress")<{}> {}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

/**
 * Discriminated union of every error the poker engine can produce.
 *
 * Use the `_tag` field to narrow in `Match`, `Effect.catchTag`, or a plain
 * `switch` statement.
 */
export type PokerError =
  | InvalidAction
  | NotPlayersTurn
  | InvalidGameState
  | InsufficientChips
  | SeatOccupied
  | SeatEmpty
  | TableFull
  | NotEnoughPlayers
  | HandInProgress
  | NoHandInProgress;
