import { Contract, Order, OrderAction, OrderType, SecType, TimeInForce } from "@stoqey/ib";
import { MaxSpend, WinPercentage, LossPercentage, IBKR_ACCOUNT_ID, TRADING_MODE, FixedProfitAmount, FixedLossAmount } from "../config/constants";
import { type GlobalState, States, TradingMode } from "../types";
import { log } from "./logger";
import crypto from 'node:crypto';

export function round(value: number, decimals: number): number {
  return Number(Math.round(Number(value + "e" + decimals)) + "e-" + decimals);
}

export function performBuy(
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

  // Use and increment the next order ID
  const orderId = globalState.nextOrderId++;

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
}

export function isCancelled(status: string): boolean {
  return status == "PendingCancel" || /Cancelled$/.test(status);
}

export function performSell(
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

  // Use and increment the next order ID for both orders
  const profitOrderId = globalState.nextOrderId++;
  const stopLossOrderId = globalState.nextOrderId++;

  // Create OCA group identifier
  const ocaGroup: string = `OCA_${profitOrderId}_${crypto.randomBytes(6).toString('hex')}`;

  // Order 1: Profit Target (Limit Order)
  const profitOrder: Order = {
    orderType: OrderType.LMT,
    action: OrderAction.SELL,
    lmtPrice: profitPrice,
    orderId: profitOrderId,
    totalQuantity: quantity,
    account: IBKR_ACCOUNT_ID,
    tif: TimeInForce.GTC,
    transmit: true,  // Transmit order immediately
    outsideRth: true,
    ocaGroup,
    ocaType: 1,  // Cancel all remaining orders on fill
  };

  // Order 2: Stop Loss
  const stopLossOrder: Order = {
    orderType: OrderType.STP,  // Stop order
    action: OrderAction.SELL,
    auxPrice: stopLossPrice,  // Stop trigger price
    orderId: stopLossOrderId,
    totalQuantity: quantity,
    account: IBKR_ACCOUNT_ID,
    tif: TimeInForce.GTC,
    transmit: true,  // Transmit order immediately
    outsideRth: true,
    ocaGroup,
    ocaType: 1,  // Cancel all remaining orders on fill
  };

  log(`Placing OCA sell orders for ${stock}: ${quantity} shares`);
  log(`  Profit target #${profitOrderId}: LIMIT @ ${profitPrice}`);
  log(`  Stop loss #${stopLossOrderId}: STOP @ ${stopLossPrice}`);

  // Place both orders
  ib.placeOrder(profitOrderId, contract, profitOrder);
  ib.placeOrder(stopLossOrderId, contract, stopLossOrder);

  // Track both order IDs
  globalState.lastOrderId = profitOrderId;
  globalState.stopLossOrderId = stopLossOrderId;
}
