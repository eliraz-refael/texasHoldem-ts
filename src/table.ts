/**
 * Multi-hand session manager for Texas Hold'em.
 *
 * Manages seating, button rotation, and hand lifecycle at a single table.
 * Delegates individual hand logic to the `hand` module while maintaining
 * table-level state (seats, button position, chip stacks) between hands.
 *
 * @module
 */

import { Effect, Either } from "effect";

import type { Chips, SeatIndex } from "./brand.js";
import { Chips as makeChips } from "./brand.js";
import type { Player } from "./player.js";
import { createPlayer, clearHand } from "./player.js";
import type { Action, LegalActions } from "./action.js";
import type { GameEvent } from "./event.js";
import { PlayerSatDown, PlayerStoodUp } from "./event.js";
import {
  SeatOccupied,
  SeatEmpty,
  TableFull,
  NotEnoughPlayers,
  HandInProgress,
  NoHandInProgress,
} from "./error.js";
import type { PokerError } from "./error.js";
import type { ForcedBets, HandState } from "./hand.js";
import * as hand from "./hand.js";

// ---------------------------------------------------------------------------
// TableConfig
// ---------------------------------------------------------------------------

/** Configuration for a poker table. */
export interface TableConfig {
  readonly maxSeats: number; // 2-10
  readonly forcedBets: ForcedBets;
}

// ---------------------------------------------------------------------------
// TableState
// ---------------------------------------------------------------------------

/** Immutable snapshot of the entire table's state. */
export interface TableState {
  readonly config: TableConfig;
  readonly seats: ReadonlyMap<SeatIndex, Player>;
  readonly button: SeatIndex | null;
  readonly currentHand: HandState | null;
  readonly handCount: number;
  readonly events: readonly GameEvent[];
}

// ---------------------------------------------------------------------------
// createTable
// ---------------------------------------------------------------------------

/**
 * Create a fresh table with the given configuration.
 *
 * @throws {Error} if `maxSeats` is not in the range [2, 10].
 */
export function createTable(config: TableConfig): TableState {
  if (config.maxSeats < 2 || config.maxSeats > 10) {
    throw new Error(
      `maxSeats must be between 2 and 10, got ${config.maxSeats}`,
    );
  }

  return {
    config,
    seats: new Map<SeatIndex, Player>(),
    button: null,
    currentHand: null,
    handCount: 0,
    events: [],
  };
}

// ---------------------------------------------------------------------------
// sitDown
// ---------------------------------------------------------------------------

/**
 * Seat a new player at the given seat with the specified chip stack.
 *
 * Returns `Either.left` with `SeatOccupied` if the seat is already taken,
 * or `TableFull` if all seats are occupied.
 */
export function sitDown(
  state: TableState,
  seat: SeatIndex,
  chips: Chips,
): Either.Either<TableState, SeatOccupied | TableFull> {
  if (state.seats.has(seat)) {
    return Either.left(new SeatOccupied({ seat }));
  }

  if (state.seats.size >= state.config.maxSeats) {
    return Either.left(new TableFull());
  }

  const player = createPlayer(seat, chips);
  const newSeats = new Map(state.seats);
  newSeats.set(seat, player);

  const event = PlayerSatDown(seat, chips);

  return Either.right({
    ...state,
    seats: newSeats,
    events: [...state.events, event],
  });
}

// ---------------------------------------------------------------------------
// standUp
// ---------------------------------------------------------------------------

/**
 * Remove a player from the table.
 *
 * Returns `Either.left` with `SeatEmpty` if no one is seated there,
 * or `HandInProgress` if a hand is currently being played.
 */
export function standUp(
  state: TableState,
  seat: SeatIndex,
): Either.Either<TableState, SeatEmpty | HandInProgress> {
  if (!state.seats.has(seat)) {
    return Either.left(new SeatEmpty({ seat }));
  }

  if (state.currentHand !== null) {
    return Either.left(new HandInProgress());
  }

  const newSeats = new Map(state.seats);
  newSeats.delete(seat);

  const event = PlayerStoodUp(seat);

  return Either.right({
    ...state,
    seats: newSeats,
    events: [...state.events, event],
  });
}

// ---------------------------------------------------------------------------
// advanceButton — internal helper
// ---------------------------------------------------------------------------

/**
 * Determine the next button position.
 *
 * - If `currentButton` is null (first hand), returns the first occupied seat.
 * - Otherwise, advances clockwise to the next occupied seat.
 */
