/**
 * Effect-based pull-model game loop for Texas Hold'em.
 *
 * Provides Strategy types and functions to drive hands and multi-hand games.
 *
 * @module
 */

import { Duration, Effect, Either, HashMap, Option, Schema, identity } from "effect";

import type { Action } from "./action.js";
import { Fold, Check, Call } from "./action.js";
import type { GameEvent } from "./event.js";
import type { PokerError } from "./error.js";
import type { TableState } from "./table.js";
import {
  startNextHand,
  act as tableAct,
  getActivePlayer,
  getTableLegalActions,
} from "./table.js";
import type { StrategyContext } from "./position.js";
import { buildStrategyContext } from "./position.js";
import { chipsToNumber } from "./brand.js";

// ---------------------------------------------------------------------------
// Function types — plain TypeScript (Schema can't represent functions)
// ---------------------------------------------------------------------------

export type Strategy = (ctx: StrategyContext) => Effect.Effect<Action>;
export type SyncStrategy = (ctx: StrategyContext) => Action;
export type StopCondition = (state: TableState, handsPlayed: number) => boolean;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface PlayHandOptions {
  readonly actionTimeout?: Duration.DurationInput;
  readonly defaultAction?: Action | ((ctx: StrategyContext) => Action);
  readonly onEvent?: (event: GameEvent) => void;
  readonly maxActionsPerHand?: number; // default 500
}

export interface PlayGameOptions extends PlayHandOptions {
  readonly stopWhen?: StopCondition;
  readonly maxHands?: number; // default 10_000
}

// ---------------------------------------------------------------------------
// Result types (Schema.Struct for serializable fields)
// ---------------------------------------------------------------------------

export const PlayHandResultSchema = Schema.Struct({
  actionCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  completed: Schema.Boolean,
});
export type PlayHandResult = Schema.Schema.Type<typeof PlayHandResultSchema> & {
  readonly state: TableState;
};

export const PlayGameResultSchema = Schema.Struct({
  handsPlayed: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});
