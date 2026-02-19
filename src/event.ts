/**
 * Game events for Texas Hold'em.
 *
 * Every state change in a hand is represented as an immutable `GameEvent`.
 * Events form a complete audit log that can be replayed to reconstruct any
 * point in the game.
 *
 * @module
 */

import type { Chips, SeatIndex, HandId } from "./brand.js";
import type { Card } from "./card.js";
import type { Action } from "./action.js";

// ---------------------------------------------------------------------------
// GameEvent — discriminated union
// ---------------------------------------------------------------------------

/**
 * Discriminated union of all events the poker engine can emit.
 *
 * Use the `_tag` field with `switch`, `Match.value`, or `Effect` pattern
 * matching to handle each case.
 */
export type GameEvent =
  | { readonly _tag: "HandStarted"; readonly handId: HandId; readonly button: SeatIndex; readonly players: readonly SeatIndex[] }
  | { readonly _tag: "BlindsPosted"; readonly smallBlind: { readonly seat: SeatIndex; readonly amount: Chips }; readonly bigBlind: { readonly seat: SeatIndex; readonly amount: Chips } }
  | { readonly _tag: "HoleCardsDealt"; readonly seat: SeatIndex }
  | { readonly _tag: "PlayerActed"; readonly seat: SeatIndex; readonly action: Action }
  | { readonly _tag: "BettingRoundEnded"; readonly round: string }
  | { readonly _tag: "CommunityCardsDealt"; readonly cards: readonly Card[]; readonly phase: string }
  | { readonly _tag: "ShowdownStarted" }
  | { readonly _tag: "PotAwarded"; readonly seat: SeatIndex; readonly amount: Chips; readonly potIndex: number }
  | { readonly _tag: "HandEnded" }
  | { readonly _tag: "PlayerSatDown"; readonly seat: SeatIndex; readonly chips: Chips }
  | { readonly _tag: "PlayerStoodUp"; readonly seat: SeatIndex };

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/** A new hand has begun. */
export const HandStarted = (
  handId: HandId,
  button: SeatIndex,
  players: readonly SeatIndex[],
): GameEvent => ({ _tag: "HandStarted", handId, button, players });

/** Small and big blinds have been posted. */
export const BlindsPosted = (
  smallBlind: { readonly seat: SeatIndex; readonly amount: Chips },
  bigBlind: { readonly seat: SeatIndex; readonly amount: Chips },
): GameEvent => ({ _tag: "BlindsPosted", smallBlind, bigBlind });

/**
 * Hole cards were dealt to a player.
 *
 * The actual card values are intentionally omitted from the event so that
 * event logs can be shared without leaking private information.
 */
export const HoleCardsDealt = (seat: SeatIndex): GameEvent => ({
  _tag: "HoleCardsDealt",
  seat,
});

/** A player performed an action. */
export const PlayerActed = (seat: SeatIndex, action: Action): GameEvent => ({
  _tag: "PlayerActed",
  seat,
  action,
});

/** A betting round has completed. */
export const BettingRoundEnded = (round: string): GameEvent => ({
  _tag: "BettingRoundEnded",
  round,
});

/**
 * Community cards were dealt.
 *
 * @param cards - the new community cards added in this phase.
 * @param phase - e.g. `"Flop"`, `"Turn"`, or `"River"`.
 */
export const CommunityCardsDealt = (
  cards: readonly Card[],
  phase: string,
): GameEvent => ({ _tag: "CommunityCardsDealt", cards, phase });

/** Showdown has begun. */
export const ShowdownStarted: GameEvent = { _tag: "ShowdownStarted" };

/** A pot (or side-pot) was awarded to a player. */
export const PotAwarded = (
  seat: SeatIndex,
  amount: Chips,
  potIndex: number,
): GameEvent => ({ _tag: "PotAwarded", seat, amount, potIndex });

/** The hand has ended (all pots distributed, ready for next hand). */
export const HandEnded: GameEvent = { _tag: "HandEnded" };

/** A player has joined the table and taken a seat. */
export const PlayerSatDown = (seat: SeatIndex, chips: Chips): GameEvent => ({
  _tag: "PlayerSatDown",
  seat,
  chips,
});

/** A player has left the table. */
export const PlayerStoodUp = (seat: SeatIndex): GameEvent => ({
  _tag: "PlayerStoodUp",
  seat,
});
