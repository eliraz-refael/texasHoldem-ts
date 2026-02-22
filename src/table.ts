/**
 * Multi-hand session manager for Texas Hold'em.
 *
 * @module
 */

import { Array as A, Effect, Either, HashMap, Option, pipe } from "effect";

import type { Chips, SeatIndex, HandId } from "./brand.js";
import {
  HandId as makeHandId,
  chipsToNumber,
  seatIndexToNumber,
  SeatIndexOrder,
} from "./brand.js";
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
  InvalidConfig,
} from "./error.js";
import type { PokerError } from "./error.js";
import type { ForcedBets, HandState } from "./hand.js";
import * as hand from "./hand.js";

// ---------------------------------------------------------------------------
// TableConfig
// ---------------------------------------------------------------------------

export interface TableConfig {
  readonly maxSeats: number; // 2-10
  readonly forcedBets: ForcedBets;
}

// ---------------------------------------------------------------------------
// TableState
// ---------------------------------------------------------------------------

export interface TableState {
  readonly config: TableConfig;
  readonly seats: HashMap.HashMap<SeatIndex, Player>;
  readonly button: Option.Option<SeatIndex>;
  readonly currentHand: Option.Option<HandState>;
  readonly handCount: number;
  readonly events: readonly GameEvent[];
}

// ---------------------------------------------------------------------------
// createTable
// ---------------------------------------------------------------------------

export function createTable(
  config: TableConfig,
): Either.Either<TableState, InvalidConfig> {
  if (config.maxSeats < 2 || config.maxSeats > 10) {
    return Either.left(
      new InvalidConfig({
        reason: `maxSeats must be between 2 and 10, got ${config.maxSeats}`,
      }),
    );
  }

  return Either.right({
    config,
    seats: HashMap.empty<SeatIndex, Player>(),
    button: Option.none(),
    currentHand: Option.none(),
    handCount: 0,
    events: [],
  });
}

// ---------------------------------------------------------------------------
// sitDown
// ---------------------------------------------------------------------------

export function sitDown(
  state: TableState,
  seat: SeatIndex,
  chips: Chips,
): Either.Either<TableState, SeatOccupied | TableFull> {
  if (Option.isSome(HashMap.get(state.seats, seat))) {
    return Either.left(new SeatOccupied({ seat }));
  }

  if (HashMap.size(state.seats) >= state.config.maxSeats) {
    return Either.left(new TableFull());
  }

  const player = createPlayer(seat, chips);
  const newSeats = HashMap.set(state.seats, seat, player);
  const event = PlayerSatDown({ seat, chips });

  return Either.right({
    ...state,
    seats: newSeats,
    events: [...state.events, event],
  });
}

// ---------------------------------------------------------------------------
// standUp
// ---------------------------------------------------------------------------

export function standUp(
  state: TableState,
  seat: SeatIndex,
): Either.Either<TableState, SeatEmpty | HandInProgress> {
  if (Option.isNone(HashMap.get(state.seats, seat))) {
    return Either.left(new SeatEmpty({ seat }));
  }

  if (Option.isSome(state.currentHand)) {
    return Either.left(new HandInProgress());
  }

  const newSeats = HashMap.remove(state.seats, seat);
  const event = PlayerStoodUp({ seat });

  return Either.right({
    ...state,
    seats: newSeats,
    events: [...state.events, event],
  });
}

// ---------------------------------------------------------------------------
// advanceButton — internal helper
// ---------------------------------------------------------------------------

function advanceButton(
  currentButton: Option.Option<SeatIndex>,
  seats: HashMap.HashMap<SeatIndex, Player>,
): SeatIndex {
  const sortedSeats = pipe(
    HashMap.keys(seats),
    (iter) => Array.from(iter),
    A.sort(SeatIndexOrder),
  );

  if (sortedSeats.length === 0) {
    // Should not happen in normal flow (checked before calling)
    throw new Error("advanceButton called with no seated players");
  }

  // Safe: we checked sortedSeats.length > 0 above
  const first = sortedSeats[0];
  if (first === undefined) {
    throw new Error("advanceButton: sortedSeats[0] is undefined");
  }

  return pipe(
    currentButton,
    Option.match({
      onNone: () => first,
      onSome: (btn) => {
        const currentIdx = sortedSeats.findIndex(
          (s) => seatIndexToNumber(s) > seatIndexToNumber(btn),
        );
        if (currentIdx === -1) {
          return first;
        }
        const next = sortedSeats[currentIdx];
        if (next === undefined) {
          throw new Error("advanceButton: sortedSeats[currentIdx] is undefined");
        }
        return next;
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// startNextHand
// ---------------------------------------------------------------------------

export function startNextHand(
  state: TableState,
): Effect.Effect<TableState, PokerError> {
  if (Option.isSome(state.currentHand)) {
    return Effect.fail(new HandInProgress());
  }

  const eligiblePlayers = pipe(
    HashMap.values(state.seats),
    (iter) => Array.from(iter),
    A.filter((p) => chipsToNumber(p.chips) > 0),
  );

  if (eligiblePlayers.length < 2) {
    return Effect.fail(
      new NotEnoughPlayers({ count: eligiblePlayers.length, minimum: 2 }),
    );
  }

  const newButton = advanceButton(state.button, state.seats);

  const players = pipe(
    eligiblePlayers,
    A.map(clearHand),
    A.sort((a: Player, b: Player) =>
      SeatIndexOrder(a.seatIndex, b.seatIndex),
    ),
  );

  const handId = makeHandId(`hand_${state.handCount + 1}`);

  return Effect.map(
    hand.startHand(players, newButton, state.config.forcedBets, handId),
    (handState) => ({
      ...state,
      button: Option.some(newButton),
      currentHand: Option.some(handState),
      handCount: state.handCount + 1,
    }),
  );
}

// ---------------------------------------------------------------------------
// act
// ---------------------------------------------------------------------------

export function act(
  state: TableState,
  seat: SeatIndex,
  action: Action,
): Either.Either<TableState, PokerError> {
  if (Option.isNone(state.currentHand)) {
    return Either.left(new NoHandInProgress());
  }

  const result = hand.act(state.currentHand.value, seat, action);

  return Either.map(result, (newHandState) => {
    if (hand.isComplete(newHandState)) {
      let newSeats = state.seats;

      for (const handPlayer of newHandState.players) {
        const seatedPlayer = HashMap.get(newSeats, handPlayer.seatIndex);
        if (Option.isSome(seatedPlayer)) {
          const updatedPlayer: Player = {
            ...clearHand(seatedPlayer.value),
            chips: handPlayer.chips,
          };

          if (chipsToNumber(updatedPlayer.chips) === 0) {
            newSeats = HashMap.remove(newSeats, handPlayer.seatIndex);
          } else {
            newSeats = HashMap.set(newSeats, handPlayer.seatIndex, updatedPlayer);
          }
        }
      }

      const handEvents = hand.getEvents(newHandState);

      return {
        ...state,
        seats: newSeats,
        currentHand: Option.none(),
        events: [...state.events, ...handEvents],
      };
    }

    return {
      ...state,
      currentHand: Option.some(newHandState),
    };
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getActivePlayer(state: TableState): Option.Option<SeatIndex> {
  return pipe(
    state.currentHand,
    Option.flatMap(hand.activePlayer),
  );
}

export function getTableLegalActions(state: TableState): Option.Option<LegalActions> {
  return pipe(
    state.currentHand,
    Option.flatMap(hand.getLegalActions),
  );
}