export type PlayGameResult = Schema.Schema.Type<typeof PlayGameResultSchema> & {
  readonly state: TableState;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function fromSync(fn: SyncStrategy): Strategy {
  return (ctx) => Effect.succeed(fn(ctx));
}

function resolveDefault(
  defaultAction: PlayHandOptions["defaultAction"],
  ctx: StrategyContext,
): Action {
  if (defaultAction === undefined) return Fold;
  if (typeof defaultAction === "function") return defaultAction(ctx);
  return defaultAction;
}

function chooseValidFallback(ctx: StrategyContext): Action {
  if (ctx.legalActions.canCheck) return Check;
  if (Option.isSome(ctx.legalActions.callAmount)) return Call;
  return Fold;
}

// ---------------------------------------------------------------------------
// playOneHand — drive an already-started hand to completion
// ---------------------------------------------------------------------------

export function playOneHand(
  state: TableState,
  strategy: Strategy,
  opts?: PlayHandOptions,
): Effect.Effect<PlayHandResult, PokerError> {
  const maxActions = opts?.maxActionsPerHand ?? 500;

  return Effect.gen(function* () {
    let current = state;
    let actionCount = 0;
    let tableEventsBaseline = current.events.length;
    let lastHandEventCount = Option.isSome(current.currentHand)
      ? current.currentHand.value.events.length
      : 0;

    while (Option.isSome(getActivePlayer(current))) {
      if (actionCount >= maxActions) {
        return { state: current, actionCount, completed: false };
      }

      const seat = getActivePlayer(current);
      if (Option.isNone(seat)) break;

      // Compute new events (delta) since last action
      const newEvents = getNewEvents(current, tableEventsBaseline, lastHandEventCount);

      const ctxOpt = buildStrategyContext(current, seat.value, newEvents);
      if (Option.isNone(ctxOpt)) break;
      const ctx = ctxOpt.value;

      // Get action from strategy (with optional timeout)
      let action: Action;
      if (opts?.actionTimeout !== undefined) {
        action = yield* Effect.timeoutTo(strategy(ctx), {
          duration: opts.actionTimeout,
          onTimeout: () => resolveDefault(opts?.defaultAction, ctx),
          onSuccess: identity,
        });
      } else {
        action = yield* strategy(ctx);
      }

      // Try applying the action
      const result = tableAct(current, seat.value, action);
      if (Either.isRight(result)) {
        current = result.right;
        actionCount++;
        // Fire onEvent for new events
        if (opts?.onEvent) {
          fireNewEvents(current, tableEventsBaseline, lastHandEventCount, opts.onEvent);
        }
        // Update event tracking
        if (Option.isSome(current.currentHand)) {
          lastHandEventCount = current.currentHand.value.events.length;
        } else {
          // Hand completed — events moved to table
          lastHandEventCount = 0;
          tableEventsBaseline = current.events.length;
        }
        continue;
      }

      // Invalid action — try defaultAction
      const fallbackAction = resolveDefault(opts?.defaultAction, ctx);
      const fallbackResult = tableAct(current, seat.value, fallbackAction);
      if (Either.isRight(fallbackResult)) {
        current = fallbackResult.right;
        actionCount++;
        if (opts?.onEvent) {
          fireNewEvents(current, tableEventsBaseline, lastHandEventCount, opts.onEvent);
        }
        if (Option.isSome(current.currentHand)) {
          lastHandEventCount = current.currentHand.value.events.length;
        } else {
          lastHandEventCount = 0;
          tableEventsBaseline = current.events.length;
        }
        continue;
      }

      // defaultAction also invalid — try a valid fallback
      const validFallback = chooseValidFallback(ctx);
      const validResult = tableAct(current, seat.value, validFallback);
      if (Either.isRight(validResult)) {
        current = validResult.right;
        actionCount++;
        if (opts?.onEvent) {
          fireNewEvents(current, tableEventsBaseline, lastHandEventCount, opts.onEvent);
        }
        if (Option.isSome(current.currentHand)) {
          lastHandEventCount = current.currentHand.value.events.length;
        } else {
          lastHandEventCount = 0;
          tableEventsBaseline = current.events.length;
        }
        continue;
      }

      // All fallbacks failed
      return yield* Effect.fail(validResult.left);
    }

    const completed = Option.isNone(current.currentHand) || Option.isNone(getActivePlayer(current));
    return { state: current, actionCount, completed };
  });
}

// ---------------------------------------------------------------------------
// playHand — startNextHand + playOneHand
// ---------------------------------------------------------------------------

export function playHand(
  table: TableState,
  strategy: Strategy,
  opts?: PlayHandOptions,
): Effect.Effect<PlayHandResult, PokerError> {
  return Effect.flatMap(
    startNextHand(table),
    (started) => {
      // Fire onEvent for the initial hand events (HandStarted, BlindsPosted, etc.)
      if (opts?.onEvent && Option.isSome(started.currentHand)) {
        for (const ev of started.currentHand.value.events) {
          opts.onEvent(ev);
        }
      }
      return playOneHand(started, strategy, opts);
    },
  );
}

// ---------------------------------------------------------------------------
// playGame — multi-hand loop
// ---------------------------------------------------------------------------

export function playGame(
  table: TableState,
  strategy: Strategy,
  opts?: PlayGameOptions,
): Effect.Effect<PlayGameResult, PokerError> {
  const maxHands = opts?.maxHands ?? 10_000;
  const stopWhen = opts?.stopWhen;

  return Effect.gen(function* () {
    let current = table;
    let handsPlayed = 0;

    while (handsPlayed < maxHands) {
      if (stopWhen && stopWhen(current, handsPlayed)) {
        break;
      }

      // Check if enough players
      const playerCount = HashMap.size(current.seats);
      if (playerCount < 2) break;

      const result = yield* playHand(current, strategy, opts);
      current = result.state;
      handsPlayed++;

      if (!result.completed) break;
    }

    return { state: current, handsPlayed };
  });
}

// ---------------------------------------------------------------------------
// Stop conditions
// ---------------------------------------------------------------------------

export function stopAfterHands(n: number): StopCondition {
  return (_state, handsPlayed) => handsPlayed >= n;
}

export function stopWhenFewPlayers(min?: number): StopCondition {
  const threshold = min ?? 2;
  return (state) => HashMap.size(state.seats) < threshold;
}

// ---------------------------------------------------------------------------
// Built-in strategies
// ---------------------------------------------------------------------------

export const alwaysFold: Strategy = fromSync(() => Fold);

export const passiveStrategy: Strategy = fromSync((ctx) => {
  if (ctx.legalActions.canCheck) return Check;
  if (Option.isSome(ctx.legalActions.callAmount)) return Call;
  return Fold;
});

// ---------------------------------------------------------------------------
// Event tracking helpers
// ---------------------------------------------------------------------------

function getNewEvents(
  state: TableState,
  tableEventsBaseline: number,
  lastHandEventCount: number,
): readonly GameEvent[] {
  if (Option.isSome(state.currentHand)) {
    const handEvents = state.currentHand.value.events;
    return handEvents.slice(lastHandEventCount);
  }
  return state.events.slice(tableEventsBaseline);
}

function fireNewEvents(
  state: TableState,
  tableEventsBaseline: number,
  lastHandEventCount: number,
  onEvent: (event: GameEvent) => void,
): void {
  const events = getNewEvents(state, tableEventsBaseline, lastHandEventCount);
  for (const ev of events) {
    onEvent(ev);
  }
}
