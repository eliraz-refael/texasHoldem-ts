/**
 * Effect-based pull-model game loop for Texas Hold'em.
 *
 * Provides Strategy types and functions to drive hands and multi-hand games.
 *
 * @module
 */

import { Duration, Effect, Either, HashMap, Option, Schema, pipe, identity } from "effect";

import type { Action } from "./action";
import { Fold, Check, Call } from "./action";
import type { GameEvent } from "./event";
import type { PokerError } from "./error";
import type { SeatIndex } from "./brand";
import type { TableState } from "./table";
import {
  startNextHand,
  act as tableAct,
  getActivePlayer,
} from "./table";
import type { StrategyContext } from "./position";
import { buildStrategyContext } from "./position";

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

const resolveDefault =
  (defaultAction: PlayHandOptions["defaultAction"]) =>
  (ctx: StrategyContext): Action => {
    if (defaultAction === undefined) return Fold;
    if (typeof defaultAction === "function") return defaultAction(ctx);
    return defaultAction;
  };

function chooseValidFallback(ctx: StrategyContext): Action {
  if (ctx.legalActions.canCheck) return Check;
  if (Option.isSome(ctx.legalActions.callAmount)) return Call;
  return Fold;
}

// ---------------------------------------------------------------------------
// Loop state records
// ---------------------------------------------------------------------------

interface LoopState {
  readonly state: TableState;
  readonly actionCount: number;
  readonly tableEventsBaseline: number;
  readonly lastHandEventCount: number;
}

interface GameLoopState {
  readonly state: TableState;
  readonly handsPlayed: number;
  readonly completed: boolean;
}

// ---------------------------------------------------------------------------
// Event tracking
// ---------------------------------------------------------------------------

function getNewEvents(
  state: TableState,
  tableEventsBaseline: number,
  lastHandEventCount: number,
): readonly GameEvent[] {
  if (Option.isSome(state.currentHand)) {
    return state.currentHand.value.events.slice(lastHandEventCount);
  }
  return state.events.slice(tableEventsBaseline);
}

const updateEventTracking =
  (onEvent?: (event: GameEvent) => void) =>
  (
    newState: TableState,
    prev: LoopState,
  ): Pick<LoopState, "tableEventsBaseline" | "lastHandEventCount"> => {
    if (onEvent) {
      for (const ev of getNewEvents(newState, prev.tableEventsBaseline, prev.lastHandEventCount)) {
        onEvent(ev);
      }
    }
    if (Option.isSome(newState.currentHand)) {
      return {
        tableEventsBaseline: prev.tableEventsBaseline,
        lastHandEventCount: newState.currentHand.value.events.length,
      };
    }
    return {
      tableEventsBaseline: newState.events.length,
      lastHandEventCount: 0,
    };
  };

const fireInitialEvents =
  (onEvent?: (event: GameEvent) => void) =>
  (state: TableState): Effect.Effect<void> =>
    Effect.sync(() => {
      if (onEvent && Option.isSome(state.currentHand)) {
        for (const ev of state.currentHand.value.events) {
          onEvent(ev);
        }
      }
    });

// ---------------------------------------------------------------------------
// Action application with fallback
// ---------------------------------------------------------------------------

const tryApplyAction =
  (state: TableState, seat: SeatIndex) =>
  (action: Action): Effect.Effect<TableState, PokerError> =>
    pipe(
      tableAct(state, seat, action),
      Either.match({
        onLeft: (e) => Effect.fail(e),
        onRight: (s) => Effect.succeed(s),
      }),
    );

// ---------------------------------------------------------------------------
// Strategy decorator
// ---------------------------------------------------------------------------

const withTimeout =
  (opts?: PlayHandOptions) =>
  (strategy: Strategy): Strategy => {
    if (opts?.actionTimeout === undefined) return strategy;
    const duration = opts.actionTimeout;
    const getDefault = resolveDefault(opts.defaultAction);
    return (ctx) =>
      Effect.timeoutTo(strategy(ctx), {
        duration,
        onTimeout: () => getDefault(ctx),
        onSuccess: identity,
      });
  };

// ---------------------------------------------------------------------------
// Single action step
// ---------------------------------------------------------------------------

