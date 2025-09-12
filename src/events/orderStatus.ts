import { TWILIO_CONFIG, WinCounterMax } from "../config/constants";
import { type GlobalState, States } from "../types";
import { log } from "../utils/logger";
import { isCancelled } from "../utils/trading";

export async function handleOrderStatus(
  globalState: GlobalState,
  twilio: any,
  ib: any,
  orderId: number,
  status: string,
  filled: number,
  remaining: number,
  avgFillPrice: number,
  ..._args: any[]
): Promise<void> {
  const unfulfilledCancelled: boolean =
    isCancelled(status) && remaining != 0 && avgFillPrice > 0;

  if (
    globalState.lastOrderId == orderId &&
    (unfulfilledCancelled || remaining == 0)
  ) {
    if (unfulfilledCancelled) {
      globalState.state = States.BUYING;
    }

    if (globalState.state == States.BUYING) {
      globalState.latestOrderFilled = true;

      globalState.state = States.READY_TO_SELL;
      // set price to sell off of avgFillPrice, not original order submitted price
      // this includes cost of commissions etc
      globalState.currentTrade.price = avgFillPrice;

      // if cancelled, use quantity of what was actually bought
      if (unfulfilledCancelled) {
        globalState.currentTrade.quantity = filled;
      }

      ib.reqIds(1);
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
