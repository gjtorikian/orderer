import { TRADING_MODE } from "../config/constants";
import { type GlobalState, States, TradingMode } from "../types";
import { log } from "../utils/logger";
import { performBuy, performSell } from "../utils/trading";

export function handleNextValidId(
  globalState: GlobalState,
  ib: any,
  orderId: number,
): void {
  log(`Next order Id ${orderId} in state ${globalState.state}`);

  // Store the next valid order ID
  globalState.nextOrderId = orderId;

  // LOOP mode places its own orders from the tick; re-buying here on a reconnect would double up.
  if (TRADING_MODE === TradingMode.LOOP) return;

  if (globalState.state == States.BUYING) {
    performBuy(ib, globalState);
  } else if (globalState.state == States.READY_TO_SELL) {
    log("Entering SELLING state");
    globalState.lastOrderId = 0;
    globalState.stopLossOrderId = 0;
    globalState.profitTargetOrderId = 0;
    globalState.state = States.SELLING;
    performSell(ib, globalState);
  } else {
    log(`State is ${globalState.state}`);
  }
}
