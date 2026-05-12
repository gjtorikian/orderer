import * as bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import * as http from "http";
import * as path from "path";

import { IB_CONFIG, port, TWILIO_CONFIG, UseAllCapital, MaxSpendFixed, MaxSpendMultiplier, IBKR_ACCOUNT_ID, TRADING_MODE } from "./config/constants";
import { handleError } from "./events/error";
import { handleNextValidId } from "./events/nextValidId";
import { handleOpenOrder } from "./events/openOrder";
import { handleOpenOrderEnd } from "./events/openOrderEnd";
import { handleOrderStatus } from "./events/orderStatus";
import { handlePosition } from "./events/position";
import { createIndexRoute } from "./routes/index";
import { createMessageRoute } from "./routes/message";
import { createPlaceRoute } from "./routes/place";
import { type GlobalState, States, TradingMode } from "./types";
import { log } from "./utils/logger";
import { findSlotByMktDataReqId } from "./utils/trading";
import { IBApi, EventName, ErrorCode, Contract } from "@stoqey/ib";

const app: express.Application = express();
const server: http.Server = http.createServer(app);

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());
app.use(cors());

const twilio = require("twilio")(
  TWILIO_CONFIG.accountSid,
  TWILIO_CONFIG.authToken,
);

const ib = new IBApi(IB_CONFIG);

const initialMaxSpend = UseAllCapital ? 0 : MaxSpendFixed * MaxSpendMultiplier;

const globalState: GlobalState = {
  state: States.READY_TO_BUY,
  currentTrade: {
    price: 0,
    quantity: 0,
    symbol: "",
  },
  sequence: [],
  openOrders: 0,
  message: "",
  latestOrderRes: null,
  latestOrderResSent: false,
  latestOrderFilled: false,
  notifiedOfShort: false,
  positionsCount: 0,
  lastOrderId: 0,
  stopLossOrderId: 0,
  profitTargetOrderId: 0,
  nextOrderId: 0,
  winTimes: 0,
  maxSpend: initialMaxSpend,
  baseMaxSpend: initialMaxSpend,
  ready: false,
  monitorPrice: 0,
  mktDataReqId: 0,
  direction: "long",
  slots: new Map(),
  regime: {
    warmupLongWins: 0,
    warmupLongLosses: 0,
    warmupResolved: 0,
    hotMode: false,
    currentDate: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
    dailyWins: 0,
    dailyLosses: 0,
  },
};

app.get("/", createIndexRoute(ib));
app.post("/place", createPlaceRoute(globalState, twilio, ib));
app.post("/message", createMessageRoute());

ib.connect();
ib.reqGlobalCancel();

const ACCOUNT_SUMMARY_REQ_ID = 9001;
const RECONNECT_DELAY_MS = 5_000;
let reconnectScheduled = false;

let accountBuyingPower = 0;
let accountRegTEquity = 0; // PreviousDayEquityWithLoanValue
let accountInitMarginReq = 0; // Current initial margin for existing positions

ib.on(
  EventName.accountSummary,
  (reqId: number, account: string, tag: string, value: string, _currency: string): void => {
    if (reqId !== ACCOUNT_SUMMARY_REQ_ID || account !== IBKR_ACCOUNT_ID) return;
    if (tag === "TotalCashValue") {
      if (UseAllCapital) {
        const totalCash = parseFloat(value);
        globalState.maxSpend = Math.max(0, totalCash * MaxSpendMultiplier);
        globalState.baseMaxSpend = globalState.maxSpend;
        log(`Account ${account} TotalCashValue: ${totalCash}, maxSpend set to ${globalState.maxSpend} (multiplier: ${MaxSpendMultiplier})`);
      } else {
        log(`Account ${account} TotalCashValue: ${value}`);
      }
    } else if (tag === "BuyingPower") {
      accountBuyingPower = parseFloat(value);
      log(`Account ${account} BuyingPower: ${value}`);
    } else if (tag === "RegTEquity") {
      accountRegTEquity = parseFloat(value);
      log(`Account ${account} RegTEquity (PrevDayELV): ${value}`);
    } else if (tag === "InitMarginReq") {
      accountInitMarginReq = parseFloat(value);
      log(`Account ${account} InitMarginReq: ${value}`);
    }
  },
);
ib.on(EventName.accountSummaryEnd, (reqId: number): void => {
  if (reqId === ACCOUNT_SUMMARY_REQ_ID) {
    ib.cancelAccountSummary(ACCOUNT_SUMMARY_REQ_ID);
    if (accountBuyingPower > 0 && globalState.maxSpend > accountBuyingPower) {
      log(`maxSpend ${globalState.maxSpend} exceeds BuyingPower ${accountBuyingPower}, capping to ${accountBuyingPower}`);
      globalState.maxSpend = accountBuyingPower;
    }
    // Cap based on available margin: RegTEquity (PreviousDayELV) minus existing margin usage
    // IB rejects orders when PreviousDayELV < total InitMarginReq (existing + new)
    // New order margin at Reg-T 50% = orderValue * 0.5, so max orderValue = availableMargin * 2
    if (accountRegTEquity > 0) {
      const availableMargin = Math.max(0, accountRegTEquity - accountInitMarginReq);
      const maxFromMargin = availableMargin * 2;
      if (globalState.maxSpend > maxFromMargin) {
        log(`maxSpend ${globalState.maxSpend} exceeds available margin capacity ${maxFromMargin} (RegTEquity: ${accountRegTEquity}, InitMarginReq: ${accountInitMarginReq}), capping`);
        globalState.maxSpend = maxFromMargin;
      }
    }
    globalState.ready = true;
    log(`Account summary received. Bot is ready. maxSpend = ${globalState.maxSpend}`);
  }
});

