/**
 * Positional context for Texas Hold'em.
 *
 * Pure module — no Effect, no side effects. All types Schema-first.
 *
 * @module
 */

import { Option, Schema } from "effect";

import type { Chips, SeatIndex } from "./brand.js";
import {
  Chips as makeChips,
  SeatIndexSchema,
  ChipsSchema,
  chipsToNumber,
  ZERO_CHIPS,
} from "./brand.js";
import { CardSchema } from "./card.js";
import { LegalActionsSchema } from "./action.js";
import type { LegalActions } from "./action.js";
import type { Player } from "./player.js";
import type { HandState, Phase } from "./hand.js";
import { activePlayer as handActivePlayer } from "./hand.js";
import { getLegalActions as handGetLegalActions } from "./hand.js";
import type { GameEvent } from "./event.js";
import type { TableState } from "./table.js";

// ---------------------------------------------------------------------------
// PositionalRole
// ---------------------------------------------------------------------------

export const PositionalRoleSchema = Schema.Literal(
  "Button", "SmallBlind", "BigBlind",
  "UTG", "UTG1", "UTG2", "LJ", "HJ", "CO",
);
export type PositionalRole = Schema.Schema.Type<typeof PositionalRoleSchema>;

// ---------------------------------------------------------------------------
// PlayerView
// ---------------------------------------------------------------------------

export const PlayerViewSchema = Schema.Struct({
  seatIndex: SeatIndexSchema,
  chips: ChipsSchema,
  currentBet: ChipsSchema,
  isFolded: Schema.Boolean,
  isAllIn: Schema.Boolean,
  role: PositionalRoleSchema,
});
export type PlayerView = Schema.Schema.Type<typeof PlayerViewSchema>;

// ---------------------------------------------------------------------------
// StrategyContext
// ---------------------------------------------------------------------------

export const StrategyContextSchema = Schema.Struct({
  // Identity
  seat: SeatIndexSchema,
  chips: ChipsSchema,
  holeCards: Schema.Option(Schema.Tuple(CardSchema, CardSchema)),

  // Position
  role: PositionalRoleSchema,
  buttonSeat: SeatIndexSchema,
  smallBlindSeat: SeatIndexSchema,
  bigBlindSeat: SeatIndexSchema,
  playersToActAfter: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),

  // Hand state
  phase: Schema.Literal("Preflop", "Flop", "Turn", "River", "Showdown", "Complete"),
  communityCards: Schema.Array(CardSchema),
  potTotal: ChipsSchema,
  bigBlind: ChipsSchema,
  activeSeatCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),

  // Action
  legalActions: LegalActionsSchema,
  players: Schema.Array(PlayerViewSchema),
  newEvents: Schema.Array(Schema.Unknown),
});
export type StrategyContext = Schema.Schema.Type<typeof StrategyContextSchema>;

// ---------------------------------------------------------------------------
// Role derivation
// ---------------------------------------------------------------------------

const FULL_ROLE_SEQUENCE: readonly PositionalRole[] = [
  "Button", "SmallBlind", "BigBlind",
  "UTG", "UTG1", "UTG2", "LJ", "HJ", "CO",
] as const;

/**
 * Build the role array for a given number of players.
 *
 * Index 0 = Button. For heads-up, index 0 = Button/SB, index 1 = BB.
 */
function roleSequenceForSize(n: number): readonly PositionalRole[] {
  if (n <= 0) return [];
  if (n === 1) return ["Button"];
  if (n === 2) return ["Button", "BigBlind"];

  // n >= 3: Button, SB, BB, then fill from UTG onward
  const roles: PositionalRole[] = ["Button", "SmallBlind", "BigBlind"];
  const remaining = n - 3;

  // Middle positions are assigned from the end of FULL_ROLE_SEQUENCE
  // For n=4: UTG
  // For n=5: UTG, CO
  // For n=6: UTG, HJ, CO
  // For n=7: UTG, LJ, HJ, CO
  // For n=8: UTG, UTG1, LJ, HJ, CO
  // For n=9: UTG, UTG1, UTG2, LJ, HJ, CO
  const middleRoles: PositionalRole[] = ["UTG", "UTG1", "UTG2", "LJ", "HJ", "CO"];
  // We need `remaining` roles from the middle pool.
  // Take from the end so that CO is always present, then HJ, etc.
  if (remaining <= middleRoles.length) {
    // For 1 remaining: UTG
    // For 2 remaining: UTG, CO
    // For 3 remaining: UTG, HJ, CO
    // etc.
    if (remaining === 1) {
      roles.push("UTG");
    } else {
      // Always start with UTG, then pick from the end
      roles.push("UTG");
      const fromEnd = remaining - 1; // how many more besides UTG
      const tail = middleRoles.slice(middleRoles.length - fromEnd);
      roles.push(...tail);
    }
  }

  return roles;
}

/**
 * Get the positional role for a specific seat in a seat order.
 *
 * seatOrder is already button-first (from HandState.seatOrder).
 */
export function getPositionalRole(
  seatOrder: readonly SeatIndex[],
  seat: SeatIndex,
): PositionalRole {
  const roles = roleSequenceForSize(seatOrder.length);
  const idx = seatOrder.indexOf(seat);
  if (idx === -1 || idx >= roles.length) return "Button";
  const role = roles[idx];
  return role === undefined ? "Button" : role;
}

/**
 * Get the small blind seat from a seat order.
 *
 * Heads-up: button (index 0) is SB. Multi-way: index 1 is SB.
 */
