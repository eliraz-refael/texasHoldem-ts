import { Array as A, Either, HashSet, Match, Option, pipe } from "effect";

import type { Chips, SeatIndex } from "./brand.js";
import {
  Chips as makeChips,
  ZERO_CHIPS,
  addChips,
  subtractChips,
  chipsToNumber,
  seatIndexToNumber,
  SeatIndexOrder,
} from "./brand.js";
import type { Player } from "./player.js";
import { canAct, placeBet, fold as foldPlayer } from "./player.js";
import type { Action, LegalActions } from "./action.js";
import { computeLegalActions, validateAction } from "./action.js";
import type { GameEvent } from "./event.js";
import { PlayerActed, BettingRoundEnded } from "./event.js";
import { InvalidAction, NotPlayersTurn } from "./error.js";

// ---------------------------------------------------------------------------
// BettingRoundState
// ---------------------------------------------------------------------------

export interface BettingRoundState {
  readonly name: string;
  readonly players: readonly Player[];
  readonly activeIndex: number;
  readonly activeSeatOrder: readonly SeatIndex[];
  readonly biggestBet: Chips;
  readonly minRaise: Chips;
  readonly lastAggressor: Option.Option<SeatIndex>;
  readonly isComplete: boolean;
  readonly hasBetThisRound: boolean;
  readonly actedThisRound: HashSet.HashSet<SeatIndex>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getPlayer(
  state: BettingRoundState,
  seat: SeatIndex,
): Player | undefined {
  return state.players.find((p) => p.seatIndex === seat);
}

export function updatePlayer(
  state: BettingRoundState,
  updatedPlayer: Player,
): BettingRoundState {
  return {
    ...state,
    players: pipe(
      state.players,
      A.map((p) => (p.seatIndex === updatedPlayer.seatIndex ? updatedPlayer : p)),
    ),
  };
}

export function activePlayer(state: BettingRoundState): Option.Option<SeatIndex> {
  if (state.isComplete || state.activeSeatOrder.length === 0) return Option.none();
  const seat = state.activeSeatOrder[state.activeIndex];
  return seat === undefined ? Option.none() : Option.some(seat);
}

// ---------------------------------------------------------------------------
// createBettingRound
// ---------------------------------------------------------------------------

export function createBettingRound(
  name: string,
  players: readonly Player[],
  firstToActSeat: SeatIndex,
  biggestBet: Chips,
  minRaise: Chips,
): BettingRoundState {
  const activePlayers = players.filter(canAct);

  const sorted = [...activePlayers].sort(
    (a, b) => SeatIndexOrder(a.seatIndex, b.seatIndex),
  );
  const firstIdx = sorted.findIndex(
    (p) => seatIndexToNumber(p.seatIndex) >= seatIndexToNumber(firstToActSeat),
  );
  const rotated =
    firstIdx === -1
      ? sorted
      : [...sorted.slice(firstIdx), ...sorted.slice(0, firstIdx)];

  const activeSeatOrder = pipe(rotated, A.map((p) => p.seatIndex));

  const nonFolded = players.filter((p) => !p.isFolded);
  const isComplete = nonFolded.length <= 1 || activeSeatOrder.length <= 1;

  return {
    name,
    players,
    activeIndex: 0,
    activeSeatOrder,
    biggestBet,
    minRaise,
    lastAggressor: Option.none(),
    isComplete,
    hasBetThisRound: chipsToNumber(biggestBet) > 0,
    actedThisRound: HashSet.empty<SeatIndex>(),
  };
}

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

export function getLegalActions(state: BettingRoundState): LegalActions {
  return pipe(
    activePlayer(state),
    Option.match({
      onNone: () =>
        computeLegalActions(
          ZERO_CHIPS,
          ZERO_CHIPS,
          state.biggestBet,
          state.minRaise,
          state.hasBetThisRound,
        ),
      onSome: (seat) => {
        const player = getPlayer(state, seat);
        if (player === undefined) {
          return computeLegalActions(
            ZERO_CHIPS,
            ZERO_CHIPS,
            state.biggestBet,
            state.minRaise,
            state.hasBetThisRound,
          );
        }
        return computeLegalActions(
          player.chips,
          player.currentBet,
          state.biggestBet,
          state.minRaise,
          state.hasBetThisRound,
        );
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Round completion detection
// ---------------------------------------------------------------------------

function checkComplete(state: BettingRoundState): boolean {
  const nonFolded = state.players.filter((p) => !p.isFolded);
  if (nonFolded.length <= 1) return true;

  if (state.activeSeatOrder.length === 0) return true;

  if (HashSet.size(state.actedThisRound) > 0) {
    const allActed = state.activeSeatOrder.every((s) =>
      HashSet.has(state.actedThisRound, s),
    );
    if (allActed) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// applyAction
// ---------------------------------------------------------------------------

export function applyAction(
  state: BettingRoundState,
  seat: SeatIndex,
  action: Action,
): Either.Either<
  { state: BettingRoundState; events: readonly GameEvent[] },
  InvalidAction | NotPlayersTurn
> {
  // 1. Check it's the correct player's turn
  const currentSeat = activePlayer(state);
  if (Option.isNone(currentSeat) || seat !== currentSeat.value) {
    return Either.left(
      new NotPlayersTurn({
        seat,
        expectedSeat: Option.isSome(currentSeat) ? currentSeat.value : seat,
      }),
    );
  }

  // 2. Validate
  const legal = getLegalActions(state);
  const validated = validateAction(action, legal);
  if (Either.isLeft(validated)) {
    return Either.left(validated.left);
  }

  const player = getPlayer(state, seat);
  if (player === undefined) {
    return Either.left(
      new NotPlayersTurn({ seat, expectedSeat: seat }),
    );
  }
  let updatedPlayer: Player = player;
  let newBiggestBet = state.biggestBet;
  let newMinRaise = state.minRaise;
  let newLastAggressor = state.lastAggressor;
  let newHasBetThisRound = state.hasBetThisRound;
  let newActedThisRound = state.actedThisRound;
  let newActiveSeatOrder = [...state.activeSeatOrder];
  let removeFromActive = false;

  // 3. Apply action via Match
  pipe(
    Match.value(action),
    Match.tag("Fold", () => {
      updatedPlayer = foldPlayer(player);
      removeFromActive = true;
    }),
    Match.tag("Check", () => {
      // no-op
    }),
    Match.tag("Call", () => {
      const callAmount = subtractChips(state.biggestBet, player.currentBet);
      updatedPlayer = placeBet(player, callAmount);
      if (updatedPlayer.isAllIn) {
        removeFromActive = true;
      }
    }),
    Match.tag("Bet", (a) => {
      updatedPlayer = placeBet(player, a.amount);
      newBiggestBet = addChips(player.currentBet, a.amount);
      newMinRaise = a.amount;
      newLastAggressor = Option.some(seat);
      newHasBetThisRound = true;
      newActedThisRound = HashSet.empty<SeatIndex>();
      if (updatedPlayer.isAllIn) {
        removeFromActive = true;
      }
    }),
    Match.tag("Raise", (a) => {
      const oldBiggestBet = state.biggestBet;
      const additionalChips = subtractChips(a.amount, player.currentBet);
      updatedPlayer = placeBet(player, additionalChips);
      newBiggestBet = a.amount;
      newMinRaise = subtractChips(a.amount, oldBiggestBet);
      newLastAggressor = Option.some(seat);
      newActedThisRound = HashSet.empty<SeatIndex>();
      if (updatedPlayer.isAllIn) {
        removeFromActive = true;
      }
    }),
    Match.tag("AllIn", () => {
      const allInTotal = addChips(player.currentBet, player.chips);
      updatedPlayer = placeBet(player, player.chips);
      if (chipsToNumber(allInTotal) > chipsToNumber(state.biggestBet)) {
        const raiseIncrement = chipsToNumber(allInTotal) - chipsToNumber(state.biggestBet);
        if (raiseIncrement >= chipsToNumber(state.minRaise)) {
          newMinRaise = makeChips(raiseIncrement);
        }
        newBiggestBet = allInTotal;
        newLastAggressor = Option.some(seat);
        newHasBetThisRound = true;
        newActedThisRound = HashSet.empty<SeatIndex>();
      }
      removeFromActive = true;
    }),
    Match.exhaustive,
  );

  // 4. Add seat to actedThisRound
  newActedThisRound = HashSet.add(newActedThisRound, seat);

  // 5. Remove from active order if needed (fold or all-in)
  if (removeFromActive) {
    newActiveSeatOrder = pipe(
      newActiveSeatOrder,
      A.filter((s) => s !== seat),
    );
  }

  // 6. Update player in state
  const newPlayers = pipe(
    state.players,
    A.map((p) => (p.seatIndex === updatedPlayer.seatIndex ? updatedPlayer : p)),
  );

  // 7. Advance to next active player
  let newActiveIndex: number;
  if (newActiveSeatOrder.length === 0) {
    newActiveIndex = 0;
  } else if (removeFromActive) {
    const removedIdx = state.activeSeatOrder.indexOf(seat);
    newActiveIndex = removedIdx >= newActiveSeatOrder.length
      ? 0
      : removedIdx;
  } else {
    newActiveIndex = (state.activeIndex + 1) % newActiveSeatOrder.length;
  }

  // 8. Build intermediate state for completion check
  const intermediateState: BettingRoundState = {
    ...state,
    players: newPlayers,
    activeIndex: newActiveIndex,
    activeSeatOrder: newActiveSeatOrder,
    biggestBet: newBiggestBet,
    minRaise: newMinRaise,
    lastAggressor: newLastAggressor,
    hasBetThisRound: newHasBetThisRound,
    actedThisRound: newActedThisRound,
    isComplete: false,
  };

  const isComplete = checkComplete(intermediateState);

  const events: GameEvent[] = [PlayerActed({ seat, action })];
  if (isComplete) {
    events.push(BettingRoundEnded({ round: state.name }));
  }

  const finalState: BettingRoundState = {
    ...intermediateState,
    isComplete,
  };

  return Either.right({ state: finalState, events });
}
