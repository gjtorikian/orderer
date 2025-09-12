import type { GlobalState } from "../types";

export function handleOpenOrder(
  globalState: GlobalState,
  _orderId: number,
  _contract: any,
  _order: any,
  _orderState: any,
): void {
  // Check open orders
  globalState.openOrders++;
}
