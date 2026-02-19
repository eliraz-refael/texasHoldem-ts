/**
 * Side-pot calculation and award distribution for Texas Hold'em.
 *
 * Implements the standard min-bet collection algorithm to split bets into
 * main pots and side pots when one or more players are all-in for different
 * amounts.  Also provides pot-award logic that handles ties and odd-chip
 * allocation (first player clockwise from button).
 *
 * @module
 */

import type { Chips, SeatIndex } from "./brand.js";
import { Chips as makeChips } from "./brand.js";
import type { HandRank } from "./evaluator.js";

// ---------------------------------------------------------------------------
// Pot type
// ---------------------------------------------------------------------------

/** A single pot (main or side) together with the seats eligible to win it. */
export interface Pot {
  readonly amount: Chips;
  readonly eligibleSeats: readonly SeatIndex[];
}

// ---------------------------------------------------------------------------
// createPot
// ---------------------------------------------------------------------------

/** Construct a {@link Pot} value. */
export function createPot(
  amount: Chips,
  eligibleSeats: readonly SeatIndex[],
): Pot {
  return { amount, eligibleSeats };
}

// ---------------------------------------------------------------------------
// BettingPlayer — local helper type used by collectBets
// ---------------------------------------------------------------------------

/** Minimal player shape required for bet collection. */
export interface BettingPlayer {
  readonly seatIndex: SeatIndex;
  readonly currentBet: Chips;
  readonly isFolded: boolean;
  readonly isAllIn: boolean;
}

// ---------------------------------------------------------------------------
// collectBets
// ---------------------------------------------------------------------------

/**
 * Collect all outstanding bets into pots using the min-bet side-pot algorithm.
 *
 * 1. While any player has `currentBet > 0`:
 *    - Find the smallest non-zero `currentBet` (the min-bet level).
 *    - Subtract that amount from every player whose `currentBet > 0`,
 *      accumulating the total into a new pot.
 *    - The pot's eligible seats are the non-folded players who contributed
 *      at least the min-bet (i.e. their original `currentBet >= minBet`).
 * 2. Merge the newly created pots with `existingPots`:
 *    - If the last existing pot has exactly the same eligible-seat set as
 *      the first new pot, their amounts are combined.
 *    - All remaining new pots are appended.
 * 3. Return the merged pots and a copy of `players` with all `currentBet`
 *    values set to zero.
 */
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
    currentBet: p.currentBet as number,
    isFolded: p.isFolded,
    isAllIn: p.isAllIn,
  }));

  const newPots: Pot[] = [];

  while (mutablePlayers.some((p) => p.currentBet > 0)) {
    // Minimum non-zero bet among all players.
    const minBet = mutablePlayers
      .filter((p) => p.currentBet > 0)
      .reduce(
        (min, p) => (p.currentBet < min ? p.currentBet : min),
        Infinity,
      );

    // Eligible seats: everyone who contributed >= minBet AND is not folded.
    const eligibleSeats = mutablePlayers
      .filter((p) => p.currentBet >= minBet && !p.isFolded)
      .map((p) => p.seatIndex);

    // Collect minBet from every player who still has money in the pot.
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

  // Merge with existing pots.
  const merged = mergePots(existingPots, newPots);

  // Return players with zeroed-out currentBets.
  const zeroedPlayers: readonly BettingPlayer[] = mutablePlayers.map((p) => ({
    seatIndex: p.seatIndex,
    currentBet: makeChips(0),
    isFolded: p.isFolded,
    isAllIn: p.isAllIn,
  }));

  return { pots: merged, players: zeroedPlayers };
}

// ---------------------------------------------------------------------------
// mergePots — internal helper
// ---------------------------------------------------------------------------

/**
 * If the last existing pot shares the exact same eligible-seat set as the
 * first new pot, combine their amounts.  All other new pots are appended.
 */
function mergePots(
  existing: readonly Pot[],
  incoming: readonly Pot[],
): readonly Pot[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming;

  const lastExisting = existing[existing.length - 1]!;
  const firstIncoming = incoming[0]!;

  if (sameSeatSet(lastExisting.eligibleSeats, firstIncoming.eligibleSeats)) {
    const combinedAmount = makeChips(
      (lastExisting.amount as number) + (firstIncoming.amount as number),
    );
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
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((v, i) => v === sortedB[i]);
}

// ---------------------------------------------------------------------------
// awardPots
// ---------------------------------------------------------------------------

/**
 * Determine pot awards for every pot.
 *
 * For each pot:
 * - Find eligible seats that also have a hand in `playerHands`.
 * - If exactly one eligible seat has a hand, they win the full pot.
 * - Otherwise, find the best {@link HandRank} (highest `rank` value) among
 *   the eligible hands.  All seats that share that best rank split the pot
 *   evenly.  Odd chips (the indivisible remainder) go to the first player
 *   clockwise from the button, determined by `seatOrder`.
 *
 * @returns An array of `{ seat, amount }` awards across all pots.
 */
export function awardPots(
  pots: readonly Pot[],
  playerHands: ReadonlyMap<SeatIndex, HandRank>,
  buttonSeat: SeatIndex,
  seatOrder: readonly SeatIndex[],
): readonly { seat: SeatIndex; amount: Chips }[] {
  const awards: { seat: SeatIndex; amount: Chips }[] = [];

  for (const pot of pots) {
    // Only seats that are eligible AND actually have a hand can win.
    const contenders = pot.eligibleSeats.filter((s) => playerHands.has(s));

    if (contenders.length === 0) {
      // Edge case: no one eligible has a hand (shouldn't happen in a well-formed game).
      // Skip this pot — money is effectively dead.
      continue;
    }

    if (contenders.length === 1) {
      awards.push({ seat: contenders[0]!, amount: pot.amount });
      continue;
    }

    // Find the best hand rank among contenders.
    let bestRank = -Infinity;
    for (const seat of contenders) {
      const hand = playerHands.get(seat)!;
      if (hand.rank > bestRank) {
        bestRank = hand.rank;
      }
    }

    // All contenders with the best rank are winners (ties).
    const winnerSeats = contenders.filter(
      (s) => playerHands.get(s)!.rank === bestRank,
    );

    const potAmount = pot.amount as number;
    const share = Math.floor(potAmount / winnerSeats.length);
    const remainder = potAmount - share * winnerSeats.length;

    // Determine clockwise order from button to decide who gets odd chips.
    const clockwiseFromButton = clockwiseOrder(buttonSeat, seatOrder);

    // The first winner in clockwise order gets the odd chips.
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

/**
 * Return `seatOrder` rotated so that the first seat *after* `buttonSeat`
 * comes first (i.e. clockwise from button).
 */
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

/** Sum the amounts of all pots. */
export function totalPotSize(pots: readonly Pot[]): Chips {
  const total = pots.reduce((sum, p) => sum + (p.amount as number), 0);
  return makeChips(total);
}
