// Legacy openOrder handler - now handled by IBKRMonitor
// This function is kept for compatibility

import type { GlobalState } from "../types";
import { log } from "../utils/logger";

export function handleOpenOrder(
  globalState: GlobalState,
  _orderId: number | string,
  _contract: any,
  _order: any,
  _orderState: any,
): void {
  log(`Legacy openOrder handler called - this should be handled by IBKRMonitor`);
  
  // Legacy implementation for debugging
  globalState.openOrders++;
}