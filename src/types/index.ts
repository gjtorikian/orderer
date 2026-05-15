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

export interface CurrentTrade {
  price: number;
  quantity: number;
  symbol: string;
}

export interface Slot {
  id: number;
  state: States;
  currentTrade: CurrentTrade;
  lastOrderId: number;
  profitTargetOrderId: number;
  stopLossOrderId: number;
  latestOrderFilled: boolean;
  monitorPrice: number;
  mktDataReqId: number;
}

export interface RegimeState {
  warmupWins: number;
  warmupLosses: number;
  warmupResolved: number;
  hotMode: boolean;
  currentDate: string;
  dailyWins: number;
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
}
