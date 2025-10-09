import * as bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import * as http from "http";
import * as path from "path";

import { IB_CONFIG, port, TWILIO_CONFIG } from "./config/constants";
import { handleError } from "./events/error";
import { handleNextValidId } from "./events/nextValidId";
import { handleOpenOrder } from "./events/openOrder";
import { handleOpenOrderEnd } from "./events/openOrderEnd";
import { handleOrderStatus } from "./events/orderStatus";
import { handlePosition } from "./events/position";
import { createIndexRoute } from "./routes/index";
import { createMessageRoute } from "./routes/message";
import { createPlaceRoute } from "./routes/place";
import { type GlobalState, States } from "./types";
import { log } from "./utils/logger";
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
  winTimes: 0,
};

app.get("/", createIndexRoute(ib));
app.post("/place", createPlaceRoute(globalState, twilio, ib));
app.post("/message", createMessageRoute());

ib.connect();

ib.on(EventName.error, (err: Error, code: ErrorCode, reqId: number) => {
  handleError(err, code, reqId);
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

server.listen(port, (): void => {
  log(`Listening on ${port}`);
});
