import { MaxSpend, WinPercentage } from "../config/constants";
import { type GlobalState, States } from "../types";
import { log } from "./logger";

export function round(value: number, decimals: number): number {
  return Number(Math.round(Number(value + "e" + decimals)) + "e-" + decimals);
}

export function performBuy(
  orderId: number,
  ib: any,
  globalState: GlobalState,
): void {
  const stock: string = globalState.sequence[1];
  const price: number = parseFloat(globalState.sequence[2]);

  let quantity: number = MaxSpend / price;
  quantity = Math.floor(quantity / 10) * 10;

  globalState.currentTrade.symbol = stock;
  globalState.currentTrade.price = price;
  globalState.currentTrade.quantity = quantity;

  log(`Placing buy #${orderId} of ${stock}: ${quantity} @ ${price}`);

  const contract = ib.contract.stock(stock);
  const order = ib.order.limit("BUY", quantity, price);
  globalState.lastOrderId = orderId;

  setTimeout(
    (orderId: number): void => {
      if (!globalState.latestOrderFilled) {
        globalState.latestOrderRes = null;
        log(`Cancelling order #${orderId}`);
        ib.cancelOrder(orderId);
        globalState.state = States.READY_TO_BUY;
      }
      globalState.latestOrderFilled = false;
    },
    7500,
    orderId,
  );

  log(
    `Placing buy #${globalState.lastOrderId} of ${stock}: ${quantity} @ ${price}`,
  );
  ib.placeOrder(orderId, contract, order);
}

export function isCancelled(status: string): boolean {
  return status == "PendingCancel" || /Cancelled$/.test(status);
}

export function performSell(
  orderId: number,
  ib: any,
  globalState: GlobalState,
): void {
  const stock: string = globalState.currentTrade.symbol;
  const quantity: number = globalState.currentTrade.quantity;
  const price: number = round(
    WinPercentage * globalState.currentTrade.price,
    2,
  );

  log(`Placing sell #${orderId} of ${stock}: ${quantity} @ ${price}`);

  const contract = ib.contract.stock(stock);
  const order = ib.order.limit("SELL", quantity, price);
  globalState.lastOrderId = orderId;

  log(
    `Placing sell #${globalState.lastOrderId} of ${stock}: ${quantity} @ ${price}`,
  );
  ib.placeOrder(orderId, contract, order);
}
