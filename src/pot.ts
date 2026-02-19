/**
 * Side-pot calculation and award distribution for Texas Hold'em.
 *
 * @module
 */

import { Array as A, pipe } from "effect";
import type { Chips, SeatIndex } from "./brand.js";
import {
  Chips as makeChips,
  ZERO_CHIPS,
  addChips,
  chipsToNumber,
  SeatIndexOrder,
} from "./brand.js";
import type { HandRank } from "./evaluator.js";

// ---------------------------------------------------------------------------
// Pot type
// ---------------------------------------------------------------------------

export interface Pot {
  readonly amount: Chips;
  readonly eligibleSeats: readonly SeatIndex[];
}

// ---------------------------------------------------------------------------
// createPot
// ---------------------------------------------------------------------------

export function createPot(
  amount: Chips,
  eligibleSeats: readonly SeatIndex[],
): Pot {
  return { amount, eligibleSeats };
}

// ---------------------------------------------------------------------------
// BettingPlayer — local helper type used by collectBets
// ---------------------------------------------------------------------------

export interface BettingPlayer {
  readonly seatIndex: SeatIndex;
  readonly currentBet: Chips;
  readonly isFolded: boolean;
  readonly isAllIn: boolean;
}

// ---------------------------------------------------------------------------
// collectBets
// ---------------------------------------------------------------------------

export function collectBets(
  players: readonly BettingPlayer[],
  existingPots: readonly Pot[],
): {
  pots: readonly Pot[];
  players: readonly BettingPlayer[];
} {
  // Work on mutable copies so the originals stay untouched.
  const mutablePlayers = players.map((p) => ({
    seatIndex: p.seatIndex,
    currentBet: chipsToNumber(p.currentBet),
    isFolded: p.isFolded,
    isAllIn: p.isAllIn,
  }));

  const newPots: Pot[] = [];

  while (mutablePlayers.some((p) => p.currentBet > 0)) {
    const minBet = pipe(
      mutablePlayers,
      A.filter((p) => p.currentBet > 0),
      A.reduce(Infinity, (min, p) => (p.currentBet < min ? p.currentBet : min)),
    );

    const eligibleSeats = pipe(
      mutablePlayers,
      A.filter((p) => p.currentBet >= minBet && !p.isFolded),
      A.map((p) => p.seatIndex),
    );

    let potAmount = 0;
    for (const p of mutablePlayers) {
      if (p.currentBet > 0) {
        const contribution = Math.min(p.currentBet, minBet);
        potAmount += contribution;
        p.currentBet -= contribution;
      }
    }

    newPots.push(createPot(makeChips(potAmount), eligibleSeats));
  }

  const merged = mergePots(existingPots, newPots);

  const zeroedPlayers: readonly BettingPlayer[] = pipe(
    mutablePlayers,
    A.map((p) => ({
      seatIndex: p.seatIndex,
      currentBet: ZERO_CHIPS,
      isFolded: p.isFolded,
      isAllIn: p.isAllIn,
    })),
  );

  return { pots: merged, players: zeroedPlayers };
}

// ---------------------------------------------------------------------------
// mergePots — internal helper
// ---------------------------------------------------------------------------

function mergePots(
  existing: readonly Pot[],
  incoming: readonly Pot[],
): readonly Pot[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming;

  const lastExisting = existing[existing.length - 1];
  const firstIncoming = incoming[0];

  if (lastExisting === undefined || firstIncoming === undefined) {
    return [...existing, ...incoming];
  }

  if (sameSeatSet(lastExisting.eligibleSeats, firstIncoming.eligibleSeats)) {
    const combinedAmount = addChips(lastExisting.amount, firstIncoming.amount);
    const combinedPot = createPot(combinedAmount, lastExisting.eligibleSeats);

    return [
      ...existing.slice(0, existing.length - 1),
      combinedPot,
      ...incoming.slice(1),
    ];
  }

  return [...existing, ...incoming];
}

/** Check whether two seat-index arrays contain the same elements (order-insensitive). */
function sameSeatSet(
  a: readonly SeatIndex[],
  b: readonly SeatIndex[],
): boolean {
  if (a.length !== b.length) return false;
  const sortedA = pipe([...a], A.sort(SeatIndexOrder));
  const sortedB = pipe([...b], A.sort(SeatIndexOrder));
  return sortedA.every((v, i) => v === sortedB[i]);
}

// ---------------------------------------------------------------------------
// awardPots
// ---------------------------------------------------------------------------

export function awardPots(
  pots: readonly Pot[],
  playerHands: ReadonlyMap<SeatIndex, HandRank>,
  buttonSeat: SeatIndex,
  seatOrder: readonly SeatIndex[],
): readonly { seat: SeatIndex; amount: Chips }[] {
  const awards: { seat: SeatIndex; amount: Chips }[] = [];

  for (const pot of pots) {
    const contenders = pipe(
      pot.eligibleSeats,
      A.filter((s) => playerHands.has(s)),
    );

    if (contenders.length === 0) continue;

    if (contenders.length === 1) {
      const sole = contenders[0];
      if (sole === undefined) continue;
      awards.push({ seat: sole, amount: pot.amount });
      continue;
    }

    // Find best hand rank using HandRankOrder
    const bestRank = pipe(
      contenders,
      A.reduce(-Infinity, (best, seat) => {
        const hand = playerHands.get(seat);
        if (hand === undefined) return best;
        return hand.rank > best ? hand.rank : best;
      }),
    );

    const winnerSeats = pipe(
      contenders,
      A.filter((s) => {
        const hand = playerHands.get(s);
        return hand !== undefined && hand.rank === bestRank;
      }),
    );

    const potAmount = chipsToNumber(pot.amount);
    const share = Math.floor(potAmount / winnerSeats.length);
    const remainder = potAmount - share * winnerSeats.length;

    const clockwiseFromButton = clockwiseOrder(buttonSeat, seatOrder);
    const oddChipRecipient = clockwiseFromButton.find((s) =>
      winnerSeats.includes(s),
    );

    for (const seat of winnerSeats) {
      const extra = seat === oddChipRecipient ? remainder : 0;
      awards.push({ seat, amount: makeChips(share + extra) });
    }
  }

  return awards;
}

// ---------------------------------------------------------------------------
// clockwiseOrder — internal helper
// ---------------------------------------------------------------------------

function clockwiseOrder(
  buttonSeat: SeatIndex,
  seatOrder: readonly SeatIndex[],
): readonly SeatIndex[] {
  const btnIdx = seatOrder.indexOf(buttonSeat);
  if (btnIdx === -1) return seatOrder;

  const afterButton = (btnIdx + 1) % seatOrder.length;
  return [
    ...seatOrder.slice(afterButton),
    ...seatOrder.slice(0, afterButton),
  ];
}

// ---------------------------------------------------------------------------
// totalPotSize
// ---------------------------------------------------------------------------

export function totalPotSize(pots: readonly Pot[]): Chips {
  return pipe(
    pots,
    A.reduce(ZERO_CHIPS, (sum, p) => addChips(sum, p.amount)),
  );
}
