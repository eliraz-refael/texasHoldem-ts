import { Either } from "effect";

import type { Chips, SeatIndex } from "./brand.js";
import { Chips as makeChips } from "./brand.js";
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
  readonly lastAggressor: SeatIndex | null;
  readonly isComplete: boolean;
  readonly hasBetThisRound: boolean;
  readonly actedThisRound: ReadonlySet<SeatIndex>;
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
    players: state.players.map((p) =>
      p.seatIndex === updatedPlayer.seatIndex ? updatedPlayer : p,
    ),
  };
}

export function activePlayer(state: BettingRoundState): SeatIndex | null {
  if (state.isComplete || state.activeSeatOrder.length === 0) return null;
  return state.activeSeatOrder[state.activeIndex]!;
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

  // Build seat order starting from firstToActSeat
  const sorted = [...activePlayers].sort(
    (a, b) => (a.seatIndex as number) - (b.seatIndex as number),
  );
  const firstIdx = sorted.findIndex(
    (p) => (p.seatIndex as number) >= (firstToActSeat as number),
  );
  const rotated =
    firstIdx === -1
      ? sorted
      : [...sorted.slice(firstIdx), ...sorted.slice(0, firstIdx)];

  const activeSeatOrder = rotated.map((p) => p.seatIndex);

  const nonFolded = players.filter((p) => !p.isFolded);
  const isComplete = nonFolded.length <= 1 || activeSeatOrder.length <= 1;

  return {
    name,
    players,
    activeIndex: 0,
    activeSeatOrder,
    biggestBet,
    minRaise,
    lastAggressor: null,
    isComplete,
    hasBetThisRound: (biggestBet as number) > 0,
    actedThisRound: new Set<SeatIndex>(),
  };
}

// ---------------------------------------------------------------------------
// getLegalActions
// ---------------------------------------------------------------------------

export function getLegalActions(state: BettingRoundState): LegalActions {
  const seat = activePlayer(state);
  if (seat === null) {
    return computeLegalActions(
      makeChips(0),
      makeChips(0),
      state.biggestBet,
      state.minRaise,
      state.hasBetThisRound,
    );
  }
  const player = getPlayer(state, seat)!;
  return computeLegalActions(
    player.chips,
    player.currentBet,
    state.biggestBet,
    state.minRaise,
    state.hasBetThisRound,
  );
}

// ---------------------------------------------------------------------------
// Round completion detection
// ---------------------------------------------------------------------------

function checkComplete(state: BettingRoundState): boolean {
  const nonFolded = state.players.filter((p) => !p.isFolded);
  if (nonFolded.length <= 1) return true;

  if (state.activeSeatOrder.length === 0) return true;

  if (state.actedThisRound.size > 0) {
    const allActed = state.activeSeatOrder.every((s) =>
      state.actedThisRound.has(s),
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
  if (currentSeat === null || seat !== currentSeat) {
    return Either.left(
      new NotPlayersTurn({
        seat,
        expectedSeat: currentSeat ?? seat,
      }),
    );
  }

  // 2. Get legal actions and validate
  const legal = getLegalActions(state);
  const validated = validateAction(action, legal);
  if (Either.isLeft(validated)) {
    return validated as Either.Either<never, InvalidAction>;
  }

  const player = getPlayer(state, seat)!;
  let updatedPlayer: Player = player;
  let newBiggestBet = state.biggestBet;
  let newMinRaise = state.minRaise;
  let newLastAggressor = state.lastAggressor;
  let newHasBetThisRound = state.hasBetThisRound;
  let newActedThisRound = new Set<SeatIndex>(state.actedThisRound);
  let newActiveSeatOrder = [...state.activeSeatOrder];
  let removeFromActive = false;

  // 4. Apply the action
  switch (action._tag) {
    case "Fold": {
      updatedPlayer = foldPlayer(player);
      removeFromActive = true;
      break;
    }
    case "Check": {
      break;
    }
    case "Call": {
      const callAmount = makeChips(
        (state.biggestBet as number) - (player.currentBet as number),
      );
      updatedPlayer = placeBet(player, callAmount);
      if (updatedPlayer.isAllIn) {
        removeFromActive = true;
      }
      break;
    }
    case "Bet": {
      updatedPlayer = placeBet(player, action.amount);
      newBiggestBet = makeChips(
        (player.currentBet as number) + (action.amount as number),
      );
      newMinRaise = action.amount;
      newLastAggressor = seat;
      newHasBetThisRound = true;
      newActedThisRound = new Set<SeatIndex>();
      if (updatedPlayer.isAllIn) {
        removeFromActive = true;
      }
      break;
    }
    case "Raise": {
      const oldBiggestBet = state.biggestBet;
      const additionalChips = makeChips(
        (action.amount as number) - (player.currentBet as number),
      );
      updatedPlayer = placeBet(player, additionalChips);
      newBiggestBet = action.amount;
      newMinRaise = makeChips(
        (action.amount as number) - (oldBiggestBet as number),
      );
      newLastAggressor = seat;
      newActedThisRound = new Set<SeatIndex>();
      if (updatedPlayer.isAllIn) {
        removeFromActive = true;
      }
      break;
    }
    case "AllIn": {
      const allInTotal = makeChips(
        (player.currentBet as number) + (player.chips as number),
      );
      updatedPlayer = placeBet(player, player.chips);
      if ((allInTotal as number) > (state.biggestBet as number)) {
        const raiseIncrement = (allInTotal as number) - (state.biggestBet as number);
        if (raiseIncrement >= (state.minRaise as number)) {
          newMinRaise = makeChips(raiseIncrement);
        }
        newBiggestBet = allInTotal;
        newLastAggressor = seat;
        newHasBetThisRound = true;
        newActedThisRound = new Set<SeatIndex>();
      }
      removeFromActive = true;
      break;
    }
  }

  // 5. Add seat to actedThisRound
  newActedThisRound.add(seat);

  // 6. Remove from active order if needed (fold or all-in)
  if (removeFromActive) {
    const seatIdx = newActiveSeatOrder.indexOf(seat);
    if (seatIdx !== -1) {
      newActiveSeatOrder.splice(seatIdx, 1);
    }
  }

  // 7. Update player in state
  const newPlayers = state.players.map((p) =>
    p.seatIndex === updatedPlayer.seatIndex ? updatedPlayer : p,
  );

  // 8. Advance to next active player
  let newActiveIndex: number;
  if (newActiveSeatOrder.length === 0) {
    newActiveIndex = 0;
  } else if (removeFromActive) {
    // The seat was removed, so the current index now points at the next player
    // (or wraps around if we were at the end).
    const removedIdx = state.activeSeatOrder.indexOf(seat);
    // After removal, if activeIndex was pointing at the removed element,
    // the element that slid into that position is the "next" one.
    // We need to figure out what index we should be at after removal.
    newActiveIndex = removedIdx >= newActiveSeatOrder.length
      ? 0
      : removedIdx;
  } else {
    newActiveIndex = (state.activeIndex + 1) % newActiveSeatOrder.length;
  }

  // 9. Build intermediate state for completion check
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

  const events: GameEvent[] = [PlayerActed(seat, action)];
  if (isComplete) {
    events.push(BettingRoundEnded(state.name));
  }

  const finalState: BettingRoundState = {
    ...intermediateState,
    isComplete,
  };

  return Either.right({ state: finalState, events });
}
