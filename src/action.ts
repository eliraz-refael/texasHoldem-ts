/**
 * Player actions and validation for Texas Hold'em.
 *
 * Provides an `Action` discriminated union, a `LegalActions` descriptor for
 * what the current player may do, a function to compute legal actions from
 * game state, and a pure validator that checks a chosen action against the
 * legal set.
 *
 * @module
 */

import { Either } from "effect";
import type { Chips, SeatIndex } from "./brand.js";
import { Chips as makeChips } from "./brand.js";
import { InvalidAction } from "./error.js";

// ---------------------------------------------------------------------------
// Action — discriminated union
// ---------------------------------------------------------------------------

/**
 * A player action at the poker table.
 *
 * - `Fold`  — give up the hand.
 * - `Check` — pass when no bet is owed.
 * - `Call`  — match the current biggest bet.
 * - `Bet`   — open betting (when no voluntary bet has been made).
 * - `Raise` — increase the current bet. `amount` is the *total* raise-to amount,
 *             not the raise-by increment.
 * - `AllIn` — push all remaining chips into the pot.
 */
export type Action =
  | { readonly _tag: "Fold" }
  | { readonly _tag: "Check" }
  | { readonly _tag: "Call" }
  | { readonly _tag: "Bet"; readonly amount: Chips }
  | { readonly _tag: "Raise"; readonly amount: Chips }
  | { readonly _tag: "AllIn" };

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/** Fold action (singleton). */
export const Fold: Action = { _tag: "Fold" };

/** Check action (singleton). */
export const Check: Action = { _tag: "Check" };

/** Call action (singleton). */
export const Call: Action = { _tag: "Call" };

/** Construct a Bet action with the given chip amount. */
export const Bet = (amount: Chips): Action => ({ _tag: "Bet", amount });

/**
 * Construct a Raise action.
 *
 * @param amount — the *total* amount the player's bet will be raised TO
 *   (not the incremental raise-by amount).
 */
export const Raise = (amount: Chips): Action => ({ _tag: "Raise", amount });

/** All-in action (singleton). */
export const AllIn: Action = { _tag: "AllIn" };

// ---------------------------------------------------------------------------
// LegalActions
// ---------------------------------------------------------------------------

/**
 * Describes what the active player is allowed to do in the current betting
 * context.
 */
export interface LegalActions {
  /** Whether the player can fold (always true when it is their turn). */
  readonly canFold: boolean;
  /** Whether the player can check (no outstanding bet to match). */
  readonly canCheck: boolean;
  /** Chips needed to call, or `null` if calling is not available. */
  readonly callAmount: Chips | null;
  /** Minimum opening bet, or `null` if betting is not available. */
  readonly minBet: Chips | null;
  /** Maximum opening bet, or `null` if betting is not available. */
  readonly maxBet: Chips | null;
  /** Minimum raise-to amount, or `null` if raising is not available. */
  readonly minRaise: Chips | null;
  /** Maximum raise-to amount, or `null` if raising is not available. */
  readonly maxRaise: Chips | null;
  /** Whether the player can go all-in. */
  readonly canAllIn: boolean;
  /** The chip total going all-in would commit. */
  readonly allInAmount: Chips;
}

// ---------------------------------------------------------------------------
// computeLegalActions
// ---------------------------------------------------------------------------

/**
 * Derive the full set of legal actions available to the active player.
 *
 * @param playerChips      - chips remaining in the player's stack (excluding
 *                           any amount already committed this round).
 * @param playerCurrentBet - how many chips the player has already put in this
 *                           betting round.
 * @param biggestBet       - the largest total bet any player has made in this
 *                           round.
 * @param minRaiseIncrement - the minimum raise increment (usually the big
 *                           blind, or the size of the last raise).
 * @param hasBetThisRound  - whether a voluntary bet or raise has already been
 *                           made in this betting round. When `false` the
 *                           player may *bet*; when `true` they may *raise*.
 */
