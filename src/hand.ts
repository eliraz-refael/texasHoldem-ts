/**
 * Hand lifecycle manager for Texas Hold'em.
 *
 * @module
 */

import { Array as A, Effect, Either, HashMap, Option, pipe } from "effect";

import type { Chips, SeatIndex, HandId } from "./brand.js";
import {
  ZERO_CHIPS,
  minChips,
  chipsToNumber,
  SeatIndexOrder,
} from "./brand.js";
import type { Card } from "./card.js";
import type { Deck } from "./deck.js";
import { shuffled, dealHoleCards, dealFlop, dealOne } from "./deck.js";
import type { HandRank } from "./evaluator.js";
import { evaluateHoldem } from "./evaluator.js";
import type { Player } from "./player.js";
import { placeBet, winChips, collectBet, dealCards, canAct } from "./player.js";
import type { Action, LegalActions } from "./action.js";
import type { GameEvent } from "./event.js";
import {
  HandStarted,
  BlindsPosted,
  HoleCardsDealt,
  BettingRoundEnded,
  CommunityCardsDealt,
  ShowdownStarted,
  PotAwarded,
  HandEnded,
} from "./event.js";
import type { PokerError } from "./error.js";
import { InvalidGameState } from "./error.js";
import type { Pot } from "./pot.js";
import { collectBets, awardPots } from "./pot.js";
import type { BettingRoundState } from "./betting.js";
import {
  createBettingRound,
  applyAction as bettingApplyAction,
  getLegalActions as bettingGetLegalActions,
  activePlayer as bettingActivePlayer,
} from "./betting.js";

// ---------------------------------------------------------------------------
// ForcedBets
// ---------------------------------------------------------------------------

export interface ForcedBets {
  readonly smallBlind: Chips;
  readonly bigBlind: Chips;
  readonly ante?: Chips;
}

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------

export type Phase = "Preflop" | "Flop" | "Turn" | "River" | "Showdown" | "Complete";

// ---------------------------------------------------------------------------
// HandState
// ---------------------------------------------------------------------------

