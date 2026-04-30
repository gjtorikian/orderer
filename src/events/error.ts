import { type GlobalState, States, TradingMode } from "../types";
import { TRADING_MODE } from "../config/constants";
import { error, log } from "../utils/logger";
import { findSlotByOrderId, stopBuyMonitor } from "../utils/trading";

// Order rejection codes — order never made it onto the book and never will
const ORDER_REJECTION_CODES = new Set<number>([
  110, // Price does not conform to minimum price variation
  201, // Order rejected
  321, // Error validating request (e.g., size does not conform to market rule)
  478, // Order rejected by exchange
]);

// Market data subscription missing — monitor will not get ticks; fall back to 5m hard cancel
const MKT_DATA_SUBSCRIPTION_CODES = new Set<number>([10089, 10090, 10091, 10168]);

export function handleError(
  globalState: GlobalState,
  ib: any,
  err: Error,
  code: any,
  reqId: number,
): void {
  const data: string = JSON.stringify(code, null, 2);
  const codeNum: number = code?.code;

  // 202: "An active order on the IB server was cancelled."
  // 10148: "An attempt was made to cancel an order that had already been filled by the system."
  // 1100/1102: connectivity issues
  if (
    code &&
    codeNum != 202 &&
    codeNum != 10148 &&
    codeNum != 1100 &&
    codeNum != 1102
  ) {
    error(`${err.message} - code: ${data} - reqId: ${reqId}`);
  }

  if (codeNum && MKT_DATA_SUBSCRIPTION_CODES.has(codeNum)) {
    log(
      `Market data subscription missing for reqId ${reqId}; price-based cancels disabled, will rely on 5m hard cancel`,
    );
    return;
  }

  if (codeNum && ORDER_REJECTION_CODES.has(codeNum)) {
    freeStateForRejectedOrder(globalState, ib, reqId);
  }
}

function freeStateForRejectedOrder(
  globalState: GlobalState,
  ib: any,
  orderId: number,
): void {
  if (TRADING_MODE === TradingMode.SLOTS) {
    const slot = findSlotByOrderId(globalState, orderId);
    if (!slot) return;

    if (slot.lastOrderId === orderId) {
      log(`[Slot ${slot.id}] Order #${orderId} rejected by IBKR; freeing slot`);
      if (slot.mktDataReqId) {
        ib.cancelMktData(slot.mktDataReqId);
      }
      globalState.slots.delete(slot.id);
    }
    return;
  }

  // PERCENTAGE / FIXED modes
  if (globalState.lastOrderId !== orderId) return;

  log(`Order #${orderId} rejected by IBKR; resetting state to READY_TO_BUY`);
  stopBuyMonitor(ib, globalState);

  if (globalState.latestOrderRes && !globalState.latestOrderResSent) {
    try {
      globalState.latestOrderRes.status(502).send(`Order rejected by IBKR (code ${orderId})`);
    } catch {
      // response may already be closed
    }
    globalState.latestOrderResSent = true;
  }

  globalState.latestOrderRes = null;
  globalState.latestOrderFilled = false;
  globalState.lastOrderId = 0;
  globalState.state = States.READY_TO_BUY;
}
