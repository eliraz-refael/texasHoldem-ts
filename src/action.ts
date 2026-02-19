/**
 * Player actions and validation for Texas Hold'em.
 *
 * @module
 */

import { Data, Either, Match, Option, pipe } from "effect";
import type { Chips } from "./brand.js";
import { Chips as makeChips, chipsToNumber } from "./brand.js";
import { InvalidAction } from "./error.js";

// ---------------------------------------------------------------------------
// Action — Data.TaggedEnum (type-level) + Data.tagged (constructors)
// ---------------------------------------------------------------------------

export type Action = Data.TaggedEnum<{
  Fold: {};
  Check: {};
  Call: {};
  Bet: { readonly amount: Chips };
  Raise: { readonly amount: Chips };
  AllIn: {};
}>;

// ---------------------------------------------------------------------------
// Convenience constructors
// ---------------------------------------------------------------------------

export const Fold = Data.tagged<Extract<Action, { _tag: "Fold" }>>("Fold")();
export const Check = Data.tagged<Extract<Action, { _tag: "Check" }>>("Check")();
export const Call = Data.tagged<Extract<Action, { _tag: "Call" }>>("Call")();
export const Bet = Data.tagged<Extract<Action, { _tag: "Bet" }>>("Bet");
export const Raise = Data.tagged<Extract<Action, { _tag: "Raise" }>>("Raise");
export const AllIn = Data.tagged<Extract<Action, { _tag: "AllIn" }>>("AllIn")();

// ---------------------------------------------------------------------------
// LegalActions
// ---------------------------------------------------------------------------

export interface LegalActions {
  readonly canFold: boolean;
  readonly canCheck: boolean;
  readonly callAmount: Option.Option<Chips>;
  readonly minBet: Option.Option<Chips>;
  readonly maxBet: Option.Option<Chips>;
  readonly minRaise: Option.Option<Chips>;
  readonly maxRaise: Option.Option<Chips>;
  readonly canAllIn: boolean;
  readonly allInAmount: Chips;
}

// ---------------------------------------------------------------------------
// computeLegalActions
// ---------------------------------------------------------------------------

export function computeLegalActions(
  playerChips: Chips,
  playerCurrentBet: Chips,
  biggestBet: Chips,
  minRaiseIncrement: Chips,
  hasBetThisRound: boolean,
): LegalActions {
  const canFold = true;
  const canCheck = playerCurrentBet >= biggestBet;

  const callGap = chipsToNumber(biggestBet) - chipsToNumber(playerCurrentBet);
  const canCall = callGap > 0 && chipsToNumber(playerChips) >= callGap;
  const callAmount: Option.Option<Chips> = canCall
    ? Option.some(makeChips(callGap))
    : Option.none();

  let minBet: Option.Option<Chips> = Option.none();
  let maxBet: Option.Option<Chips> = Option.none();
  if (!hasBetThisRound) {
    if (chipsToNumber(playerChips) >= chipsToNumber(minRaiseIncrement)) {
      minBet = Option.some(minRaiseIncrement);
      maxBet = Option.some(playerChips);
    }
  }

  let minRaise: Option.Option<Chips> = Option.none();
  let maxRaise: Option.Option<Chips> = Option.none();
  if (hasBetThisRound) {
    const minRaiseTo = chipsToNumber(biggestBet) + chipsToNumber(minRaiseIncrement);
    const maxRaiseTo = chipsToNumber(playerChips) + chipsToNumber(playerCurrentBet);
    if (maxRaiseTo >= minRaiseTo) {
      minRaise = Option.some(makeChips(minRaiseTo));
      maxRaise = Option.some(makeChips(maxRaiseTo));
    }
  }

  const canAllIn = chipsToNumber(playerChips) > 0;
  const allInAmount = playerChips;

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

export function validateAction(
  action: Action,
  legal: LegalActions,
): Either.Either<Action, InvalidAction> {
  return pipe(
    Match.value(action),
    Match.tag("Fold", (a) =>
      legal.canFold
        ? Either.right(a)
        : Either.left(new InvalidAction({ action: "Fold", reason: "Cannot fold right now" })),
    ),
    Match.tag("Check", (a) =>
      legal.canCheck
        ? Either.right(a)
        : Either.left(
            new InvalidAction({
              action: "Check",
              reason: "Cannot check — there is an outstanding bet to match",
            }),
          ),
    ),
    Match.tag("Call", (a) =>
      Option.isSome(legal.callAmount)
        ? Either.right(a)
        : Either.left(
            new InvalidAction({
              action: "Call",
              reason: "Cannot call — no outstanding bet, or insufficient chips (must all-in instead)",
            }),
          ),
    ),
    Match.tag("Bet", (a) => {
      if (Option.isNone(legal.minBet) || Option.isNone(legal.maxBet)) {
        return Either.left(
          new InvalidAction({
            action: "Bet",
            reason: "Cannot bet — a bet or raise has already been made this round",
          }),
        );
      }
      if (chipsToNumber(a.amount) < chipsToNumber(legal.minBet.value)) {
        return Either.left(
          new InvalidAction({
            action: "Bet",
            reason: `Bet of ${a.amount} is below the minimum of ${legal.minBet.value}`,
          }),
        );
      }
      if (chipsToNumber(a.amount) > chipsToNumber(legal.maxBet.value)) {
        return Either.left(
          new InvalidAction({
            action: "Bet",
            reason: `Bet of ${a.amount} exceeds the maximum of ${legal.maxBet.value}`,
          }),
        );
      }
      return Either.right(a);
    }),
    Match.tag("Raise", (a) => {
      if (Option.isNone(legal.minRaise) || Option.isNone(legal.maxRaise)) {
        return Either.left(
          new InvalidAction({
            action: "Raise",
            reason: "Cannot raise — no bet has been made to raise, or insufficient chips",
          }),
        );
      }
      if (chipsToNumber(a.amount) < chipsToNumber(legal.minRaise.value)) {
        return Either.left(
          new InvalidAction({
            action: "Raise",
            reason: `Raise to ${a.amount} is below the minimum of ${legal.minRaise.value}`,
          }),
        );
      }
      if (chipsToNumber(a.amount) > chipsToNumber(legal.maxRaise.value)) {
        return Either.left(
          new InvalidAction({
            action: "Raise",
            reason: `Raise to ${a.amount} exceeds the maximum of ${legal.maxRaise.value}`,
          }),
        );
      }
      return Either.right(a);
    }),
    Match.tag("AllIn", (a) =>
      legal.canAllIn
        ? Either.right(a)
        : Either.left(
            new InvalidAction({
              action: "AllIn",
              reason: "Cannot go all-in with zero chips",
            }),
          ),
    ),
    Match.exhaustive,
  );
}