export interface HandState {
  readonly handId: HandId;
  readonly phase: Phase;
  readonly players: readonly Player[];
  readonly communityCards: readonly Card[];
  readonly deck: Deck;
  readonly pots: readonly Pot[];
  readonly bettingRound: Option.Option<BettingRoundState>;
  readonly button: SeatIndex;
  readonly forcedBets: ForcedBets;
  readonly events: readonly GameEvent[];
  readonly seatOrder: readonly SeatIndex[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getPositionalSeatOrder(
  players: readonly Player[],
  button: SeatIndex,
): readonly SeatIndex[] {
  const activeSeats = pipe(
    players,
    A.filter((p) => !p.isFolded),
    A.map((p) => p.seatIndex),
    A.sort(SeatIndexOrder),
  );

  if (activeSeats.length === 0) return [];

  const btnIdx = activeSeats.indexOf(button);
  if (btnIdx === -1) return activeSeats;

  return [...activeSeats.slice(btnIdx), ...activeSeats.slice(0, btnIdx)];
}

export function getFirstToActPostflop(
  seatOrder: readonly SeatIndex[],
  button: SeatIndex,
  players: readonly Player[],
): Option.Option<SeatIndex> {
  if (seatOrder.length === 0) return Option.none();

  for (let i = 1; i < seatOrder.length; i++) {
    const seat = seatOrder[i];
    if (seat === undefined) continue;
    const player = players.find((p) => p.seatIndex === seat);
    if (player && canAct(player)) {
      return Option.some(seat);
    }
  }

  const btnPlayer = players.find((p) => p.seatIndex === button);
  if (btnPlayer && canAct(btnPlayer)) {
    return Option.some(button);
  }

  return Option.none();
}

function findPlayer(players: readonly Player[], seat: SeatIndex): Player | undefined {
  return players.find((p) => p.seatIndex === seat);
}

function updatePlayer(
  players: readonly Player[],
  seat: SeatIndex,
  updater: (p: Player) => Player,
): readonly Player[] {
  return pipe(
    players,
    A.map((p) => (p.seatIndex === seat ? updater(p) : p)),
  );
}

function countActive(players: readonly Player[]): number {
  return players.filter((p) => !p.isFolded).length;
}

function activePlayers(players: readonly Player[]): readonly Player[] {
  return players.filter((p) => !p.isFolded);
}

/** Index into an array with a descriptive crash instead of silent undefined. */
function unsafeGet<T>(arr: readonly T[], idx: number, context: string): T {
  const val = arr[idx];
  if (val === undefined) {
    throw new Error(`unsafeGet: index ${idx} out of bounds (length=${arr.length}) in ${context}`);
  }
  return val;
}

// ---------------------------------------------------------------------------
// startHand — accepts HandId as required parameter
// ---------------------------------------------------------------------------

export function startHand(
  players: readonly Player[],
  button: SeatIndex,
  forcedBets: ForcedBets,
  handId: HandId,
): Effect.Effect<HandState, PokerError> {
  return Effect.gen(function* () {
    const seatOrder = getPositionalSeatOrder(players, button);

    if (seatOrder.length < 2) {
      return yield* Effect.fail(
        new InvalidGameState({
          state: "startHand",
          reason: `Need at least 2 active players, got ${seatOrder.length}`,
        }),
      );
    }

    const deck = yield* shuffled;

    const dealResult = dealHoleCards(deck, seatOrder);
    if (Either.isLeft(dealResult)) {
      return yield* Effect.fail(
        new InvalidGameState({
          state: "startHand",
          reason: `Failed to deal hole cards: deck exhausted`,
        }),
      );
    }
    const [holeCardsMap, deckAfterDeal] = dealResult.right;

    // Apply hole cards to players via HashMap.reduce
    let currentPlayers = players;
    currentPlayers = HashMap.reduce(
      holeCardsMap,
      currentPlayers,
      (acc, cards, seat) => updatePlayer(acc, seat, (p) => dealCards(p, cards)),
    );

    const events: GameEvent[] = [];
    const isHeadsUp = seatOrder.length === 2;

    let sbSeat: SeatIndex;
    let bbSeat: SeatIndex;

    if (isHeadsUp) {
      sbSeat = unsafeGet(seatOrder, 0, "startHand:headsUp:sb");
      bbSeat = unsafeGet(seatOrder, 1, "startHand:headsUp:bb");
    } else {
      sbSeat = unsafeGet(seatOrder, 1, "startHand:sb");
      bbSeat = unsafeGet(seatOrder, 2, "startHand:bb");
    }

    // Post small blind
    const sbPlayer = findPlayer(currentPlayers, sbSeat);
    if (sbPlayer === undefined) {
      return yield* Effect.fail(
        new InvalidGameState({ state: "startHand", reason: `SB player at seat ${sbSeat} not found` }),
      );
    }
    const sbAmount = minChips(forcedBets.smallBlind, sbPlayer.chips);
    currentPlayers = updatePlayer(currentPlayers, sbSeat, (p) => placeBet(p, sbAmount));

    // Post big blind
    const bbPlayer = findPlayer(currentPlayers, bbSeat);
    if (bbPlayer === undefined) {
      return yield* Effect.fail(
        new InvalidGameState({ state: "startHand", reason: `BB player at seat ${bbSeat} not found` }),
      );
    }
    const bbAmount = minChips(forcedBets.bigBlind, bbPlayer.chips);
    currentPlayers = updatePlayer(currentPlayers, bbSeat, (p) => placeBet(p, bbAmount));

    events.push(HandStarted({ handId, button, players: seatOrder }));
    events.push(
      BlindsPosted({
        smallBlind: { seat: sbSeat, amount: sbAmount },
        bigBlind: { seat: bbSeat, amount: bbAmount },
      }),
    );

    for (const seat of seatOrder) {
      events.push(HoleCardsDealt({ seat }));
    }

    // Create preflop betting round
    let firstToAct: SeatIndex;
    if (isHeadsUp) {
      firstToAct = unsafeGet(seatOrder, 0, "startHand:firstToAct:headsUp");
    } else {
      const bbIdx = seatOrder.indexOf(bbSeat);
      firstToAct = unsafeGet(seatOrder, (bbIdx + 1) % seatOrder.length, "startHand:firstToAct");
    }

    const bettingRound = createBettingRound(
      "Preflop",
      currentPlayers,
      firstToAct,
      bbAmount,
      forcedBets.bigBlind,
    );

    const phase: Phase = "Preflop";
    return {
      handId,
      phase,
      players: currentPlayers,
      communityCards: [],
      deck: deckAfterDeal,
      pots: [],
      bettingRound: Option.some(bettingRound),
      button,
      forcedBets,
      events,
      seatOrder,
    };
  });
}

// ---------------------------------------------------------------------------
// act
// ---------------------------------------------------------------------------

export function act(
  state: HandState,
  seat: SeatIndex,
  action: Action,
): Either.Either<HandState, PokerError> {
  if (state.phase === "Complete" || state.phase === "Showdown") {
    return Either.left(
      new InvalidGameState({
        state: state.phase,
        reason: `Cannot act during ${state.phase} phase`,
      }),
    );
  }

  if (Option.isNone(state.bettingRound)) {
    return Either.left(
      new InvalidGameState({
        state: state.phase,
        reason: "No active betting round",
      }),
    );
  }

  const result = bettingApplyAction(state.bettingRound.value, seat, action);

  return Either.flatMap(result, ({ state: newBettingRound, events: actionEvents }) => {
    const updatedState: HandState = {
      ...state,
      players: newBettingRound.players,
      bettingRound: Option.some(newBettingRound),
      events: [...state.events, ...actionEvents],
    };

    if (newBettingRound.isComplete) {
      return advancePhase(updatedState);
    }

    return Either.right(updatedState);
  });
}

// ---------------------------------------------------------------------------
// advancePhase (internal)
// ---------------------------------------------------------------------------

function advancePhase(state: HandState): Either.Either<HandState, PokerError> {
  const roundName = Option.isSome(state.bettingRound)
    ? state.bettingRound.value.name
    : state.phase;

  const collected = collectBets(state.players, state.pots);

  const playersAfterCollect: readonly Player[] = pipe(
    state.players,
    A.map((p): Player => {
      const bp = collected.players.find((cp) => cp.seatIndex === p.seatIndex);
      if (!bp) return p;
      return {
        ...p,
        currentBet: bp.currentBet,
        isFolded: bp.isFolded,
        isAllIn: bp.isAllIn,
      };
    }),
  );

  const playersReset = pipe(playersAfterCollect, A.map(collectBet));

  const newEvents: GameEvent[] = [BettingRoundEnded({ round: roundName })];

  const baseState: HandState = {
    ...state,
    players: playersReset,
    pots: collected.pots,
    bettingRound: Option.none(),
    events: [...state.events, ...newEvents],
  };

  const activeCount = countActive(playersReset);
  if (activeCount <= 1) {
    return awardToLastPlayer(baseState);
  }

  const canAnyoneAct = playersReset.some((p) => canAct(p));

  const { phase } = state;
  if (phase === "Preflop") return dealAndStartRound(baseState, "Flop", canAnyoneAct);
  if (phase === "Flop") return dealAndStartRound(baseState, "Turn", canAnyoneAct);
  if (phase === "Turn") return dealAndStartRound(baseState, "River", canAnyoneAct);
  if (phase === "River") return performShowdown(baseState);
  return Either.left(
    new InvalidGameState({ state: phase, reason: `Cannot advance from ${phase}` }),
  );
}

// ---------------------------------------------------------------------------
// dealAndStartRound (internal)
// ---------------------------------------------------------------------------

function dealAndStartRound(
  state: HandState,
  nextPhase: "Flop" | "Turn" | "River",
  canAnyoneAct: boolean,
): Either.Either<HandState, PokerError> {
  let newCommunityCards: readonly Card[];
  let remainingDeck: Deck;
  const dealEvents: GameEvent[] = [];

  if (nextPhase === "Flop") {
    const flopResult = dealFlop(state.deck);
    if (Either.isLeft(flopResult)) {
      return Either.left(
        new InvalidGameState({ state: nextPhase, reason: "Deck exhausted during flop deal" }),
      );
    }
    const [flop, deck] = flopResult.right;
    newCommunityCards = [...state.communityCards, ...flop];
    remainingDeck = deck;
    dealEvents.push(CommunityCardsDealt({ cards: flop, phase: "Flop" }));
  } else {
    const oneResult = dealOne(state.deck);
    if (Either.isLeft(oneResult)) {
      return Either.left(
        new InvalidGameState({ state: nextPhase, reason: "Deck exhausted during deal" }),
      );
    }
    const [cardDealt, deck] = oneResult.right;
    newCommunityCards = [...state.communityCards, cardDealt];
    remainingDeck = deck;
    dealEvents.push(CommunityCardsDealt({ cards: [cardDealt], phase: nextPhase }));
  }

  const stateWithCards: HandState = {
    ...state,
    phase: nextPhase,
    communityCards: newCommunityCards,
    deck: remainingDeck,
    events: [...state.events, ...dealEvents],
  };

  if (!canAnyoneAct) {
    if (nextPhase === "River") {
      return performShowdown(stateWithCards);
    }
    const nextNextPhase =
      nextPhase === "Flop" ? "Turn" as const :
      nextPhase === "Turn" ? "River" as const :
      "River" as const;
    return dealAndStartRound(stateWithCards, nextNextPhase, false);
  }

  const firstToAct = getFirstToActPostflop(
    state.seatOrder,
    state.button,
    state.players,
  );

  if (Option.isNone(firstToAct)) {
    if (nextPhase === "River") {
      return performShowdown(stateWithCards);
    }
    const nextNextPhase =
      nextPhase === "Flop" ? "Turn" as const :
      "River" as const;
    return dealAndStartRound(stateWithCards, nextNextPhase, false);
  }

  const bettingRound = createBettingRound(
    nextPhase,
    stateWithCards.players,
    firstToAct.value,
    ZERO_CHIPS,
    state.forcedBets.bigBlind,
  );

  return Either.right({
    ...stateWithCards,
    bettingRound: Option.some(bettingRound),
  });
}

// ---------------------------------------------------------------------------
// awardToLastPlayer (internal)
// ---------------------------------------------------------------------------

function awardToLastPlayer(state: HandState): Either.Either<HandState, PokerError> {
  const remaining = activePlayers(state.players);

  if (remaining.length === 0) {
    return Either.left(
      new InvalidGameState({
        state: state.phase,
        reason: "No active players remaining",
      }),
    );
  }

  const winner = unsafeGet(remaining, 0, "awardToLastPlayer:winner");
  const awardEvents: GameEvent[] = [];
  let currentPlayers = state.players;

  for (let i = 0; i < state.pots.length; i++) {
    const pot = state.pots[i];
    if (pot === undefined) continue;
    awardEvents.push(PotAwarded({ seat: winner.seatIndex, amount: pot.amount, potIndex: i }));
    currentPlayers = updatePlayer(currentPlayers, winner.seatIndex, (p) =>
      winChips(p, pot.amount),
    );
  }

  awardEvents.push(HandEnded);

  const completePhase: Phase = "Complete";
  return Either.right({
    ...state,
    phase: completePhase,
    players: currentPlayers,
    pots: [],
    bettingRound: Option.none(),
    events: [...state.events, ...awardEvents],
  });
}

// ---------------------------------------------------------------------------
// performShowdown (internal)
// ---------------------------------------------------------------------------

function performShowdown(state: HandState): Either.Either<HandState, PokerError> {
  const showdownEvents: GameEvent[] = [ShowdownStarted];

  const playerHands = new Map<SeatIndex, HandRank>();

  for (const player of state.players) {
    if (!player.isFolded && Option.isSome(player.holeCards)) {
      const result = evaluateHoldem(player.holeCards.value, state.communityCards);
      if (Either.isRight(result)) {
        playerHands.set(player.seatIndex, result.right);
      }
    }
  }

  const awards = awardPots(
    state.pots,
    playerHands,
    state.button,
    state.seatOrder,
  );

  let currentPlayers = state.players;
  let awardIdx = 0;
  for (let potIdx = 0; potIdx < state.pots.length; potIdx++) {
    const pot = state.pots[potIdx];
    if (pot === undefined) continue;
    const potEligible = pot.eligibleSeats;

    const potContenders = potEligible.filter((s) => playerHands.has(s));
    if (potContenders.length === 0) continue;

    let bestRank = -Infinity;
    for (const seat of potContenders) {
      const hr = playerHands.get(seat);
      if (hr !== undefined && hr.rank > bestRank) bestRank = hr.rank;
    }
    const winnersForPot = potContenders.filter((s) => {
      const hr = playerHands.get(s);
      return hr !== undefined && hr.rank === bestRank;
    });

    for (let w = 0; w < winnersForPot.length; w++) {
      if (awardIdx < awards.length) {
        const award = awards[awardIdx];
        if (award === undefined) break;
        showdownEvents.push(PotAwarded({ seat: award.seat, amount: award.amount, potIndex: potIdx }));
        currentPlayers = updatePlayer(currentPlayers, award.seat, (p) =>
          winChips(p, award.amount),
        );
        awardIdx++;
      }
    }
  }

  showdownEvents.push(HandEnded);

  const completePhase: Phase = "Complete";
  return Either.right({
    ...state,
    phase: completePhase,
    players: currentPlayers,
    pots: [],
    bettingRound: Option.none(),
    events: [...state.events, ...showdownEvents],
  });
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

export function activePlayer(state: HandState): Option.Option<SeatIndex> {
  return pipe(
    state.bettingRound,
    Option.flatMap(bettingActivePlayer),
  );
}

export function currentPhase(state: HandState): Phase {
  return state.phase;
}

export function getLegalActions(state: HandState): Option.Option<LegalActions> {
  return pipe(
    state.bettingRound,
    Option.map(bettingGetLegalActions),
  );
}

export function getEvents(state: HandState): readonly GameEvent[] {
  return state.events;
}

export function isComplete(state: HandState): boolean {
  return state.phase === "Complete";
}
