import { MaxSpend, WinPercentage } from "../config/constants";
import { type GlobalState, States } from "../types";
import { log } from "./logger";
import { IBKRClient } from "./ibkr-client";

export function round(value: number, decimals: number): number {
  return Number(Math.round(Number(value + "e" + decimals)) + "e-" + decimals);
}

export async function performBuy(
  globalState: GlobalState,
): Promise<void> {
  const ibkrClient = IBKRClient.getInstance();
  
  const stock: string = globalState.sequence[1];
  const price: number = parseFloat(globalState.sequence[2]);

  let quantity: number = MaxSpend / price;
  quantity = Math.floor(quantity / 10) * 10;

  globalState.currentTrade.symbol = stock;
  globalState.currentTrade.price = price;
  globalState.currentTrade.quantity = quantity;

  try {
    log(`Creating contract for ${stock}`);
    const contract = await ibkrClient.createContract(stock);
    
    const order = {
      action: 'BUY' as const,
      totalQuantity: quantity,
      orderType: 'LIMIT' as const,
      lmtPrice: price,
      transmit: true
    };

    log(`Placing buy order of ${stock}: ${quantity} @ ${price}`);
    const placedOrder = await ibkrClient.placeOrder(contract, order);
    
    globalState.lastOrderId = placedOrder.orderId || placedOrder.id || `buy-${Date.now()}`;
    log(`Placed buy order #${globalState.lastOrderId}`);

    // Set timeout to cancel if not filled
    setTimeout(
      async (): Promise<void> => {
        if (!globalState.latestOrderFilled) {
          try {
            globalState.latestOrderRes = null;
            log(`Cancelling order #${globalState.lastOrderId}`);
            await ibkrClient.cancelOrder(Number(globalState.lastOrderId));
            globalState.state = States.READY_TO_BUY;
          } catch (err: any) {
            log(`Failed to cancel order: ${err.message}`);
          }
        }
        globalState.latestOrderFilled = false;
      },
      7500
    );

  } catch (err: any) {
    log(`Error placing buy order: ${err.message}`);
    globalState.state = States.READY_TO_BUY;
    throw err;
  }
}

export function isCancelled(status: string): boolean {
  return status == "PendingCancel" || /Cancelled$/.test(status) || status === "Cancelled";
}

export async function performSell(
  globalState: GlobalState,
): Promise<void> {
  const ibkrClient = IBKRClient.getInstance();
  
  const stock: string = globalState.currentTrade.symbol;
  const quantity: number = globalState.currentTrade.quantity;
  const price: number = round(
    WinPercentage * globalState.currentTrade.price,
    2,
  );

  try {
    log(`Creating contract for sell order ${stock}`);
    const contract = await ibkrClient.createContract(stock);
    
    const order = {
      action: 'SELL' as const,
      totalQuantity: quantity,
      orderType: 'LIMIT' as const,
      lmtPrice: price,
      transmit: true
    };

    log(`Placing sell order of ${stock}: ${quantity} @ ${price}`);
    const placedOrder = await ibkrClient.placeOrder(contract, order);
    
    globalState.lastOrderId = placedOrder.orderId || placedOrder.id || `sell-${Date.now()}`;
    log(`Placed sell order #${globalState.lastOrderId}`);

  } catch (err: any) {
    log(`Error placing sell order: ${err.message}`);
    throw err;
  }
}