ib.on(EventName.error, (err: Error, code: ErrorCode, reqId: number) => {
  handleError(globalState, ib, err, code, reqId);
}).on(
  EventName.position,
  async (
    _account: string,
    contract: Contract,
    pos: number,
    avgCost?: number,
  ): Promise<void> => {
    await handlePosition(
      globalState,
      twilio,
      _account,
      contract,
      pos,
      avgCost,
    );
  },
);

ib.on(EventName.nextValidId, (orderId: number): void => {
  handleNextValidId(globalState, ib, orderId);
});

ib.on(EventName.connected, (): void => {
  log("IB connected.");
  reconnectScheduled = false;
  // Reset account summary accumulators so reconnect re-derives caps cleanly
  accountBuyingPower = 0;
  accountRegTEquity = 0;
  accountInitMarginReq = 0;
  ib.reqIds();
  ib.reqAccountSummary(ACCOUNT_SUMMARY_REQ_ID, "All", "TotalCashValue,BuyingPower,RegTEquity,InitMarginReq");
  log("Requesting account summary...");
});

ib.on(EventName.disconnected, (): void => {
  log("IB disconnected. Marking bot not-ready and scheduling reconnect.");
  globalState.ready = false;
  if (!reconnectScheduled) {
    reconnectScheduled = true;
    setTimeout(() => {
      log("Attempting IB reconnect...");
      try {
        ib.connect();
      } catch (err: any) {
        log(`IB reconnect attempt threw: ${err?.message ?? err}`);
      } finally {
        reconnectScheduled = false;
      }
    }, RECONNECT_DELAY_MS);
  }
});

ib.on(
  EventName.orderStatus,
  async (
    orderId: number,
    status: string,
    filled: number,
    remaining: number,
    avgFillPrice: number,
    ..._args: any[]
  ): Promise<void> => {
    await handleOrderStatus(
      globalState,
      twilio,
      ib,
      orderId,
      status,
      filled,
      remaining,
      avgFillPrice,
      ..._args,
    );
  },
);

ib.on(
  EventName.openOrder,
  (_orderId: number, _contract: any, _order: any, _orderState: any): void => {
    handleOpenOrder(globalState, _orderId, _contract, _order, _orderState);
  },
);

ib.on(EventName.openOrderEnd, async (): Promise<void | express.Response> => {
  await handleOpenOrderEnd(globalState, ib);
});

// Market data ticks for buy order monitoring
// TickType 4 = LAST (last traded price)
const TICK_TYPE_LAST = 4;
ib.on(EventName.tickPrice, (reqId: number, field: number, value: number): void => {
  if (field !== TICK_TYPE_LAST || value <= 0) return;

  // Route to single-trade monitor (PERCENTAGE/FIXED modes)
  if (reqId === globalState.mktDataReqId) {
    globalState.monitorPrice = value;
    return;
  }

  // Route to slot monitor (SLOTS mode)
  if (TRADING_MODE === TradingMode.SLOTS) {
    const slot = findSlotByMktDataReqId(globalState, reqId);
    if (slot) {
      slot.monitorPrice = value;
    }
  }
});

server.listen(port, (): void => {
  log(`Listening on ${port}`);
});