const stepOneAction =
  (strategy: Strategy, opts?: PlayHandOptions) => {
    const getDefault = resolveDefault(opts?.defaultAction);
    const trackEvents = updateEventTracking(opts?.onEvent);
    const getAction = withTimeout(opts)(strategy);

    return (ls: LoopState): Effect.Effect<LoopState, PokerError> => {
      const seatOpt = getActivePlayer(ls.state);
      if (Option.isNone(seatOpt)) return Effect.die("unreachable: no active player");

      const seat = seatOpt.value;
      const newEvents = getNewEvents(ls.state, ls.tableEventsBaseline, ls.lastHandEventCount);
      const ctxOpt = buildStrategyContext(ls.state, seat, newEvents);
      if (Option.isNone(ctxOpt)) return Effect.die("unreachable: no strategy context");

      const ctx = ctxOpt.value;
      const tryAction = tryApplyAction(ls.state, seat);

      return pipe(
        getAction(ctx),
        Effect.flatMap((action) =>
          pipe(
            tryAction(action),
            Effect.orElse(() => tryAction(getDefault(ctx))),
            Effect.orElse(() => tryAction(chooseValidFallback(ctx))),
          ),
        ),
        Effect.map((newState) => ({
          ...trackEvents(newState, ls),
          state: newState,
          actionCount: ls.actionCount + 1,
        })),
      );
    };
  };

// ---------------------------------------------------------------------------
// playOneHand — drive an already-started hand to completion
// ---------------------------------------------------------------------------

export const playOneHand =
  (strategy: Strategy, opts?: PlayHandOptions) => {
    const maxActions = opts?.maxActionsPerHand ?? 500;
    const step = stepOneAction(strategy, opts);

    return (state: TableState): Effect.Effect<PlayHandResult, PokerError> => {
      const initial: LoopState = {
        state,
        actionCount: 0,
        tableEventsBaseline: state.events.length,
        lastHandEventCount: Option.isSome(state.currentHand)
          ? state.currentHand.value.events.length
          : 0,
      };

      return pipe(
        Effect.iterate(initial, {
          while: (ls) => ls.actionCount < maxActions && Option.isSome(getActivePlayer(ls.state)),
          body: step,
        }),
        Effect.map((ls): PlayHandResult => ({
          state: ls.state,
          actionCount: ls.actionCount,
          completed: Option.isNone(ls.state.currentHand) || Option.isNone(getActivePlayer(ls.state)),
        })),
      );
    };
  };

// ---------------------------------------------------------------------------
// playHand — startNextHand + playOneHand
// ---------------------------------------------------------------------------

export const playHand =
  (strategy: Strategy, opts?: PlayHandOptions) => {
    const fireEvents = fireInitialEvents(opts?.onEvent);
    const runHand = playOneHand(strategy, opts);

    return (table: TableState): Effect.Effect<PlayHandResult, PokerError> =>
      pipe(
        startNextHand(table),
        Effect.tap(fireEvents),
        Effect.flatMap(runHand),
      );
  };

// ---------------------------------------------------------------------------
// playGame — multi-hand loop
// ---------------------------------------------------------------------------

export const playGame =
  (strategy: Strategy, opts?: PlayGameOptions) => {
    const maxHands = opts?.maxHands ?? 10_000;
    const stopWhen = opts?.stopWhen;
    const runHand = playHand(strategy, opts);

    return (table: TableState): Effect.Effect<PlayGameResult, PokerError> => {
      const initial: GameLoopState = {
        state: table,
        handsPlayed: 0,
        completed: true,
      };

      return pipe(
        Effect.iterate(initial, {
          while: (gs) =>
            gs.completed
            && gs.handsPlayed < maxHands
            && HashMap.size(gs.state.seats) >= 2
            && !(stopWhen?.(gs.state, gs.handsPlayed)),
          body: (gs) =>
            pipe(
              runHand(gs.state),
              Effect.map((result): GameLoopState => ({
                state: result.state,
                handsPlayed: gs.handsPlayed + 1,
                completed: result.completed,
              })),
            ),
        }),
        Effect.map((gs): PlayGameResult => ({
          state: gs.state,
          handsPlayed: gs.handsPlayed,
        })),
      );
    };
  };

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
