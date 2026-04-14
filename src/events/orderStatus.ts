import { TWILIO_CONFIG, WinCounterMax } from "../config/constants";
import { type GlobalState, States } from "../types";
import { log } from "../utils/logger";
import { isCancelled, performSell, stopBuyMonitor } from "../utils/trading";

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
  const fullyCancelled: boolean = isCancelled(status) && filled == 0;

  // Check if this is either a buy order or one of the sell orders (profit target or stop loss)
  const isBuyOrder: boolean = globalState.lastOrderId == orderId;
  const isProfitTargetOrder: boolean = globalState.profitTargetOrderId == orderId;
  const isStopLossOrder: boolean = globalState.stopLossOrderId == orderId;
  const isSellOrder: boolean = isProfitTargetOrder || isStopLossOrder;

  if (
    isBuyOrder &&
    (unfulfilledCancelled || remaining == 0)
  ) {
    if (unfulfilledCancelled) {
      globalState.state = States.BUYING;
    }

    if (globalState.state == States.BUYING) {
      globalState.latestOrderFilled = true;
      stopBuyMonitor(ib, globalState);

      // set price to sell off of avgFillPrice, not original order submitted price
      // this includes cost of commissions etc
      globalState.currentTrade.price = avgFillPrice;

      // if cancelled, use quantity of what was actually bought
      if (unfulfilledCancelled) {
        globalState.currentTrade.quantity = filled;
      }

      log("Entering SELLING state");
      globalState.lastOrderId = 0;
      globalState.stopLossOrderId = 0;
      globalState.profitTargetOrderId = 0;
      globalState.state = States.SELLING;

      // Directly call performSell - no need to call reqIds() every time
      performSell(ib, globalState);
    }
  } else if (
    isSellOrder &&
    globalState.state == States.SELLING &&
    (unfulfilledCancelled || remaining == 0)
  ) {
    globalState.notifiedOfShort = false;
    globalState.state = States.READY_TO_BUY;

    // Determine if this was a profit or loss
    const wasProfit: boolean = isProfitTargetOrder;
    const wasLoss: boolean = isStopLossOrder;

    setTimeout(async (): Promise<void> => {
      // Only increment win counter if profit target hit
      if (wasProfit) {
        globalState.winTimes++;
      }

      const orderType: string = wasProfit ? "PROFIT" : "STOP LOSS";
      const text: string = `${orderType}: Sold order #${orderId} (${globalState.winTimes} / ${WinCounterMax})`;
      log(text);

      if (WinCounterMax <= 5 || globalState.winTimes % 5 == 0 || wasLoss) {
        await twilio.messages.create({
          body: text,
          to: TWILIO_CONFIG.myNumber,
          from: TWILIO_CONFIG.twilioNumber,
        });
      }
    }, 3000);
  }
}
