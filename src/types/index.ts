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
  LOOP = "LOOP",
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

export interface LoopSession {
  /** Eastern date (YYYY-MM-DD) this session belongs to */
  date: string;
  /** Regular-session open and close, minutes since midnight Eastern (0 when closed) */
  open: number;
  close: number;
  /** IB lists the exchange as CLOSED for the day (holiday or weekend) */
  closed: boolean;
}

export interface LoopState {
  /** Eastern date (YYYY-MM-DD) the win counter belongs to; it resets when this changes */
  day: string;
  /** IB confirmed no leftover order or position in LOOP_SYMBOL since the last (re)connect */
  preflightOk: boolean;
  preflightBusy: boolean;
  nextPreflightAt: number;
  blockAnnounced: boolean;
  /** Today's regular session from IB contract details, or null until fetched */
  session: LoopSession | null;
  sessionBusy: boolean;
  nextSessionFetchAt: number;
  buyBusy: boolean;
  /** Earliest time the next buy may be placed (backoff after a rejection) */
  nextBuyAt: number;
  buyPlacedAt: number;
  /** When the loop asked IB to cancel the working buy, 0 if it has not */
  cancelRequestedAt: number;
  /** Why the loop stopped itself for the day, or null while running */
  halted: string | null;
  haltAnnounced: boolean;
  doneAnnounced: boolean;
  lastLogAt: Map<string, number>;
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
  /** Self-driving round-trip state for LOOP mode */
  loop: LoopState;
}