export function computeLegalActions(
  playerChips: Chips,
  playerCurrentBet: Chips,
  biggestBet: Chips,
  minRaiseIncrement: Chips,
  hasBetThisRound: boolean,
): LegalActions {
  // -- fold: always available -------------------------------------------------
  const canFold = true;

  // -- check: available when no outstanding amount to match -------------------
  const canCheck = playerCurrentBet >= biggestBet;

  // -- call -------------------------------------------------------------------
  const callGap = biggestBet - playerCurrentBet;
  const canCall = callGap > 0 && playerChips >= callGap;
  const callAmount: Chips | null = canCall ? makeChips(callGap) : null;

  // -- bet (opening bet, only when no voluntary bet yet) ----------------------
  let minBet: Chips | null = null;
  let maxBet: Chips | null = null;
  if (!hasBetThisRound) {
    // Min bet is the min raise increment (typically big blind).
    // Player must have at least that many chips to open.
    if (playerChips >= minRaiseIncrement) {
      minBet = makeChips(minRaiseIncrement);
      maxBet = makeChips(playerChips);
    }
  }

  // -- raise (only when a voluntary bet is already in play) -------------------
  let minRaise: Chips | null = null;
  let maxRaise: Chips | null = null;
  if (hasBetThisRound) {
    // Minimum raise-to = biggest bet + min raise increment.
    const minRaiseTo = biggestBet + minRaiseIncrement;
    // Maximum raise-to = player's full stack expressed as a total bet.
    const maxRaiseTo = playerChips + playerCurrentBet;

    // Player must have enough chips to at least meet the minimum raise.
    if (maxRaiseTo >= minRaiseTo) {
      minRaise = makeChips(minRaiseTo);
      maxRaise = makeChips(maxRaiseTo);
    }
  }

  // -- all-in: always available when the player has chips ---------------------
  const canAllIn = playerChips > 0;
  const allInAmount = makeChips(playerChips);

  return {
    canFold,
    canCheck,
    callAmount,
    minBet,
    maxBet,
    minRaise,
    maxRaise,
    canAllIn,
    allInAmount,
  };
}

// ---------------------------------------------------------------------------
// validateAction
// ---------------------------------------------------------------------------

/**
 * Validate a player's chosen action against the set of legal actions.
 *
 * Returns `Either.right(action)` when the action is legal, or
 * `Either.left(InvalidAction)` with a human-readable reason when it is not.
 *
 * Note: In Effect-TS v3 `Either<R, L>` has the *success* type first, so
 * `Either.right` carries the success and `Either.left` carries the error.
 */
export function validateAction(
  action: Action,
  legal: LegalActions,
): Either.Either<Action, InvalidAction> {
  switch (action._tag) {
    case "Fold":
      return legal.canFold
        ? Either.right(action)
        : Either.left(
            new InvalidAction({ action: "Fold", reason: "Cannot fold right now" }),
          );

    case "Check":
      return legal.canCheck
        ? Either.right(action)
        : Either.left(
            new InvalidAction({
              action: "Check",
              reason: "Cannot check — there is an outstanding bet to match",
            }),
          );

    case "Call":
      return legal.callAmount !== null
        ? Either.right(action)
        : Either.left(
            new InvalidAction({
              action: "Call",
              reason: "Cannot call — no outstanding bet, or insufficient chips (must all-in instead)",
            }),
          );

    case "Bet":
      if (legal.minBet === null || legal.maxBet === null) {
        return Either.left(
          new InvalidAction({
            action: "Bet",
            reason: "Cannot bet — a bet or raise has already been made this round",
          }),
        );
      }
      if (action.amount < legal.minBet) {
        return Either.left(
          new InvalidAction({
            action: "Bet",
            reason: `Bet of ${action.amount} is below the minimum of ${legal.minBet}`,
          }),
        );
      }
      if (action.amount > legal.maxBet) {
        return Either.left(
          new InvalidAction({
            action: "Bet",
            reason: `Bet of ${action.amount} exceeds the maximum of ${legal.maxBet}`,
          }),
        );
      }
      return Either.right(action);

    case "Raise":
      if (legal.minRaise === null || legal.maxRaise === null) {
        return Either.left(
          new InvalidAction({
            action: "Raise",
            reason: "Cannot raise — no bet has been made to raise, or insufficient chips",
          }),
        );
      }
      if (action.amount < legal.minRaise) {
        return Either.left(
          new InvalidAction({
            action: "Raise",
            reason: `Raise to ${action.amount} is below the minimum of ${legal.minRaise}`,
          }),
        );
      }
      if (action.amount > legal.maxRaise) {
        return Either.left(
          new InvalidAction({
            action: "Raise",
            reason: `Raise to ${action.amount} exceeds the maximum of ${legal.maxRaise}`,
          }),
        );
      }
      return Either.right(action);

    case "AllIn":
      return legal.canAllIn
        ? Either.right(action)
        : Either.left(
            new InvalidAction({
              action: "AllIn",
              reason: "Cannot go all-in with zero chips",
            }),
          );
  }
}
