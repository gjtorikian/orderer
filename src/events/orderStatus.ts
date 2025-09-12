// Legacy orderStatus handler - now handled by IBKRMonitor
// This is kept for compatibility but functionality moved to IBKRMonitor

import { TWILIO_CONFIG, WinCounterMax } from "../config/constants";
import { type GlobalState, States } from "../types";
import { log } from "../utils/logger";
import { isCancelled } from "../utils/trading";

export async function handleOrderStatus(
  globalState: GlobalState,
  twilio: any,
  orderId: number | string,
  status: string,
  filled: number,
  remaining: number,
  avgFillPrice: number,
  ..._args: any[]
): Promise<void> {
  log(`Legacy orderStatus handler called - this should be handled by IBKRMonitor`);
  log(`Order ${orderId}: ${status}, filled: ${filled}, remaining: ${remaining}, avgPrice: ${avgFillPrice}`);
  
  // For debugging purposes, we'll keep this basic implementation
  // but the real logic is now in IBKRMonitor.handleTradeUpdate()
  
  const unfulfilledCancelled: boolean =
    isCancelled(status) && remaining != 0 && avgFillPrice > 0;

  if (
    globalState.lastOrderId?.toString() == orderId.toString() &&
    (unfulfilledCancelled || remaining == 0)
  ) {
    if (unfulfilledCancelled) {
      globalState.state = States.BUYING;
    }

    if (globalState.state == States.BUYING) {
      globalState.latestOrderFilled = true;
      globalState.state = States.READY_TO_SELL;
      globalState.currentTrade.price = avgFillPrice;

      if (unfulfilledCancelled) {
        globalState.currentTrade.quantity = filled;
      }
    } else if (globalState.state == States.SELLING) {
      globalState.notifiedOfShort = false;
      globalState.state = States.READY_TO_BUY;
      
      setTimeout(async (): Promise<void> => {
        globalState.winTimes++;
        const text: string = `Sold order #${orderId} (${globalState.winTimes} / ${WinCounterMax})`;
        log(text);
        await twilio.messages.create({
          body: text,
          to: TWILIO_CONFIG.myNumber,
          from: TWILIO_CONFIG.twilioNumber,
        });
      }, 3000);
    }
  }
}