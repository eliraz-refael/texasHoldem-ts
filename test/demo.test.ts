/**
 * Demo: 10 rounds of 4-player Texas Hold'em using the game loop API
 *
 * Run with: pnpm vitest run demo.test.ts
 */

import { describe, it } from "vitest";
import { Effect, Either, HashMap, Option } from "effect";
import {
  Chips,
  SeatIndex,
  chipsToNumber,
  seatIndexToNumber,
} from "../src/brand.js";
import type { Card } from "../src/card.js";
import type { Action } from "../src/action.js";
import {
  Fold,
  Check,
  Call,
  Bet,
  Raise,
  AllIn,
} from "../src/action.js";
import type { GameEvent } from "../src/event.js";
import {
  createTable,
  sitDown,
} from "../src/table.js";
import type { TableState } from "../src/table.js";
import {
  fromSync,
  playGame,
  stopAfterHands,
} from "../src/loop.js";
import type { StrategyContext } from "../src/position.js";

// ── Card display ──────────────────────────────────────────────────────

const RANK_NAMES: Record<number, string> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9",
  10: "T", 11: "J", 12: "Q", 13: "K", 14: "A",
};
const SUIT_SYMBOLS: Record<string, string> = {
  c: "\u2663", d: "\u2666", h: "\u2665", s: "\u2660",
};

function cardStr(c: Card): string {
  return `${RANK_NAMES[c.rank]}${SUIT_SYMBOLS[c.suit]}`;
}

function cardsStr(cards: readonly Card[]): string {
  return cards.map(cardStr).join(" ");
}

// ── Logging ───────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(msg);
}

function divider() {
  log("\u2500".repeat(60));
}

// ── Simple AI (SyncStrategy) ────────────────────────────────────────

function chooseAction(ctx: StrategyContext): Action {
  const stack = chipsToNumber(ctx.chips);
  const rng = Math.random();

  if (ctx.legalActions.canCheck) {
    if (rng < 0.15 && Option.isSome(ctx.legalActions.minBet)) {
      return Bet({ amount: Chips(chipsToNumber(ctx.legalActions.minBet.value)) });
    }
    return Check;
  }

  if (Option.isSome(ctx.legalActions.callAmount)) {
    const callAmt = chipsToNumber(ctx.legalActions.callAmount.value);

    if (rng < 0.10 && Option.isSome(ctx.legalActions.minRaise)) {
      return Raise({ amount: Chips(chipsToNumber(ctx.legalActions.minRaise.value)) });
    }

    if (callAmt <= stack * 0.3) return Call;
    if (callAmt <= stack * 0.6 && rng < 0.5) return Call;
    if (rng < 0.15) return Call;
  }

  if (ctx.legalActions.canAllIn && rng < 0.03) return AllIn;

  return Fold;
}

function actionStr(action: Action): string {
  switch (action._tag) {
    case "Fold":  return "folds";
    case "Check": return "checks";
    case "Call":  return "calls";
    case "Bet":   return `bets ${chipsToNumber(action.amount)}`;
    case "Raise": return `raises to ${chipsToNumber(action.amount)}`;
    case "AllIn": return "goes ALL-IN!";
  }
}

// ── Event logger ──────────────────────────────────────────────────────

function logEvent(ev: GameEvent) {
  switch (ev._tag) {
    case "HandStarted":
      log(`  > Hand started | Button: Seat ${seatIndexToNumber(ev.button)} | Players: [${ev.players.map(s => seatIndexToNumber(s)).join(", ")}]`);
      break;
    case "BlindsPosted":
      log(`  Blinds: SB Seat ${seatIndexToNumber(ev.smallBlind.seat)} (${chipsToNumber(ev.smallBlind.amount)}) | BB Seat ${seatIndexToNumber(ev.bigBlind.seat)} (${chipsToNumber(ev.bigBlind.amount)})`);
      break;
    case "HoleCardsDealt":
      break;
    case "PlayerActed":
      log(`  -> Seat ${seatIndexToNumber(ev.seat)} ${actionStr(ev.action)}`);
      break;
    case "BettingRoundEnded":
      log(`  -- ${ev.round} betting complete --`);
      break;
    case "CommunityCardsDealt":
      log(`  ${ev.phase}: ${cardsStr(ev.cards)}`);
      break;
    case "ShowdownStarted":
      log(`  Showdown!`);
      break;
    case "PotAwarded":
      log(`  Seat ${seatIndexToNumber(ev.seat)} wins ${chipsToNumber(ev.amount)} from pot #${ev.potIndex}`);
      break;
    case "HandEnded":
      log(`  Hand complete`);
      break;
    default:
      break;
  }
}

// ── Main ──────────────────────────────────────────────────────────────

describe("Texas Hold'em Demo - 10 Rounds (game loop API)", () => {
  it("plays 10 rounds of 4-player poker", () => {
    log("");
    log("TEXAS HOLD'EM ENGINE DEMO");
    log("   4 players, 10 rounds, 5/10 blinds");
    divider();

    let state: TableState = Either.getOrThrow(
      createTable({
        maxSeats: 6,
        forcedBets: { smallBlind: Chips(5), bigBlind: Chips(10) },
      })
    );

    for (const i of [0, 1, 2, 3]) {
      state = Either.getOrThrow(sitDown(state, SeatIndex(i), Chips(1000)));
      log(`Seat ${i} sits down with 1000 chips`);
    }
    divider();

    const result = Effect.runSync(
      playGame(
        state,
        fromSync(chooseAction),
        {
          stopWhen: stopAfterHands(10),
          onEvent: logEvent,
          defaultAction: Fold,
        },
      ),
    );

    state = result.state;
    log(`\nPlayed ${result.handsPlayed} hands`);

    // Final standings
    log("");
    log("=== FINAL STANDINGS ===");
    divider();
    const entries = Array.from(HashMap.entries(state.seats));
    entries.sort((a, b) => chipsToNumber(b[1].chips) - chipsToNumber(a[1].chips));
    let place = 1;
    for (const [seat, player] of entries) {
      const chips = chipsToNumber(player.chips);
      const diff = chips - 1000;
      const sign = diff >= 0 ? "+" : "";
      log(`  #${place}  Seat ${seatIndexToNumber(seat)}: ${chips} chips (${sign}${diff})`);
      place++;
    }
    divider();

    const totalChips = entries.reduce((sum, [, p]) => sum + chipsToNumber(p.chips), 0);
    const bustedCount = 4 - entries.length;
    log(`  Total chips in play: ${totalChips} (started with: ${4 * 1000}) ${totalChips === 4 * 1000 ? "Chips conserved!" : "MISMATCH!"}`);
    if (bustedCount > 0) {
      log(`  ${bustedCount} player(s) busted out during the session`);
    }
    log("");
  });
});
