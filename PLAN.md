# Texas Hold'em Engine - Implementation Plan

## Context

Build a modular, functional Texas Hold'em poker engine in TypeScript using Effect-TS. Inspired by [poker-ts](https://github.com/claudijo/poker-ts) but improved: immutable state, typed errors, event logging, and composable modules. Hand evaluation delegated to [pokersolver](https://github.com/goldfire/pokersolver) (battle-tested, production-proven) behind a clean abstraction boundary.

**Key improvements over poker-ts:**
- Immutable state transitions (`(state, action) => newState`) instead of mutation
- Typed errors via `Data.TaggedError` instead of thrown strings
- Event log accumulated in state for observability/hand history
- Automatic phase advancement (no manual `endBettingRound()` calls)
- Branded types (`Chips`, `SeatIndex`) prevent mixing up numbers at compile time
- Configurable seat count (poker-ts hardcodes 9)

---

## Module Architecture

12 source files, strict bottom-up dependency order. Each module is independently usable.

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

---

## Module Details

### 1. `brand.ts` — Branded domain types
- `Chips` — non-negative integer (runtime validated via `Brand.refined`)
- `SeatIndex` — valid seat number
- `HandId` — unique hand identifier
- Schema counterparts for each (enables free fast-check arbitraries via `Arbitrary.make`)

### 2. `card.ts` — Card primitives
- `Rank` (2-14), `Suit` ("c"|"d"|"h"|"s") as const objects + union types
- `Card` — readonly `{ rank, suit }` struct
- `ALL_CARDS` — 52-element constant array
- `toPokersolverString(card)` — converts to "Ad", "Th" format

### 3. `deck.ts` — Deck with Effect-based shuffle
- `Deck = readonly Card[]`
- `shuffled: Effect<Deck>` — uses `Random.shuffle` (the **only** effectful operation in the engine)
- `draw(deck, count) => [drawn, remaining]` — pure
- `dealHoleCards(deck, seats) => [Map<SeatIndex, [Card,Card]>, remaining]` — pure
- `dealFlop / dealOne` — pure convenience functions

### 4. `evaluator.ts` — pokersolver wrapper
- `HandRank` — our own type: `{ name, description, rank, bestCards }`
- `evaluate(cards) => HandRank` — wraps `pokersolver.Hand.solve`
- `compare(a, b) => -1|0|1`
- `winners(hands) => HandRank[]`
- `evaluateHoldem(holeCards, communityCards) => HandRank`
- Includes `declare module "pokersolver"` type declarations
- **pokersolver types never leak** — all conversion happens inside this module

### 5. `player.ts` — Immutable player state
- `Player` — readonly struct: `{ seatIndex, chips, currentBet, isAllIn, isFolded, holeCards }`
- Pure transitions: `placeBet`, `fold`, `winChips`, `collectBet`, `dealCards`, `clearHand`
- Derived: `stack(player)` = chips - currentBet, `canAct(player)` = !folded && !allIn

### 6. `action.ts` — Player actions + validation
- `Action` — discriminated union: Fold | Check | Call | Bet | Raise | AllIn
- `LegalActions` — what the active player can do: canFold, canCheck, callAmount, betRange, raiseRange
- `computeLegalActions(player, biggestBet, minRaise)` — pure computation
- `validateAction(action, legalActions) => Either<Error, Action>`

### 7. `event.ts` — Game events (discriminated union)
- `GameEvent` — HandStarted, BlindsPosted, HoleCardsDealt, PlayerActed, BettingRoundEnded, CommunityCardsDealt, ShowdownStarted, PotAwarded, HandEnded, PlayerSatDown, PlayerStoodUp
- Events accumulated in state as a readonly array — no callbacks/event bus needed

### 8. `error.ts` — Typed error hierarchy
- `InvalidAction`, `NotPlayersTurn`, `InvalidGameState`, `InsufficientChips`, `SeatOccupied`
- All extend `Data.TaggedError` for exhaustive pattern matching
- `PokerError` union type

### 9. `pot.ts` — Side-pot calculation
- `Pot` — `{ amount: Chips, eligibleSeats: SeatIndex[] }`
- `collectBets(players, existingPots) => { pots, players }` — the min-bet collection algorithm
- `awardPots(pots, playerHands, buttonSeat) => awards[]` — distributes winnings, odd chips clockwise from button
- `totalPotSize(pots) => Chips`

### 10. `betting.ts` — Betting round state machine
Combines poker-ts's `Round` + `BettingRound` into one module.
- `BettingRoundState` — name, players, activeIndex, activeSeatOrder, biggestBet, minRaise, lastAggressor, isComplete
- `createBettingRound(name, players, firstToAct, biggestBet, minRaise)`
- `applyAction(state, seat, action) => Either<Error, { state, events }>` — validates, applies, advances turn, detects completion
- `getLegalActions(state) => LegalActions`
- `activePlayer(state) => SeatIndex | null`

