# texasholdem

A modular, functional Texas Hold'em poker engine built with [Effect-TS](https://effect.website/).

Immutable state transitions, typed errors, branded domain types, and event logging — no mutation, no thrown strings, no callbacks.

## Features

- **Immutable state machine** — `(state, action) => newState`, every transition returns a new state
- **Typed errors** — `Data.TaggedError` hierarchy for exhaustive pattern matching
- **Branded types** — `Chips`, `SeatIndex`, `HandId` prevent mixing up numbers at compile time
- **Event log** — every game action is recorded as a `GameEvent` for hand history / observability
- **Automatic phase advancement** — betting round completion triggers the next phase (deal, showdown) automatically
- **Side pots** — correct multi-way all-in pot splitting with odd-chip distribution
- **Configurable** — 2-10 seat tables, custom blinds/antes
- **Minimal Effect usage** — only deck shuffle is effectful; everything else is pure functions / `Either`
- **Hand evaluation** — delegated to [pokersolver](https://github.com/goldfire/pokersolver) behind a clean abstraction

## Install

```bash
npm install texasholdem
# or
pnpm add texasholdem
```

**Peer dependency:** `effect` ^3.12

## Quick Start

### Strategy-based game loop (recommended)

The simplest way to run poker hands — define a strategy function and let the engine drive the loop:

```typescript
import { Effect, Either } from "effect";
import {
  Chips,
  SeatIndex,
  createTable,
  sitDown,
  playGame,
  fromSync,
  stopAfterHands,
  Check,
  Call,
  Fold,
} from "texasholdem";

// 1. Create a table and seat players
let table = Either.getOrThrow(
  createTable({
    maxSeats: 6,
    forcedBets: { smallBlind: Chips(5), bigBlind: Chips(10) },
  })
);
for (const i of [0, 1, 2, 3]) {
  table = Either.getOrThrow(sitDown(table, SeatIndex(i), Chips(1000)));
}

// 2. Define a strategy — receives full positional context
const myStrategy = fromSync((ctx) => {
  if (ctx.legalActions.canCheck) return Check;
  return Call;
});

// 3. Run 100 hands
const result = Effect.runSync(
  playGame(myStrategy, {
    stopWhen: stopAfterHands(100),
    onEvent: (ev) => console.log(ev._tag),
    defaultAction: Fold,
  })(table)
);

console.log(`Played ${result.handsPlayed} hands`);
```

### Manual loop (full control)

For UI-driven games, bots with external I/O, or when you need to control each action individually:

```typescript
import { Effect, Either, Option } from "effect";
import {
  Chips,
  SeatIndex,
  createTable,
  sitDown,
  startNextHand,
  tableAct,
  getActivePlayer,
  getTableLegalActions,
  Check,
  Call,
} from "texasholdem";

// 1. Create a table
const table = Either.getOrThrow(
  createTable({
    maxSeats: 6,
    forcedBets: { smallBlind: Chips(5), bigBlind: Chips(10) },
  })
);

// 2. Seat players
let state = Either.getOrThrow(sitDown(table, SeatIndex(0), Chips(1000)));
state = Either.getOrThrow(sitDown(state, SeatIndex(1), Chips(1000)));
state = Either.getOrThrow(sitDown(state, SeatIndex(2), Chips(1000)));

// 3. Start a hand (effectful — shuffles the deck)
state = Effect.runSync(startNextHand(state));

// 4. Game loop — act until the hand is complete
while (Option.isSome(getActivePlayer(state))) {
  const seat = getActivePlayer(state).value;
  const legal = Option.getOrThrow(getTableLegalActions(state));

  // Pick an action based on legal moves
  const action = legal.canCheck ? Check : Call;

  state = Either.getOrThrow(tableAct(state, seat, action));
}

// 5. Hand is complete — check results
console.log(`Hand finished. Events: ${state.events.length}`);
```

## Architecture

14 modules in strict bottom-up dependency order:

```
brand.ts ─── card.ts ─── deck.ts ───────────────────┐
   │            │                                     │
   │            └── evaluator.ts (pokersolver wrap)   │
   │                                                  │
   ├── player.ts ── action.ts ── event.ts             │
   │                   │            │                  │
   │                   └── pot.ts ──┤                  │
   │                        │       │                  │
   │                   betting.ts ──┘                  │
   │                        │                          │
   │                   hand.ts ────────────────────────┘
   │                        │
   └─────────────────  table.ts
                         │    │
                  position.ts  │
                         │     │
                       loop.ts
                         │
                     index.ts (barrel exports)
```

### Module Summary

| Module | Purpose |
|--------|---------|
| `brand` | Branded types: `Chips`, `SeatIndex`, `HandId` with runtime validation |
| `card` | `Card`, `Rank`, `Suit`, `ALL_CARDS`, pokersolver string conversion |
| `deck` | Shuffle (the only `Effect`), draw, deal hole cards / community cards |
| `evaluator` | Hand ranking via pokersolver — `evaluate`, `compare`, `winners` |
| `player` | Immutable player state + transitions: `placeBet`, `fold`, `winChips` |
| `action` | `Action` union (Fold/Check/Call/Bet/Raise/AllIn) + `LegalActions` computation |
| `event` | `GameEvent` discriminated union — full hand history in state |
| `error` | `PokerError` hierarchy via `Data.TaggedError` |
| `pot` | Side-pot calculation, pot merging, award distribution with odd-chip handling |
| `betting` | Betting round state machine: turn order, completion detection, action validation |
| `hand` | Full hand lifecycle: Preflop → Flop → Turn → River → Showdown → Complete |
| `table` | Multi-hand session: seating, button movement, busted player removal |
| `position` | Positional roles (`Button`, `UTG`, `CO`, …) and `StrategyContext` builder |
| `loop` | Strategy-driven game loop: `playHand`, `playGame`, timeout/fallback handling |

## API Overview

### Game Loop (strategy-driven)

The highest-level API — define a strategy function and the engine handles dealing, betting rounds, phase advancement, and multi-hand sessions automatically.

```typescript
// Strategy receives full context, returns an action
type Strategy = (ctx: StrategyContext) => Effect.Effect<Action>
type SyncStrategy = (ctx: StrategyContext) => Action

// Wrap a synchronous function as a Strategy
fromSync(fn: SyncStrategy): Strategy

// Drive a single hand (table must already have a hand started)
playOneHand(strategy, opts?): (state: TableState) => Effect<PlayHandResult, PokerError>

// Start + drive a single hand
playHand(strategy, opts?): (state: TableState) => Effect<PlayHandResult, PokerError>

// Multi-hand loop — keeps dealing until a stop condition is met
playGame(strategy, opts?): (state: TableState) => Effect<PlayGameResult, PokerError>
```

**Options:**

```typescript
interface PlayHandOptions {
  actionTimeout?: Duration.DurationInput  // e.g. "5 seconds"
  defaultAction?: Action | ((ctx: StrategyContext) => Action)
  onEvent?: (event: GameEvent) => void
  maxActionsPerHand?: number              // default 500 (safety circuit breaker)
}

interface PlayGameOptions extends PlayHandOptions {
  stopWhen?: StopCondition
  maxHands?: number  // default 10_000
}
```

**Built-in stop conditions:**

```typescript
stopAfterHands(n: number): StopCondition
stopWhenFewPlayers(min?: number): StopCondition  // default min = 2
```

**Built-in strategies:**

```typescript
alwaysFold: Strategy      // folds every hand
passiveStrategy: Strategy // checks when possible, calls otherwise
```

**Resilience:** when a strategy returns an invalid action, the engine applies a three-level fallback: (1) the returned action, (2) `defaultAction` if provided, (3) Check > Call > Fold. Strategies never need to be defensive about illegal moves.

### Strategy Context

Every strategy call receives a `StrategyContext` — everything a decision-maker needs:

```typescript
interface StrategyContext {
  // Identity
  seat: SeatIndex
  chips: Chips
  holeCards: Option<readonly [Card, Card]>

  // Position
  role: PositionalRole      // "Button" | "SmallBlind" | "BigBlind" | "UTG" | "UTG1" | "UTG2" | "LJ" | "HJ" | "CO"
  buttonSeat: SeatIndex
  smallBlindSeat: SeatIndex
  bigBlindSeat: SeatIndex
  playersToActAfter: number

  // Hand state
  phase: Phase              // "Preflop" | "Flop" | "Turn" | "River" | "Showdown" | "Complete"
  communityCards: Card[]
  potTotal: Chips
  bigBlind: Chips
  activeSeatCount: number   // non-folded, non-busted players

  // Action
  legalActions: LegalActions
  players: PlayerView[]     // all players visible state
  newEvents: GameEvent[]    // events since your last action
}
```

Positional roles are assigned automatically based on player count (2–10), following standard poker conventions (heads-up: Button = SB).

### Table-Level (multi-hand sessions)

```typescript
createTable(config: TableConfig): Either<TableState, InvalidConfig>
sitDown(state, seat, chips): Either<TableState, SeatOccupied | TableFull>
standUp(state, seat): Either<TableState, SeatEmpty | HandInProgress>
startNextHand(state): Effect<TableState, PokerError>
tableAct(state, seat, action): Either<TableState, PokerError>
getActivePlayer(state): Option<SeatIndex>
getTableLegalActions(state): Option<LegalActions>
```

### Hand-Level (single hand)

Lower-level API for controlling a single hand directly. Most users should prefer the Table or Game Loop API.

```typescript
startHand(players, button, forcedBets, handId): Effect<HandState, PokerError>
act(state, seat, action): Either<HandState, PokerError>
activePlayer(state): Option<SeatIndex>
getLegalActions(state): Option<LegalActions>
currentPhase(state): Phase
getEvents(state): readonly GameEvent[]
isComplete(state): boolean
```

### Actions

```typescript
Fold              // Give up the hand
Check             // Pass (when no bet to match)
Call              // Match the current bet
Bet({ amount })   // Open betting (branded Chips)
Raise({ amount }) // Raise over current bet (branded Chips)
AllIn              // Put all remaining chips in
```

### LegalActions

Tells a strategy what moves are currently valid:

```typescript
interface LegalActions {
  canFold: boolean
  canCheck: boolean
  callAmount: Option<Chips>   // None = no bet to match
  minBet: Option<Chips>       // available when no prior bet (opening aggression)
  maxBet: Option<Chips>
  minRaise: Option<Chips>     // available when a bet already exists
  maxRaise: Option<Chips>
  canAllIn: boolean
  allInAmount: Chips
}
```

### Events

Every state change is recorded as a `GameEvent` — a full hand history / audit log:

```typescript
type GameEvent =
  | HandStarted | BlindsPosted | HoleCardsDealt
  | PlayerActed | BettingRoundEnded
  | CommunityCardsDealt | ShowdownStarted
  | PotAwarded | HandEnded
  | PlayerSatDown | PlayerStoodUp
```

Use `state.events` for table-level events, or the `onEvent` callback in the game loop for real-time streaming.

## Effect-TS Usage

| Where | What | Why |
|-------|------|-----|
| `deck.ts` shuffle | `Effect<Deck>` | Randomness is a side effect |
| `hand.ts` startHand | `Effect<HandState, PokerError>` | Calls shuffle |
| `table.ts` startNextHand | `Effect<TableState, PokerError>` | Calls startHand |
| `loop.ts` playHand / playGame | `Effect<Result, PokerError>` | Orchestrates effectful hand starts + strategy calls |
| Everything else | Pure functions / `Either` | No side effects needed |
| Branded types | `Brand.refined` | Compile-time + runtime safety |
| Errors | `Data.TaggedError` | Pattern-matchable typed errors |

No `Layer`/`Context`/`Service` — this is a library, not an application.

## Testing

```bash
pnpm test          # run all tests
pnpm test:watch    # watch mode
pnpm typecheck     # tsc --noEmit
```

132 tests across 21 files:
- **Unit tests** — focused scenarios per module
- **Property-based tests** — fast-check verifies invariants (chip conservation, betting termination, phase progression) across thousands of random inputs
- **Integration tests** — end-to-end scenarios through the public API

## License

MIT
