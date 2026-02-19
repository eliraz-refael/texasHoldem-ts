import type { Chips, SeatIndex } from "./brand.js";
import { Chips as makeChips } from "./brand.js";
import type { Card } from "./card.js";

// ---------------------------------------------------------------------------
// Player interface — immutable snapshot of a player's state within a hand
// ---------------------------------------------------------------------------

export interface Player {
  readonly seatIndex: SeatIndex;
  readonly chips: Chips;
  readonly currentBet: Chips;
  readonly isAllIn: boolean;
  readonly isFolded: boolean;
  readonly holeCards: readonly [Card, Card] | null;
}

// ---------------------------------------------------------------------------
// createPlayer — construct a fresh player with sensible defaults
// ---------------------------------------------------------------------------

/**
 * Create a player seated at `seatIndex` with the given chip stack.
 * All hand-related state (bet, flags, cards) starts at zero/false/null.
 */
export function createPlayer(seatIndex: SeatIndex, chips: Chips): Player {
  return {
    seatIndex,
    chips,
    currentBet: makeChips(0),
    isAllIn: false,
    isFolded: false,
    holeCards: null,
  };
}

// ---------------------------------------------------------------------------
// Pure transitions — every function returns a new Player
// ---------------------------------------------------------------------------

/**
 * Place a bet of `amount` additional chips.
 *
 * - Subtracts `amount` from `chips`.
 * - Adds `amount` to `currentBet`.
 * - If `chips` reaches 0, sets `isAllIn` to true.
 *
 * The caller is responsible for ensuring `amount <= player.chips`.
 */
export function placeBet(player: Player, amount: Chips): Player {
  const newChips = makeChips((player.chips as number) - (amount as number));
  const newCurrentBet = makeChips(
    (player.currentBet as number) + (amount as number),
  );
  return {
    ...player,
    chips: newChips,
    currentBet: newCurrentBet,
    isAllIn: (newChips as number) === 0,
  };
}

/** Mark the player as folded. */
export function fold(player: Player): Player {
  return { ...player, isFolded: true };
}

/**
 * Award chips to the player (e.g. pot winnings).
 * Adds `amount` to the player's chip stack.
 */
export function winChips(player: Player, amount: Chips): Player {
  return {
    ...player,
    chips: makeChips((player.chips as number) + (amount as number)),
  };
}

/**
 * Reset the player's current bet to 0.
 * Called between betting rounds when bets are collected into the pot.
 */
export function collectBet(player: Player): Player {
  return { ...player, currentBet: makeChips(0) };
}

/** Set the player's hole cards. */
export function dealCards(
  player: Player,
  cards: readonly [Card, Card],
): Player {
  return { ...player, holeCards: cards };
}

/**
 * Reset all hand-related state.
 * Called between hands to prepare the player for a new deal.
 */
export function clearHand(player: Player): Player {
  return {
    ...player,
    currentBet: makeChips(0),
    isAllIn: false,
    isFolded: false,
    holeCards: null,
  };
}

// ---------------------------------------------------------------------------
// Derived queries
// ---------------------------------------------------------------------------

/**
 * The player's effective stack: the chips remaining that can still be wagered.
 * Note that `currentBet` is already committed and not part of the effective stack.
 */
export function effectiveStack(player: Player): Chips {
  return player.chips;
}

/**
 * Whether this player can still act in the current betting round.
 * A player cannot act if they have folded, are all-in, or have no chips left.
 */
export function canAct(player: Player): boolean {
  return !player.isFolded && !player.isAllIn && (player.chips as number) > 0;
}