### 11. `hand.ts` — Full hand lifecycle
The composition point. Manages phases: Preflop → Flop → Turn → River → Showdown → Complete.
- `HandState` — phase, players, communityCards, deck, pots, bettingRound, button, forcedBets, events
- `startHand(players, button, forcedBets) => Effect<HandState>` — effectful (shuffles deck)
- `act(state, seat, action) => Either<Error, HandState>` — **auto-advances** phase when betting round completes (deals community cards, starts next round, triggers showdown)
- `activePlayer`, `currentPhase`, `getLegalActions`, `getEvents` — read-only queries

### 12. `table.ts` — Multi-hand session manager
- `TableState` — config, seats (Map), button, currentHand, handCount, events
- `createTable(config)`, `sitDown`, `standUp`
- `startNextHand(state) => Effect<TableState, PokerError>` — moves button, starts hand
- `act(state, seat, action) => Either<Error, TableState>` — forwards to hand module
- Button movement, busted player removal automatic

---

## Effect-TS Usage Strategy

| Where | What | Why |
|-------|------|-----|
| `deck.ts` shuffled | `Effect<Deck>` | Randomness is a side effect |
| `hand.ts` startHand | `Effect<HandState>` | Calls shuffle |
| `table.ts` startNextHand | `Effect<TableState, PokerError>` | Calls startHand |
| Everything else | Pure functions / `Either` | No side effects needed |
| Branded types | `Brand.refined` | Compile-time + runtime type safety |
| Errors | `Data.TaggedError` | Pattern matchable typed errors |
| Tests | `Random.make` with seed | Deterministic shuffle for reproducible tests |

We deliberately **avoid** `Layer`/`Context`/`Service` — this is a library, not an application.

---

## Testing Strategy

### fast-check property tests (`test/properties/`)

**Pot invariants:**
- Chip conservation: sum of bets in === sum of pot amounts out
- Every non-folded player eligible for at least the main pot
- Side pots created only when bet levels differ (all-in scenarios)

**Betting round invariants:**
- Legal actions always non-empty for active player
- Player chips never go negative
- Total chip count constant throughout a round
- Betting round always terminates (no infinite loops)
- Calling sets bet equal to biggest bet; raising exceeds it

**Hand lifecycle invariants:**
- Phases progress strictly: Preflop → Flop → Turn → River → Showdown → Complete
- Community cards: 0 → 3 → 4 → 5
- Total chips (players + pots) constant throughout hand
- Hand always terminates

### Schema-derived arbitraries
Use `Arbitrary.make(ChipsSchema)`, `Arbitrary.make(CardSchema)` etc. to generate valid domain values for property tests.

### Unit tests per module (`test/*.test.ts`)
Each module gets focused unit tests for specific scenarios: known hand rankings, heads-up blinds, multi-way side pots, etc.

---

## Implementation Order (TDD — Tests First)

For each module: **write tests first**, then implement until tests pass. Build bottom-up.

| Step | Phase 1: Tests | Phase 2: Implementation |
|------|---------------|------------------------|
| 1 | Project setup | package.json, tsconfig, vitest config, install deps |
| 2 | `brand.test.ts` — Chips rejects negatives/floats, SeatIndex validates range | `brand.ts` + `error.ts` |
| 3 | `card.test.ts` — ALL_CARDS has 52 unique, toPokersolverString roundtrips | `card.ts` |
| 4 | `evaluator.test.ts` — known rankings (royal flush > full house), ties, kickers | `evaluator.ts` |
| 5 | `deck.test.ts` — shuffled has 52 unique cards, draw reduces size, empty deck errors | `deck.ts` |
| 6 | `player.test.ts` — bet reduces stack, fold sets flag, can't bet > chips, allIn detection | `player.ts` |
| 7 | `action.test.ts` — legal actions computed correctly for various scenarios | `action.ts` + `event.ts` |
| 8 | `pot.test.ts` + `pot.properties.ts` — side pots, chip conservation property | `pot.ts` |
| 9 | `betting.test.ts` + `betting.properties.ts` — turn order, round completion, chip invariants | `betting.ts` |
| 10 | `hand.test.ts` + `hand.properties.ts` — full hand scenarios, phase progression | `hand.ts` |
| 11 | `table.test.ts` — seating, button movement, multi-hand sessions | `table.ts` |
| 12 | `integration.test.ts` — end-to-end scenarios through public API | `index.ts` |

Each step: write failing tests → implement module → all tests green → move on.

---

## Verification

1. **Unit tests**: `vitest run` — every module has focused tests
2. **Property tests**: fast-check verifies invariants across thousands of random inputs
3. **Integration test**: Full hand scenarios driven through `table.ts`:
   - 2-player heads-up hand (fold preflop)
   - 3-player hand to showdown with side pot
   - Split pot scenario
   - Multiple consecutive hands with button movement
   - Player bust-out and removal
4. **Type safety**: `tsc --noEmit` passes with strict mode — branded types catch misuse at compile time

---

## Project Setup

**Package manager:** pnpm

**Dependencies:**
- `effect` ^3.x — core library
- `pokersolver` ^2.1.4 — hand evaluation

**Dev dependencies:**
- `typescript` ^5.7, `vitest` ^3.x, `fast-check` ^3.x, `@effect/vitest`, `@fast-check/vitest`

**tsconfig:** strict, ES2022 target, NodeNext module, esModuleInterop (for pokersolver CJS)
