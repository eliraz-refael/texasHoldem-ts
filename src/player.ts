import { Option } from "effect";
import type { Chips, SeatIndex } from "./brand.js";
import {
  ZERO_CHIPS,
  addChips,
  subtractChips,
  chipsToNumber,
} from "./brand.js";
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
  readonly holeCards: Option.Option<readonly [Card, Card]>;
}

// ---------------------------------------------------------------------------
// createPlayer — construct a fresh player with sensible defaults
// ---------------------------------------------------------------------------

export function createPlayer(seatIndex: SeatIndex, chips: Chips): Player {
  return {
    seatIndex,
    chips,
    currentBet: ZERO_CHIPS,
    isAllIn: false,
    isFolded: false,
    holeCards: Option.none(),
  };
}

// ---------------------------------------------------------------------------
// Pure transitions — every function returns a new Player
// ---------------------------------------------------------------------------

export function placeBet(player: Player, amount: Chips): Player {
  const newChips = subtractChips(player.chips, amount);
  const newCurrentBet = addChips(player.currentBet, amount);
  return {
    ...player,
    chips: newChips,
    currentBet: newCurrentBet,
    isAllIn: chipsToNumber(newChips) === 0,
  };
}

export function fold(player: Player): Player {
  return { ...player, isFolded: true };
}

export function winChips(player: Player, amount: Chips): Player {
  return {
    ...player,
    chips: addChips(player.chips, amount),
  };
}

export function collectBet(player: Player): Player {
  return { ...player, currentBet: ZERO_CHIPS };
}

export function dealCards(
  player: Player,
  cards: readonly [Card, Card],
): Player {
  return { ...player, holeCards: Option.some(cards) };
}

export function clearHand(player: Player): Player {
  return {
    ...player,
    currentBet: ZERO_CHIPS,
    isAllIn: false,
    isFolded: false,
    holeCards: Option.none(),
  };
}

// ---------------------------------------------------------------------------
// Derived queries
// ---------------------------------------------------------------------------

export function effectiveStack(player: Player): Chips {
  return player.chips;
}

export function canAct(player: Player): boolean {
  return !player.isFolded && !player.isAllIn && chipsToNumber(player.chips) > 0;
}
