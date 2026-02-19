# holdem-engine

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
npm install holdem-engine
# or
pnpm add holdem-engine
```

**Peer dependency:** `effect` ^3.12

## Quick Start

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
  Call,
  Fold,
  Check,
} from "holdem-engine";

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

12 modules in strict bottom-up dependency order:

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

## API Overview

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

## Effect-TS Usage

| Where | What | Why |
|-------|------|-----|
| `deck.ts` shuffle | `Effect<Deck>` | Randomness is a side effect |
| `hand.ts` startHand | `Effect<HandState, PokerError>` | Calls shuffle |
| `table.ts` startNextHand | `Effect<TableState, PokerError>` | Calls startHand |
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
