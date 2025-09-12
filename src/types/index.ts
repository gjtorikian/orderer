export enum States {
  READY_TO_BUY = "READY_TO_BUY",
  BUYING = "BUYING",
  READY_TO_SELL = "READY_TO_SELL",
  SELLING = "SELLING",
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
  latestOrderFilled: boolean;
  notifiedOfShort: boolean;
  positionsCount: number;
  lastOrderId: number | string; // IBKR uses string IDs
  winTimes: number;
}

// New IBKR-specific types
export interface IBKROrder {
  orderId?: number | string;
  contract?: any;
  order?: any;
  status?: string;
  filled?: number;
  remaining?: number;
  avgFillPrice?: number;
}

export interface IBKRPosition {
  account: string;
  contract: any;
  position: number;
  avgCost: number;
}

export interface IBKRTrade {
  orderId: number | string;
  execId: string;
  time: string;
  acctNumber: string;
  exchange: string;
  side: 'BOT' | 'SLD';
  shares: number;
  price: number;
  permId: number;
  clientId: number;
  liquidation: number;
  cumQty: number;
  avgPrice: number;
  orderRef: string;
  evRule: string;
  evMultiplier: number;
}
