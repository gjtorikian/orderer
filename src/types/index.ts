export enum States {
  READY_TO_BUY = "READY_TO_BUY",
  BUYING = "BUYING",
  READY_TO_SELL = "READY_TO_SELL",
  SELLING = "SELLING",
}

export enum TradingMode {
  PERCENTAGE = "PERCENTAGE",
  FIXED = "FIXED",
  SLOTS = "SLOTS",
}

export type TradeDirection = "long" | "short";

export interface PredictionMetrics {
  boxRatio: number;
  thrust: number;
  acceleration: number;
  velocity: number;
  onBalanceRun: number;
  vwapGain: number;
}

export interface CurrentTrade {
  price: number;
  quantity: number;
  symbol: string;
}

export interface Slot {
  id: number;
  state: States;
  direction: TradeDirection;
  currentTrade: CurrentTrade;
  lastOrderId: number;
  profitTargetOrderId: number;
  stopLossOrderId: number;
  latestOrderFilled: boolean;
  monitorPrice: number;
  mktDataReqId: number;
}

export interface RegimeState {
  /** Consecutive wins at start of day (for warmup detection) */
  earlyWins: number;
  /** Consecutive losses at start of day */
  earlyLosses: number;
  /** Total resolved trades today (wins + losses) */
  todayResolved: number;
  /** Whether hot mode is active for the rest of the day */
  hotMode: boolean;
  /** Date string (YYYY-MM-DD) to detect day rollover */
  currentDate: string;
  /** Daily wins for tracking */
  dailyWins: number;
  /** Daily losses for tracking */
  dailyLosses: number;
}

export interface GlobalState {
  state: States;
  currentTrade: CurrentTrade;
  sequence: string[];
  openOrders: number;
  message: string;
  latestOrderRes: any | null;
  latestOrderResSent: boolean;
  latestOrderFilled: boolean;
  notifiedOfShort: boolean;
  positionsCount: number;
  lastOrderId: number;
  stopLossOrderId: number;
  profitTargetOrderId: number;
  nextOrderId: number;
  winTimes: number;
  maxSpend: number;
  /** Base maxSpend before regime multiplier (set once from account data) */
  baseMaxSpend: number;
  ready: boolean;
  /** Latest market price from tick data, used by buy order monitor */
  monitorPrice: number;
  /** reqId for the active market data subscription, 0 if none */
  mktDataReqId: number;
  /** Active slots for SLOTS mode, keyed by slot id */
  slots: Map<number, Slot>;
  /** Adaptive regime state for intraday scaling */
  regime: RegimeState;
  /** Metrics from the current prediction (passed by caller) */
  pendingMetrics: PredictionMetrics | null;
}