export function getSmallBlindSeat(seatOrder: readonly SeatIndex[]): SeatIndex {
  if (seatOrder.length === 0) {
    throw new Error("getSmallBlindSeat: empty seatOrder");
  }
  if (seatOrder.length === 2) {
    // Heads-up: button is SB
    const seat = seatOrder[0];
    if (seat === undefined) throw new Error("getSmallBlindSeat: seatOrder[0] undefined");
    return seat;
  }
  const seat = seatOrder[1];
  if (seat === undefined) {
    const fallback = seatOrder[0];
    if (fallback === undefined) throw new Error("getSmallBlindSeat: seatOrder empty");
    return fallback;
  }
  return seat;
}

/**
 * Get the big blind seat from a seat order.
 *
 * Heads-up: index 1 is BB. Multi-way: index 2 is BB.
 */
export function getBigBlindSeat(seatOrder: readonly SeatIndex[]): SeatIndex {
  if (seatOrder.length === 0) {
    throw new Error("getBigBlindSeat: empty seatOrder");
  }
  if (seatOrder.length <= 2) {
    const seat = seatOrder[seatOrder.length - 1];
    if (seat === undefined) throw new Error("getBigBlindSeat: last seat undefined");
    return seat;
  }
  const seat = seatOrder[2];
  if (seat === undefined) {
    const fallback = seatOrder[seatOrder.length - 1];
    if (fallback === undefined) throw new Error("getBigBlindSeat: seatOrder empty");
    return fallback;
  }
  return seat;
}

/**
 * Count how many players are left to act after the given seat in the current betting round.
 */
export function getPlayersToActAfter(state: HandState, seat: SeatIndex): number {
  if (Option.isNone(state.bettingRound)) return 0;
  const br = state.bettingRound.value;
  const idx = br.activeSeatOrder.indexOf(seat);
  if (idx === -1) return 0;
  // Players after this seat in the active order
  return br.activeSeatOrder.length - idx - 1;
}

/**
 * Compute positional roles for all seats in a seat order.
 */
export function computePositionalRoles(
  seatOrder: readonly SeatIndex[],
): ReadonlyMap<SeatIndex, PositionalRole> {
  const roles = roleSequenceForSize(seatOrder.length);
  const map = new Map<SeatIndex, PositionalRole>();
  for (let i = 0; i < seatOrder.length; i++) {
    const seat = seatOrder[i];
    if (seat === undefined) continue;
    const role = i < roles.length ? roles[i] : undefined;
    map.set(seat, role === undefined ? "Button" : role);
  }
  return map;
}

/**
 * Convert a Player to a PlayerView with the given role.
 */
export function toPlayerView(player: Player, role: PositionalRole): PlayerView {
  return {
    seatIndex: player.seatIndex,
    chips: player.chips,
    currentBet: player.currentBet,
    isFolded: player.isFolded,
    isAllIn: player.isAllIn,
    role,
  };
}

/**
 * Build a StrategyContext for a seat in the current hand.
 *
 * Returns None if no hand is in progress or the seat is not in the hand.
 */
export function buildStrategyContext(
  table: TableState,
  seat: SeatIndex,
  newEvents: readonly GameEvent[],
): Option.Option<StrategyContext> {
  if (Option.isNone(table.currentHand)) return Option.none();

  const hand = table.currentHand.value;
  const player = hand.players.find((p) => p.seatIndex === seat);
  if (player === undefined) return Option.none();

  const roles = computePositionalRoles(hand.seatOrder);
  const role = roles.get(seat);
  if (role === undefined) return Option.none();

  const sbSeat = getSmallBlindSeat(hand.seatOrder);
  const bbSeat = getBigBlindSeat(hand.seatOrder);
  const playersAfter = getPlayersToActAfter(hand, seat);

  // Compute pot total from player bets + existing pots
  let potTotal = 0;
  for (const p of hand.players) {
    potTotal += chipsToNumber(p.currentBet);
  }
  for (const pot of hand.pots) {
    potTotal += chipsToNumber(pot.amount);
  }

  const activePlayers = hand.players.filter((p) => !p.isFolded);

  const playerViews: PlayerView[] = hand.players.map((p) => {
    const pRole = roles.get(p.seatIndex);
    return toPlayerView(p, pRole === undefined ? "Button" : pRole);
  });

  const legalOpt = handGetLegalActions(hand);
  const defaultLegal: LegalActions = {
    canFold: false,
    canCheck: false,
    callAmount: Option.none(),
    minBet: Option.none(),
    maxBet: Option.none(),
    minRaise: Option.none(),
    maxRaise: Option.none(),
    canAllIn: false,
    allInAmount: ZERO_CHIPS,
  };
  const legalActions = Option.isSome(legalOpt) ? legalOpt.value : defaultLegal;

  const ctx: StrategyContext = {
    seat,
    chips: player.chips,
    holeCards: player.holeCards,
    role,
    buttonSeat: hand.button,
    smallBlindSeat: sbSeat,
    bigBlindSeat: bbSeat,
    playersToActAfter: playersAfter,
    phase: hand.phase,
    communityCards: [...hand.communityCards],
    potTotal: makeChips(potTotal),
    bigBlind: hand.forcedBets.bigBlind,
    activeSeatCount: activePlayers.length,
    legalActions,
    players: playerViews,
    newEvents: [...newEvents],
  };

  return Option.some(ctx);
}
