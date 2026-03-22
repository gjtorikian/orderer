export enum States {
  READY_TO_BUY = "READY_TO_BUY",
  BUYING = "BUYING",
  READY_TO_SELL = "READY_TO_SELL",
  SELLING = "SELLING",
}

export enum TradingMode {
  PERCENTAGE = "PERCENTAGE",
  FIXED = "FIXED",
}

export interface CurrentTrade {
  price: number;
  quantity: number;
  symbol: string;
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
  ready: boolean;
}
