export * from "./brand.js";
export * from "./card.js";
export * from "./deck.js";
export * from "./evaluator.js";
export * from "./player.js";
export * from "./action.js";
export * from "./event.js";
export * from "./error.js";
export * from "./pot.js";

// Re-export betting with namespace prefix to avoid conflicts with hand/table
export {
  type BettingRoundState,
  createBettingRound,
  applyAction as bettingApplyAction,
  getLegalActions as bettingGetLegalActions,
  activePlayer as bettingActivePlayer,
  getPlayer as bettingGetPlayer,
  updatePlayer as bettingUpdatePlayer,
} from "./betting.js";

export * from "./hand.js";

// Re-export table with explicit names to avoid conflicts with hand module
export {
  type TableConfig,
  type TableState,
  createTable,
  sitDown,
  standUp,
  startNextHand,
  act as tableAct,
  getActivePlayer,
  getTableLegalActions,
} from "./table.js";

export * from "./position.js";

export {
  type Strategy,
  type SyncStrategy,
  type StopCondition,
  type PlayHandOptions,
  type PlayHandResult,
  type PlayGameOptions,
  type PlayGameResult,
  fromSync,
  playOneHand,
  playHand,
  playGame,
  stopAfterHands,
  stopWhenFewPlayers,
  alwaysFold,
  passiveStrategy,
} from "./loop.js";
