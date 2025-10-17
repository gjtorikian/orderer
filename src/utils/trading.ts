import { Contract, Order, OrderAction, OrderType, SecType, TimeInForce } from "@stoqey/ib";
import { MaxSpend, WinPercentage, LossPercentage, IBKR_ACCOUNT_ID, TRADING_MODE, FixedProfitAmount, FixedLossAmount } from "../config/constants";
import { type GlobalState, States, TradingMode } from "../types";
import { log } from "./logger";
import crypto from 'node:crypto';

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

  const contract: Contract = {
    symbol: stock,
    exchange: "SMART",
    currency: "USD",
    secType: SecType.STK,
  };

  const order: Order = {
    orderType: OrderType.LMT,
    action: OrderAction.BUY,
    lmtPrice: price,
    orderId,
    totalQuantity: quantity,
    account: IBKR_ACCOUNT_ID,
    tif: TimeInForce.GTC,
    transmit: true
  };

  ib.placeOrder(orderId, contract, order);
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
  const buyPrice: number = globalState.currentTrade.price;

  // Calculate profit target price
  let profitPrice: number;
  if (TRADING_MODE === TradingMode.PERCENTAGE) {
    profitPrice = round(WinPercentage * buyPrice, 2);
  } else {
    // FIXED mode: calculate price to achieve fixed profit amount
    profitPrice = round(buyPrice + (FixedProfitAmount / quantity), 2);
  }

  // Calculate stop loss price
  let stopLossPrice: number;
  if (TRADING_MODE === TradingMode.PERCENTAGE) {
    stopLossPrice = round(LossPercentage * buyPrice, 2);
  } else {
    // FIXED mode: calculate price for fixed loss amount
    stopLossPrice = round(buyPrice - (FixedLossAmount / quantity), 2);
  }

  const contract: Contract = {
    symbol: stock,
    exchange: "SMART",
    currency: "USD",
    secType: SecType.STK,
  };

  // Create OCA group identifier
  const ocaGroup: string = `OCA_${orderId}_${crypto.randomBytes(6).toString('hex')}`;

  // Order 1: Profit Target (Limit Order)
  const profitOrder: Order = {
    orderType: OrderType.LMT,
    action: OrderAction.SELL,
    lmtPrice: profitPrice,
    orderId,
    totalQuantity: quantity,
    account: IBKR_ACCOUNT_ID,
    tif: TimeInForce.GTC,
    transmit: false,  // Don't transmit yet
    outsideRth: true,
    ocaGroup,
    ocaType: 1,  // Cancel all remaining orders on fill
  };

  // Order 2: Stop Loss
  const stopLossOrder: Order = {
    orderType: OrderType.STP,  // Stop order
    action: OrderAction.SELL,
    auxPrice: stopLossPrice,  // Stop trigger price
    orderId: orderId + 1,
    totalQuantity: quantity,
    account: IBKR_ACCOUNT_ID,
    tif: TimeInForce.GTC,
    transmit: true,  // Transmit both orders
    outsideRth: true,
    ocaGroup,
    ocaType: 1,  // Cancel all remaining orders on fill
  };

  log(`Placing OCA sell orders for ${stock}: ${quantity} shares`);
  log(`  Profit target #${orderId}: LIMIT @ ${profitPrice}`);
  log(`  Stop loss #${orderId + 1}: STOP @ ${stopLossPrice}`);

  // Place both orders
  ib.placeOrder(orderId, contract, profitOrder);
  ib.placeOrder(orderId + 1, contract, stopLossOrder);

  // Track both order IDs
  globalState.lastOrderId = orderId;
  globalState.stopLossOrderId = orderId + 1;
}