function advanceButton(
  currentButton: SeatIndex | null,
  seats: ReadonlyMap<SeatIndex, Player>,
): SeatIndex {
  const sortedSeats = [...seats.keys()].sort(
    (a, b) => (a as number) - (b as number),
  );

  if (sortedSeats.length === 0) {
    throw new Error("Cannot advance button with no seated players");
  }

  if (currentButton === null) {
    return sortedSeats[0]!;
  }

  // Find the index of the current button (or the first seat after it).
  const currentIdx = sortedSeats.findIndex(
    (s) => (s as number) > (currentButton as number),
  );

  // Wrap around if current button is the last (or beyond all) occupied seat.
  return currentIdx === -1 ? sortedSeats[0]! : sortedSeats[currentIdx]!;
}

// ---------------------------------------------------------------------------
// startNextHand
// ---------------------------------------------------------------------------

/**
 * Start a new hand at the table.
 *
 * This is effectful because it delegates to `hand.startHand`, which shuffles
 * the deck.
 *
 * - Fails with `HandInProgress` if a hand is already running.
 * - Fails with `NotEnoughPlayers` if fewer than 2 players have chips > 0.
 * - Advances the button to the next occupied seat.
 * - Builds the player list from seated players with chips > 0.
 */
export function startNextHand(
  state: TableState,
): Effect.Effect<TableState, PokerError> {
  if (state.currentHand !== null) {
    return Effect.fail(new HandInProgress());
  }

  // Only players with chips > 0 participate.
  const eligiblePlayers = [...state.seats.values()].filter(
    (p) => (p.chips as number) > 0,
  );

  if (eligiblePlayers.length < 2) {
    return Effect.fail(
      new NotEnoughPlayers({ count: eligiblePlayers.length, minimum: 2 }),
    );
  }

  const newButton = advanceButton(state.button, state.seats);

  // Build sorted player list, clearing hand-specific state.
  const players = eligiblePlayers
    .map(clearHand)
    .sort((a, b) => (a.seatIndex as number) - (b.seatIndex as number));

  return Effect.map(
    hand.startHand(players, newButton, state.config.forcedBets),
    (handState) => ({
      ...state,
      button: newButton,
      currentHand: handState,
      handCount: state.handCount + 1,
    }),
  );
}

// ---------------------------------------------------------------------------
// act
// ---------------------------------------------------------------------------

/**
 * Forward a player action to the current hand.
 *
 * - Fails with `NoHandInProgress` if no hand is active.
 * - When the hand completes after this action, transfers final chip counts
 *   back to seated players, removes busted players (chips === 0), sets
 *   `currentHand` to null, and merges hand events into table events.
 */
export function act(
  state: TableState,
  seat: SeatIndex,
  action: Action,
): Either.Either<TableState, PokerError> {
  if (state.currentHand === null) {
    return Either.left(new NoHandInProgress());
  }

  const result = hand.act(state.currentHand, seat, action);

  return Either.map(result, (newHandState) => {
    if (hand.isComplete(newHandState)) {
      // Transfer final chip counts from the hand's player states back to seats.
      const newSeats = new Map(state.seats);

      for (const handPlayer of newHandState.players) {
        const seatedPlayer = newSeats.get(handPlayer.seatIndex);
        if (seatedPlayer !== undefined) {
          // Update the seated player's chip count from the hand's final state.
          const updatedPlayer: Player = {
            ...clearHand(seatedPlayer),
            chips: handPlayer.chips,
          };

          if ((updatedPlayer.chips as number) === 0) {
            // Remove busted players.
            newSeats.delete(handPlayer.seatIndex);
          } else {
            newSeats.set(handPlayer.seatIndex, updatedPlayer);
          }
        }
      }

      // Merge hand events into table events.
      const handEvents = hand.getEvents(newHandState);

      return {
        ...state,
        seats: newSeats,
        currentHand: null,
        events: [...state.events, ...handEvents],
      };
    }

    // Hand is still in progress — just update the current hand.
    return {
      ...state,
      currentHand: newHandState,
    };
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Return the seat of the player whose turn it is, or null. */
export function getActivePlayer(state: TableState): SeatIndex | null {
  if (state.currentHand === null) return null;
  return hand.activePlayer(state.currentHand);
}

/** Return the legal actions for the active player, or null. */
export function getTableLegalActions(state: TableState): LegalActions | null {
  if (state.currentHand === null) return null;
  return hand.getLegalActions(state.currentHand);
}
