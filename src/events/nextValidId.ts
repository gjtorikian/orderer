// Legacy nextValidId handler - now handled differently in @stoqey/ibkr
// The new IBKR library handles order IDs internally

import { type GlobalState, States } from "../types";
import { log } from "../utils/logger";
import { performBuy, performSell } from "../utils/trading";

export async function handleNextValidId(
  globalState: GlobalState,
  orderId: string | number,
): Promise<void> {
  log(`Legacy nextValidId handler called with ID ${orderId} in state ${globalState.state}`);
  
  // In the new system, we don't rely on nextValidId events
  // Instead, we trigger buy/sell operations based on state changes
  
  if (globalState.state == States.BUYING) {
    await performBuy(globalState);
  } else if (globalState.state == States.READY_TO_SELL) {
    log("Entering SELLING state");
    globalState.state = States.SELLING;
    await performSell(globalState);
  } else {
    log(`State is ${globalState.state}`);
  }
}