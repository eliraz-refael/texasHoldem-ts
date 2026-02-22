/**
 * Game events for Texas Hold'em.
 *
 * Every state change in a hand is represented as an immutable `GameEvent`.
 * Events form a complete audit log that can be replayed to reconstruct any
 * point in the game.
 *
 * @module
 */

import { Data } from "effect";
import type { Chips, SeatIndex, HandId } from "./brand.js";
import type { Card } from "./card.js";
import type { Action } from "./action.js";

// ---------------------------------------------------------------------------
// GameEvent — Data.TaggedEnum (type-level) + Data.tagged (constructors)
// ---------------------------------------------------------------------------

export type GameEvent = Data.TaggedEnum<{
  HandStarted: { readonly handId: HandId; readonly button: SeatIndex; readonly smallBlind: SeatIndex; readonly bigBlind: SeatIndex; readonly players: readonly SeatIndex[] };
  BlindsPosted: { readonly smallBlind: { readonly seat: SeatIndex; readonly amount: Chips }; readonly bigBlind: { readonly seat: SeatIndex; readonly amount: Chips } };
  HoleCardsDealt: { readonly seat: SeatIndex };
  PlayerActed: { readonly seat: SeatIndex; readonly action: Action };
  BettingRoundEnded: { readonly round: string };
  CommunityCardsDealt: { readonly cards: readonly Card[]; readonly phase: string };
  ShowdownStarted: {};
  PotAwarded: { readonly seat: SeatIndex; readonly amount: Chips; readonly potIndex: number };
  HandEnded: {};
  PlayerSatDown: { readonly seat: SeatIndex; readonly chips: Chips };
  PlayerStoodUp: { readonly seat: SeatIndex };
}>;

// ---------------------------------------------------------------------------
// Constructors via Data.tagged
// ---------------------------------------------------------------------------

export const HandStarted = Data.tagged<Extract<GameEvent, { _tag: "HandStarted" }>>("HandStarted");
export const BlindsPosted = Data.tagged<Extract<GameEvent, { _tag: "BlindsPosted" }>>("BlindsPosted");
export const HoleCardsDealt = Data.tagged<Extract<GameEvent, { _tag: "HoleCardsDealt" }>>("HoleCardsDealt");
export const PlayerActed = Data.tagged<Extract<GameEvent, { _tag: "PlayerActed" }>>("PlayerActed");
export const BettingRoundEnded = Data.tagged<Extract<GameEvent, { _tag: "BettingRoundEnded" }>>("BettingRoundEnded");
export const CommunityCardsDealt = Data.tagged<Extract<GameEvent, { _tag: "CommunityCardsDealt" }>>("CommunityCardsDealt");
export const ShowdownStarted = Data.tagged<Extract<GameEvent, { _tag: "ShowdownStarted" }>>("ShowdownStarted")();
export const PotAwarded = Data.tagged<Extract<GameEvent, { _tag: "PotAwarded" }>>("PotAwarded");
export const HandEnded = Data.tagged<Extract<GameEvent, { _tag: "HandEnded" }>>("HandEnded")();
export const PlayerSatDown = Data.tagged<Extract<GameEvent, { _tag: "PlayerSatDown" }>>("PlayerSatDown");
export const PlayerStoodUp = Data.tagged<Extract<GameEvent, { _tag: "PlayerStoodUp" }>>("PlayerStoodUp");
