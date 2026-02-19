/**
 * Hand lifecycle manager for Texas Hold'em.
 *
 * Orchestrates the full lifecycle of a single poker hand: dealing,
 * blind posting, betting rounds, community cards, showdown, and
 * pot distribution.
 *
 * - `startHand` is effectful (shuffles the deck).
 * - `act` is pure (returns `Either`).
 * - All state transitions are immutable.
 *
 * @module
 */

import { Effect, Either } from "effect";

import type { Chips, SeatIndex, HandId } from "./brand.js";
import { Chips as makeChips, HandId as makeHandId } from "./brand.js";
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

/** Configuration for forced bets (blinds and optional ante). */
export interface ForcedBets {
  readonly smallBlind: Chips;
  readonly bigBlind: Chips;
  readonly ante?: Chips;
}

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------

/** The current phase of a poker hand. */
export type Phase = "Preflop" | "Flop" | "Turn" | "River" | "Showdown" | "Complete";

// ---------------------------------------------------------------------------
// HandState
// ---------------------------------------------------------------------------

/** Immutable snapshot of the full state of a single poker hand. */
export interface HandState {
  readonly handId: HandId;
  readonly phase: Phase;
  readonly players: readonly Player[];
  readonly communityCards: readonly Card[];
  readonly deck: Deck;
  readonly pots: readonly Pot[];
  readonly bettingRound: BettingRoundState | null;
  readonly button: SeatIndex;
  readonly forcedBets: ForcedBets;
  readonly events: readonly GameEvent[];
  readonly seatOrder: readonly SeatIndex[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build clockwise seat order starting from button.
 * Filters to players who are not folded (i.e. active/eligible players).
 */
export function getPositionalSeatOrder(
  players: readonly Player[],
  button: SeatIndex,
): readonly SeatIndex[] {
  // Get all active player seats sorted by seat index
  const activeSeats = players
    .filter((p) => !p.isFolded)
    .map((p) => p.seatIndex)
    .sort((a, b) => (a as number) - (b as number));

  if (activeSeats.length === 0) return [];

  // Rotate so button is first
  const btnIdx = activeSeats.indexOf(button);
  if (btnIdx === -1) {
    // Button seat not found among active players; just return sorted
    return activeSeats;
  }

  return [...activeSeats.slice(btnIdx), ...activeSeats.slice(0, btnIdx)];
}

/**
 * Find the first seat after button that can still act (not folded, not all-in).
 * Used to determine first-to-act in postflop betting rounds.
 */
export function getFirstToActPostflop(
  seatOrder: readonly SeatIndex[],
  button: SeatIndex,
  players: readonly Player[],
): SeatIndex | null {
  if (seatOrder.length === 0) return null;

  // seatOrder starts from button; seats after button start at index 1
  for (let i = 1; i < seatOrder.length; i++) {
    const seat = seatOrder[i]!;
    const player = players.find((p) => p.seatIndex === seat);
    if (player && canAct(player)) {
      return seat;
    }
  }

  // Wrap around to check the button seat itself
  const btnPlayer = players.find((p) => p.seatIndex === button);
  if (btnPlayer && canAct(btnPlayer)) {
    return button;
  }

  return null;
}

/** Find a player by seat index. */
function findPlayer(players: readonly Player[], seat: SeatIndex): Player | undefined {
  return players.find((p) => p.seatIndex === seat);
}

/** Replace a player in the players array by seat index. */
function updatePlayer(
  players: readonly Player[],
  seat: SeatIndex,
  updater: (p: Player) => Player,
): readonly Player[] {
  return players.map((p) => (p.seatIndex === seat ? updater(p) : p));
}

/** Count non-folded players. */
function countActive(players: readonly Player[]): number {
  return players.filter((p) => !p.isFolded).length;
}

/** Get the non-folded players. */
function activePlayers(players: readonly Player[]): readonly Player[] {
  return players.filter((p) => !p.isFolded);
}

// ---------------------------------------------------------------------------
// Hand ID counter
// ---------------------------------------------------------------------------

let handIdCounter = 0;

function generateHandId(): HandId {
  handIdCounter += 1;
  return makeHandId(`hand_${Date.now()}_${handIdCounter}`);
}

// ---------------------------------------------------------------------------
// startHand
// ---------------------------------------------------------------------------

/**
 * Start a new hand of Texas Hold'em.
 *
 * This is effectful because it shuffles the deck.
 *
 * @param players   - The players seated at the table (must have >= 2).
 * @param button    - The seat index of the dealer button.
 * @param forcedBets - Small blind, big blind, and optional ante amounts.
 * @param handId    - Optional hand ID; one will be generated if omitted.
 * @returns An Effect that resolves to the initial HandState.
 */
export function startHand(
  players: readonly Player[],
  button: SeatIndex,
  forcedBets: ForcedBets,
  handId?: HandId,
): Effect.Effect<HandState, PokerError> {
  return Effect.gen(function* () {
    const id = handId ?? generateHandId();

    // Build seat order: all active seats clockwise from button
    const seatOrder = getPositionalSeatOrder(players, button);

    if (seatOrder.length < 2) {
      return yield* Effect.fail(
        new InvalidGameState({
          state: "startHand",
          reason: `Need at least 2 active players, got ${seatOrder.length}`,
        }),
      );
    }

    // Shuffle deck
    const deck = yield* shuffled;

    // Deal hole cards
    const [holeCardsMap, deckAfterDeal] = dealHoleCards(deck, seatOrder);

    // Apply hole cards to players
    let currentPlayers = players;
    for (const [seat, cards] of holeCardsMap) {
      currentPlayers = updatePlayer(currentPlayers, seat, (p) => dealCards(p, cards));
    }

    // Post blinds
    const events: GameEvent[] = [];
    const isHeadsUp = seatOrder.length === 2;

    let sbSeat: SeatIndex;
    let bbSeat: SeatIndex;

    if (isHeadsUp) {
      // Heads-up: button posts SB, other posts BB
      sbSeat = seatOrder[0]!; // button
      bbSeat = seatOrder[1]!;
    } else {
      // 3+ players: seat after button posts SB, next seat posts BB
      sbSeat = seatOrder[1]!;
      bbSeat = seatOrder[2]!;
    }

    // Post small blind
    const sbPlayer = findPlayer(currentPlayers, sbSeat)!;
    const sbAmount = makeChips(
      Math.min(forcedBets.smallBlind as number, sbPlayer.chips as number),
    );
    currentPlayers = updatePlayer(currentPlayers, sbSeat, (p) => placeBet(p, sbAmount));

    // Post big blind
    const bbPlayer = findPlayer(currentPlayers, bbSeat)!;
    const bbAmount = makeChips(
      Math.min(forcedBets.bigBlind as number, bbPlayer.chips as number),
    );
    currentPlayers = updatePlayer(currentPlayers, bbSeat, (p) => placeBet(p, bbAmount));

    // Collect events
    events.push(HandStarted(id, button, seatOrder));
    events.push(
      BlindsPosted(
        { seat: sbSeat, amount: sbAmount },
        { seat: bbSeat, amount: bbAmount },
      ),
    );

    // HoleCardsDealt events for each player
    for (const seat of seatOrder) {
      events.push(HoleCardsDealt(seat));
    }

    // Create preflop betting round
    // First to act: seat after BB (UTG)
    let firstToAct: SeatIndex;
    if (isHeadsUp) {
      // Heads-up preflop: button (SB) acts first
      firstToAct = seatOrder[0]!; // button/SB
    } else {
      // Find the seat after BB in the seat order
      const bbIdx = seatOrder.indexOf(bbSeat);
      firstToAct = seatOrder[(bbIdx + 1) % seatOrder.length]!;
    }

    const bettingRound = createBettingRound(
      "Preflop",
      currentPlayers,
      firstToAct,
      bbAmount,
      forcedBets.bigBlind,
    );

    return {
      handId: id,
      phase: "Preflop" as Phase,
      players: currentPlayers,
      communityCards: [],
      deck: deckAfterDeal,
      pots: [],
      bettingRound,
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

/**
 * Apply a player action to the current hand state.
 *
 * This is pure (not effectful) — returns an `Either`.
 *
 * @param state  - The current hand state.
 * @param seat   - The seat index of the acting player.
 * @param action - The action to perform.
 * @returns Either a new HandState (right) or a PokerError (left).
 */
export function act(
  state: HandState,
  seat: SeatIndex,
  action: Action,
): Either.Either<HandState, PokerError> {
  // Cannot act in completed or showdown phase
  if (state.phase === "Complete" || state.phase === "Showdown") {
    return Either.left(
      new InvalidGameState({
        state: state.phase,
        reason: `Cannot act during ${state.phase} phase`,
      }),
    );
  }

  // Must have an active betting round
  if (state.bettingRound === null) {
    return Either.left(
      new InvalidGameState({
        state: state.phase,
        reason: "No active betting round",
      }),
    );
  }

  // Forward to betting module
  const result = bettingApplyAction(state.bettingRound, seat, action);

  return Either.flatMap(result, ({ state: newBettingRound, events: actionEvents }) => {
    // Sync players from betting round back into hand state
    const updatedState: HandState = {
      ...state,
      players: newBettingRound.players,
      bettingRound: newBettingRound,
      events: [...state.events, ...actionEvents],
    };

    // If the betting round is complete, auto-advance phase
    if (newBettingRound.isComplete) {
      return advancePhase(updatedState);
    }

    return Either.right(updatedState);
  });
}

// ---------------------------------------------------------------------------
// advancePhase (internal)
// ---------------------------------------------------------------------------

/**
 * Handle phase transition after a betting round completes.
 *
 * - Collects bets into pots.
 * - Resets player current bets.
 * - If only 1 non-folded player remains, awards pots and completes.
 * - Otherwise, deals community cards and starts the next betting round,
 *   or performs showdown if all streets are done.
 */
function advancePhase(state: HandState): Either.Either<HandState, PokerError> {
  const roundName = state.bettingRound?.name ?? state.phase;

  // Collect bets into pots
  const collected = collectBets(state.players, state.pots);

  // Map BettingPlayer[] back to full Player[] preserving hole cards, etc.
  const playersAfterCollect = state.players.map((p) => {
    const bp = collected.players.find((cp) => cp.seatIndex === p.seatIndex);
    if (!bp) return p;
    return {
      ...p,
      currentBet: bp.currentBet,
      isFolded: bp.isFolded,
      isAllIn: bp.isAllIn,
    } as Player;
  });

  // Reset current bets on players
  const playersReset = playersAfterCollect.map((p) => collectBet(p));

  const newEvents: GameEvent[] = [BettingRoundEnded(roundName)];

  const baseState: HandState = {
    ...state,
    players: playersReset,
    pots: collected.pots,
    bettingRound: null,
    events: [...state.events, ...newEvents],
  };

  // Check if only 1 non-folded player remains
  const activeCount = countActive(playersReset);
  if (activeCount <= 1) {
    return awardToLastPlayer(baseState);
  }

  // Check if all remaining active players are all-in (no one can act)
  const canAnyoneAct = playersReset.some((p) => canAct(p));

  // Advance to next phase
  switch (state.phase) {
    case "Preflop":
      return dealAndStartRound(baseState, "Flop", canAnyoneAct);
    case "Flop":
      return dealAndStartRound(baseState, "Turn", canAnyoneAct);
    case "Turn":
      return dealAndStartRound(baseState, "River", canAnyoneAct);
    case "River":
      return performShowdown(baseState);
    default:
      return Either.left(
        new InvalidGameState({
          state: state.phase,
          reason: `Cannot advance from phase: ${state.phase}`,
        }),
      );
  }
}

// ---------------------------------------------------------------------------
// dealAndStartRound (internal)
// ---------------------------------------------------------------------------

/**
 * Deal community cards for the next phase and start a new betting round.
 * If no one can act (everyone is all-in), skip the betting round and
 * auto-advance to the next phase.
 */
function dealAndStartRound(
  state: HandState,
  nextPhase: "Flop" | "Turn" | "River",
  canAnyoneAct: boolean,
): Either.Either<HandState, PokerError> {
  let newCommunityCards: readonly Card[];
  let remainingDeck: Deck;
  const dealEvents: GameEvent[] = [];

  if (nextPhase === "Flop") {
    const [flop, deck] = dealFlop(state.deck);
    newCommunityCards = [...state.communityCards, ...flop];
    remainingDeck = deck;
    dealEvents.push(CommunityCardsDealt(flop, "Flop"));
  } else {
    const [card, deck] = dealOne(state.deck);
    newCommunityCards = [...state.communityCards, card];
    remainingDeck = deck;
    dealEvents.push(CommunityCardsDealt([card], nextPhase));
  }

  const stateWithCards: HandState = {
    ...state,
    phase: nextPhase,
    communityCards: newCommunityCards,
    deck: remainingDeck,
    events: [...state.events, ...dealEvents],
  };

  // If nobody can act (all-in or heads-up all-in), skip to next phase
  if (!canAnyoneAct) {
    // No betting round needed; auto-advance
    if (nextPhase === "River") {
      // After river with no action possible, go to showdown
      return performShowdown(stateWithCards);
    }
    // Continue dealing next streets
    const nextNextPhase =
      nextPhase === "Flop" ? "Turn" as const :
      nextPhase === "Turn" ? "River" as const :
      "River" as const;
    return dealAndStartRound(stateWithCards, nextNextPhase, false);
  }

  // Create new betting round
  const firstToAct = getFirstToActPostflop(
    state.seatOrder,
    state.button,
    state.players,
  );

  if (firstToAct === null) {
    // No one can act — skip to showdown through remaining streets
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
    firstToAct,
    makeChips(0),
    state.forcedBets.bigBlind,
  );

  return Either.right({
    ...stateWithCards,
    bettingRound,
  });
}

// ---------------------------------------------------------------------------
// awardToLastPlayer (internal)
// ---------------------------------------------------------------------------

/**
 * When all but one player has folded, award all pots to the remaining player.
 */
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

  const winner = remaining[0]!;
  const awardEvents: GameEvent[] = [];
  let currentPlayers = state.players;

  // Award each pot to the winner
  for (let i = 0; i < state.pots.length; i++) {
    const pot = state.pots[i]!;
    awardEvents.push(PotAwarded(winner.seatIndex, pot.amount, i));
    currentPlayers = updatePlayer(currentPlayers, winner.seatIndex, (p) =>
      winChips(p, pot.amount),
    );
  }

  awardEvents.push(HandEnded);

  return Either.right({
    ...state,
    phase: "Complete" as Phase,
    players: currentPlayers,
    pots: [],
    bettingRound: null,
    events: [...state.events, ...awardEvents],
  });
}

// ---------------------------------------------------------------------------
// performShowdown (internal)
// ---------------------------------------------------------------------------

/**
 * Perform the showdown: evaluate hands, award pots, and complete the hand.
 *
 * 1. Add ShowdownStarted event.
 * 2. Evaluate each non-folded player's hand.
 * 3. Award pots using the pot module's `awardPots`.
 * 4. Credit winnings to players.
 * 5. Add PotAwarded and HandEnded events.
 * 6. Set phase to "Complete".
 */
function performShowdown(state: HandState): Either.Either<HandState, PokerError> {
  const showdownEvents: GameEvent[] = [ShowdownStarted];

  // Evaluate hands for all non-folded players with hole cards
  const playerHands = new Map<SeatIndex, HandRank>();

  for (const player of state.players) {
    if (!player.isFolded && player.holeCards !== null) {
      const handRank = evaluateHoldem(player.holeCards, state.communityCards);
      playerHands.set(player.seatIndex, handRank);
    }
  }

  // Award pots
  const awards = awardPots(
    state.pots,
    playerHands,
    state.button,
    state.seatOrder,
  );

  // Credit all awards to players and generate PotAwarded events.
  // awardPots returns a flat list processed pot-by-pot in order; we reconstruct
  // the pot index by walking pots and counting winners for each.
  let currentPlayers = state.players;
  let awardIdx = 0;
  for (let potIdx = 0; potIdx < state.pots.length; potIdx++) {
    const pot = state.pots[potIdx]!;
    const potEligible = pot.eligibleSeats;

    // Gather awards that belong to this pot
    // Awards for a pot are contiguous in the output, one per winner
    const potContenders = potEligible.filter((s) => playerHands.has(s));
    if (potContenders.length === 0) continue;

    // Find the best rank among contenders
    let bestRank = -Infinity;
    for (const seat of potContenders) {
      const hr = playerHands.get(seat)!;
      if (hr.rank > bestRank) bestRank = hr.rank;
    }
    const winners = potContenders.filter((s) => playerHands.get(s)!.rank === bestRank);

    // The number of awards for this pot equals the number of winners
    for (let w = 0; w < winners.length; w++) {
      if (awardIdx < awards.length) {
        const award = awards[awardIdx]!;
        showdownEvents.push(PotAwarded(award.seat, award.amount, potIdx));
        currentPlayers = updatePlayer(currentPlayers, award.seat, (p) =>
          winChips(p, award.amount),
        );
        awardIdx++;
      }
    }
  }

  showdownEvents.push(HandEnded);

  return Either.right({
    ...state,
    phase: "Complete" as Phase,
    players: currentPlayers,
    pots: [],
    bettingRound: null,
    events: [...state.events, ...showdownEvents],
  });
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

/**
 * Get the seat index of the player who should act next,
 * or `null` if no one needs to act.
 */
export function activePlayer(state: HandState): SeatIndex | null {
  if (state.bettingRound === null) return null;
  return bettingActivePlayer(state.bettingRound);
}

/** Get the current phase of the hand. */
export function currentPhase(state: HandState): Phase {
  return state.phase;
}

/**
 * Get the legal actions for the current active player,
 * or `null` if no betting round is active.
 */
export function getLegalActions(state: HandState): LegalActions | null {
  if (state.bettingRound === null) return null;
  return bettingGetLegalActions(state.bettingRound);
}

/** Get all events that have occurred so far in this hand. */
export function getEvents(state: HandState): readonly GameEvent[] {
  return state.events;
}

/** Check whether the hand has completed. */
export function isComplete(state: HandState): boolean {
  return state.phase === "Complete";
}
