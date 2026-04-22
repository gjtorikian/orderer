import { TWILIO_CONFIG, WinCounterMax, TRADING_MODE, MaxSlots } from "../config/constants";
import { type GlobalState, States, TradingMode } from "../types";
import { log } from "../utils/logger";
import { isCancelled, performSell, stopBuyMonitor, findSlotByOrderId, performSlotSell } from "../utils/trading";
import { updateRegime } from "../utils/regime";

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
  if (TRADING_MODE === TradingMode.SLOTS) {
    return handleSlotOrderStatus(globalState, twilio, ib, orderId, status, filled, remaining, avgFillPrice);
  }

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

async function handleSlotOrderStatus(
  globalState: GlobalState,
  twilio: any,
  ib: any,
  orderId: number,
  status: string,
  filled: number,
  remaining: number,
  avgFillPrice: number,
): Promise<void> {
  const unfulfilledCancelled: boolean =
    isCancelled(status) && remaining != 0 && avgFillPrice > 0;

  const slot = findSlotByOrderId(globalState, orderId);
  if (!slot) return;

  const isBuyOrder = slot.lastOrderId === orderId;
  const isProfitTargetOrder = slot.profitTargetOrderId === orderId;
  const isStopLossOrder = slot.stopLossOrderId === orderId;
  const isSellOrder = isProfitTargetOrder || isStopLossOrder;

  if (isBuyOrder && (unfulfilledCancelled || remaining == 0)) {
    if (unfulfilledCancelled) {
      slot.state = States.BUYING;
    }

    if (slot.state === States.BUYING) {
      slot.latestOrderFilled = true;

      // Stop market data for this slot
      if (slot.mktDataReqId) {
        ib.cancelMktData(slot.mktDataReqId);
        slot.mktDataReqId = 0;
        slot.monitorPrice = 0;
      }

      slot.currentTrade.price = avgFillPrice;

      if (unfulfilledCancelled) {
        slot.currentTrade.quantity = filled;
      }

      log(`[Slot ${slot.id}] Buy filled for ${slot.currentTrade.symbol}, entering SELLING`);
      slot.lastOrderId = 0;
      slot.state = States.SELLING;

      performSlotSell(ib, globalState, slot);
    }
  } else if (isSellOrder && slot.state === States.SELLING && (unfulfilledCancelled || remaining == 0)) {
    const wasProfit = isProfitTargetOrder;
    const symbol = slot.currentTrade.symbol;
    const direction = slot.direction;

    // Free the slot — position is closed, opens a spot for next bet
    globalState.slots.delete(slot.id);

    // Update adaptive regime
    updateRegime(globalState, wasProfit);

    setTimeout(async (): Promise<void> => {
      if (wasProfit) {
        globalState.winTimes++;
      }

      const orderType: string = wasProfit ? "PROFIT" : "STOP LOSS";
      const dirLabel = direction === "short" ? " (SHORT)" : "";
      const regime = globalState.regime.hotMode ? " [HOT]" : "";
      const slotsActive = globalState.slots.size;
      const text: string = `[Slot] ${orderType}${dirLabel}${regime}: ${symbol} #${orderId} (active: ${slotsActive}/${MaxSlots}, day: ${globalState.regime.dailyWins}W/${globalState.regime.dailyLosses}L)`;
      log(text);

      if (MaxSlots <= 5 || globalState.winTimes % 5 === 0 || !wasProfit) {
        await twilio.messages.create({
          body: text,
          to: TWILIO_CONFIG.myNumber,
          from: TWILIO_CONFIG.twilioNumber,
        });
      }
    }, 3000);
  }
}
