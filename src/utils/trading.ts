import { Contract, Order, OrderAction, OrderType, SecType, TimeInForce } from "@stoqey/ib";
import { WinPercentage, LossPercentage, IBKR_ACCOUNT_ID, TRADING_MODE, FixedProfitAmount, FixedLossAmount, SlotProfitAmount, SlotLossAmount, MaxSlots, DisableStopLoss } from "../config/constants";
import { type GlobalState, type Slot, States, TradingMode } from "../types";
import { log } from "./logger";
import crypto from 'node:crypto';

export function round(value: number, decimals: number): number {
  return Number(Math.round(Number(value + "e" + decimals)) + "e-" + decimals);
}

// Market data reqId for buy order monitoring (fixed, only one active at a time)
const MKT_DATA_REQ_ID = 8001;
// Base reqId for slot market data subscriptions (slot 0 = 8100, slot 1 = 8101, etc.)
const SLOT_MKT_DATA_REQ_BASE = 8100;

// Price-based cancel thresholds (from backtest analysis):
//   At 1 min: down >0.2% from entry → cancel (WR drops to ~60%, below breakeven)
//   At 1 min: up >0.5% and unfilled → cancel (stock left without us)
//   At 3 min: still flat ±0.2% → keep waiting (73% WR)
//   At 3 min: down at all → cancel
//   At 5 min: hard cancel backstop
const CHECK_1_MS = 60_000;  // 1 minute
const CHECK_2_MS = 180_000; // 3 minutes
const HARD_CANCEL_MS = 300_000; // 5 minute backstop
const DOWN_CANCEL_PCT = -0.002;  // -0.2%
const UP_MISSED_PCT = 0.005;     // +0.5%

export function performBuy(
  ib: any,
  globalState: GlobalState,
): void {
  const stock: string = globalState.sequence[1];
  const price: number = parseFloat(globalState.sequence[2]);

  const quantity: number = Math.floor(globalState.maxSpend / price);
  if (quantity < 1) {
    log(`Skipping ${stock}: maxSpend ${globalState.maxSpend} / price ${price} = ${quantity} shares`);
    globalState.state = States.READY_TO_BUY;
    if (globalState.latestOrderRes && !globalState.latestOrderResSent) {
      try {
        globalState.latestOrderRes.status(422).send(`Insufficient maxSpend for ${stock} @ ${price}`);
      } catch {
        // response may already be closed
      }
      globalState.latestOrderResSent = true;
    }
    globalState.latestOrderRes = null;
    return;
  }

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

  // Start market data subscription to monitor price
  globalState.monitorPrice = 0;
  globalState.mktDataReqId = MKT_DATA_REQ_ID;
  ib.reqMktData(MKT_DATA_REQ_ID, contract, "", false, false);

  monitorBuyOrder(ib, globalState, orderId, price, stock);
}

export function stopBuyMonitor(ib: any, globalState: GlobalState): void {
  if (globalState.mktDataReqId) {
    ib.cancelMktData(globalState.mktDataReqId);
    globalState.mktDataReqId = 0;
    globalState.monitorPrice = 0;
  }
}

function cancelBuyOrder(ib: any, globalState: GlobalState, orderId: number, reason: string): void {
  stopBuyMonitor(ib, globalState);
  globalState.latestOrderRes = null;
  log(`Cancelling order #${orderId}: ${reason}`);
  ib.cancelOrder(orderId);
  globalState.state = States.READY_TO_BUY;
  globalState.latestOrderFilled = false;
}

function monitorBuyOrder(
  ib: any,
  globalState: GlobalState,
  orderId: number,
  entryPrice: number,
  stock: string,
): void {
  // Check 1: at 1 minute, evaluate price position
  setTimeout((): void => {
    if (globalState.latestOrderFilled) {
      stopBuyMonitor(ib, globalState);
      return;
    }

    const currentPrice = globalState.monitorPrice;
    if (currentPrice <= 0) {
      // No market data received — fall back to hard cancel at 5 min
      log(`Monitor ${stock}: no market data at 1m, waiting...`);
      return;
    }

    const pctMove = (currentPrice - entryPrice) / entryPrice;
    log(`Monitor ${stock} at 1m: entry=${entryPrice} current=${currentPrice} move=${(pctMove * 100).toFixed(2)}%`);

    if (pctMove < DOWN_CANCEL_PCT) {
      // Stock is down >0.2% — 60% WR or worse, below breakeven
      cancelBuyOrder(ib, globalState, orderId, `down ${(pctMove * 100).toFixed(2)}% at 1m`);
      clearTimeout(timer2);
      clearTimeout(hardTimer);
      return;
    }

    if (pctMove > UP_MISSED_PCT) {
      // Stock ran away — 96% WR but we can't catch it
      cancelBuyOrder(ib, globalState, orderId, `up ${(pctMove * 100).toFixed(2)}% at 1m, missed move`);
      clearTimeout(timer2);
      clearTimeout(hardTimer);
      return;
    }

    // Flat (±0.2% to +0.5%) — keep waiting, check again at 3 min
    log(`Monitor ${stock}: flat at 1m (${(pctMove * 100).toFixed(2)}%), holding order`);
  }, CHECK_1_MS);

  // Check 2: at 3 minutes, re-evaluate
  const timer2 = setTimeout((): void => {
    if (globalState.latestOrderFilled) {
      stopBuyMonitor(ib, globalState);
      return;
    }

    const currentPrice = globalState.monitorPrice;
    if (currentPrice <= 0) {
      log(`Monitor ${stock}: no market data at 3m, waiting for hard cancel...`);
      return;
    }

    const pctMove = (currentPrice - entryPrice) / entryPrice;
    log(`Monitor ${stock} at 3m: entry=${entryPrice} current=${currentPrice} move=${(pctMove * 100).toFixed(2)}%`);

    if (pctMove < 0) {
      // Any red at 3 min — cancel (down 0.2-0.5% at 3m = 45% WR)
      cancelBuyOrder(ib, globalState, orderId, `down ${(pctMove * 100).toFixed(2)}% at 3m`);
      clearTimeout(hardTimer);
      return;
    }

    if (pctMove > UP_MISSED_PCT) {
      // Still up and unfilled at 3 min — it's gone
      cancelBuyOrder(ib, globalState, orderId, `up ${(pctMove * 100).toFixed(2)}% at 3m, missed move`);
      clearTimeout(hardTimer);
      return;
    }

    // Still flat/slightly up — the 73% WR zone. Let it ride to hard cancel.
    log(`Monitor ${stock}: flat/up at 3m (${(pctMove * 100).toFixed(2)}%), holding to 5m`);
  }, CHECK_2_MS);

  // Hard backstop: cancel at 5 minutes no matter what
  const hardTimer = setTimeout((): void => {
    if (globalState.latestOrderFilled) {
      stopBuyMonitor(ib, globalState);
      return;
    }
    cancelBuyOrder(ib, globalState, orderId, "5m hard cancel");
  }, HARD_CANCEL_MS);
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
  const entryPrice: number = globalState.currentTrade.price;

  let profitPrice: number;
  if (TRADING_MODE === TradingMode.PERCENTAGE) {
    profitPrice = round(WinPercentage * entryPrice, 2);
  } else {
    profitPrice = round(entryPrice + (FixedProfitAmount / quantity), 2);
  }

  const contract: Contract = {
    symbol: stock,
    exchange: "SMART",
    currency: "USD",
    secType: SecType.STK,
  };

  const profitOrderId = globalState.nextOrderId++;

  // Upside-only mode: place just the profit-target limit sell, no downside stop.
  if (DisableStopLoss) {
    const profitOrder: Order = {
      orderType: OrderType.LMT,
      action: OrderAction.SELL,
      lmtPrice: profitPrice,
      orderId: profitOrderId,
      totalQuantity: quantity,
      account: IBKR_ACCOUNT_ID,
      tif: TimeInForce.GTC,
      transmit: true,
      outsideRth: true,
    };

    log(`Placing upside-only sell for ${stock}: ${quantity} shares`);
    log(`  Profit target #${profitOrderId}: LIMIT @ ${profitPrice} (no stop loss)`);

    ib.placeOrder(profitOrderId, contract, profitOrder);

    globalState.profitTargetOrderId = profitOrderId;
    globalState.stopLossOrderId = 0;
    return;
  }

  let stopLossPrice: number;
  if (TRADING_MODE === TradingMode.PERCENTAGE) {
    stopLossPrice = round(LossPercentage * entryPrice, 2);
  } else {
    stopLossPrice = round(entryPrice - (FixedLossAmount / quantity), 2);
  }

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
    transmit: true,
    outsideRth: true,
    ocaGroup,
    ocaType: 1,
  };

  // Order 2: Stop Loss
  const stopLossOrder: Order = {
    orderType: OrderType.STP,
    action: OrderAction.SELL,
    auxPrice: stopLossPrice,
    orderId: stopLossOrderId,
    totalQuantity: quantity,
    account: IBKR_ACCOUNT_ID,
    tif: TimeInForce.GTC,
    transmit: true,
    outsideRth: true,
    ocaGroup,
    ocaType: 1,
  };

  log(`Placing OCA sell orders for ${stock}: ${quantity} shares`);
  log(`  Profit target #${profitOrderId}: LIMIT @ ${profitPrice}`);
  log(`  Stop loss #${stopLossOrderId}: STOP @ ${stopLossPrice}`);

  // Place both orders
  ib.placeOrder(profitOrderId, contract, profitOrder);
  ib.placeOrder(stopLossOrderId, contract, stopLossOrder);

  // Track both order IDs
  globalState.profitTargetOrderId = profitOrderId;
  globalState.stopLossOrderId = stopLossOrderId;
}

// --- SLOTS mode functions ---

export function getAvailableSlotId(globalState: GlobalState): number | null {
  for (let i = 0; i < MaxSlots; i++) {
    if (!globalState.slots.has(i)) {
      return i;
    }
  }
  return null;
}

export function activeSlotCount(globalState: GlobalState): number {
  return globalState.slots.size;
}

export function findSlotByOrderId(globalState: GlobalState, orderId: number): Slot | undefined {
  for (const slot of globalState.slots.values()) {
    if (slot.lastOrderId === orderId || slot.profitTargetOrderId === orderId || slot.stopLossOrderId === orderId) {
      return slot;
    }
  }
  return undefined;
}

export function findSlotByMktDataReqId(globalState: GlobalState, reqId: number): Slot | undefined {
  for (const slot of globalState.slots.values()) {
    if (slot.mktDataReqId === reqId) {
      return slot;
    }
  }
  return undefined;
}

export function performSlotEntry(
  ib: any,
  globalState: GlobalState,
  slotId: number,
): void {
  const stock: string = globalState.sequence[1];
  const price: number = parseFloat(globalState.sequence[2]);

  const quantity: number = Math.floor(globalState.maxSpend / price);
  if (quantity < 1) {
    log(`[Slot ${slotId}] Skipping ${stock}: maxSpend ${globalState.maxSpend} / price ${price} = ${quantity} shares`);
    return;
  }

  const orderId = globalState.nextOrderId++;
  const mktDataReqId = SLOT_MKT_DATA_REQ_BASE + slotId;

  const slot: Slot = {
    id: slotId,
    state: States.BUYING,
    currentTrade: { symbol: stock, price, quantity },
    lastOrderId: orderId,
    profitTargetOrderId: 0,
    stopLossOrderId: 0,
    latestOrderFilled: false,
    monitorPrice: 0,
    mktDataReqId,
  };

  globalState.slots.set(slotId, slot);

  log(`[Slot ${slotId}] Placing entry #${orderId} of ${stock}: ${quantity} @ ${price}`);

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
    transmit: true,
  };

  ib.placeOrder(orderId, contract, order);

  // Start market data subscription for this slot
  ib.reqMktData(mktDataReqId, contract, "", false, false);

  monitorSlotBuyOrder(ib, globalState, slot, price, stock);
}

function cancelSlotBuyOrder(ib: any, globalState: GlobalState, slot: Slot, reason: string): void {
  if (slot.mktDataReqId) {
    ib.cancelMktData(slot.mktDataReqId);
    slot.mktDataReqId = 0;
    slot.monitorPrice = 0;
  }
  log(`[Slot ${slot.id}] Cancelling order #${slot.lastOrderId}: ${reason}`);
  ib.cancelOrder(slot.lastOrderId);
  // Remove the slot — it's free again
  globalState.slots.delete(slot.id);
}

function monitorSlotBuyOrder(
  ib: any,
  globalState: GlobalState,
  slot: Slot,
  entryPrice: number,
  stock: string,
): void {
  const orderId = slot.lastOrderId;

  setTimeout((): void => {
    if (slot.latestOrderFilled || !globalState.slots.has(slot.id)) return;

    const currentPrice = slot.monitorPrice;
    if (currentPrice <= 0) {
      log(`[Slot ${slot.id}] Monitor ${stock}: no market data at 1m, waiting...`);
      return;
    }

    const pctMove = (currentPrice - entryPrice) / entryPrice;
    log(`[Slot ${slot.id}] Monitor ${stock} at 1m: entry=${entryPrice} current=${currentPrice} move=${(pctMove * 100).toFixed(2)}%`);

    if (pctMove < DOWN_CANCEL_PCT) {
      cancelSlotBuyOrder(ib, globalState, slot, `down ${(pctMove * 100).toFixed(2)}% at 1m`);
      clearTimeout(timer2);
      clearTimeout(hardTimer);
      return;
    }

    if (pctMove > UP_MISSED_PCT) {
      cancelSlotBuyOrder(ib, globalState, slot, `up ${(pctMove * 100).toFixed(2)}% at 1m, missed move`);
      clearTimeout(timer2);
      clearTimeout(hardTimer);
      return;
    }

    log(`[Slot ${slot.id}] Monitor ${stock}: flat at 1m (${(pctMove * 100).toFixed(2)}%), holding order`);
  }, CHECK_1_MS);

  const timer2 = setTimeout((): void => {
    if (slot.latestOrderFilled || !globalState.slots.has(slot.id)) return;

    const currentPrice = slot.monitorPrice;
    if (currentPrice <= 0) {
      log(`[Slot ${slot.id}] Monitor ${stock}: no market data at 3m, waiting for hard cancel...`);
      return;
    }

    const pctMove = (currentPrice - entryPrice) / entryPrice;
    log(`[Slot ${slot.id}] Monitor ${stock} at 3m: entry=${entryPrice} current=${currentPrice} move=${(pctMove * 100).toFixed(2)}%`);

    if (pctMove < 0) {
      cancelSlotBuyOrder(ib, globalState, slot, `down ${(pctMove * 100).toFixed(2)}% at 3m`);
      clearTimeout(hardTimer);
      return;
    }

    if (pctMove > UP_MISSED_PCT) {
      cancelSlotBuyOrder(ib, globalState, slot, `up ${(pctMove * 100).toFixed(2)}% at 3m, missed move`);
      clearTimeout(hardTimer);
      return;
    }

    log(`[Slot ${slot.id}] Monitor ${stock}: flat/up at 3m (${(pctMove * 100).toFixed(2)}%), holding to 5m`);
  }, CHECK_2_MS);

  const hardTimer = setTimeout((): void => {
    if (slot.latestOrderFilled || !globalState.slots.has(slot.id)) return;
    cancelSlotBuyOrder(ib, globalState, slot, "5m hard cancel");
  }, HARD_CANCEL_MS);
}

export function performSlotSell(
  ib: any,
  globalState: GlobalState,
  slot: Slot,
): void {
  const stock: string = slot.currentTrade.symbol;
  const quantity: number = slot.currentTrade.quantity;
  const entryPrice: number = slot.currentTrade.price;

  const profitPrice = round(entryPrice + (SlotProfitAmount / quantity), 2);

  const contract: Contract = {
    symbol: stock,
    exchange: "SMART",
    currency: "USD",
    secType: SecType.STK,
  };

  const profitOrderId = globalState.nextOrderId++;

  // Upside-only mode: place just the profit-target limit sell, no downside stop.
  if (DisableStopLoss) {
    const profitOrder: Order = {
      orderType: OrderType.LMT,
      action: OrderAction.SELL,
      lmtPrice: profitPrice,
      orderId: profitOrderId,
      totalQuantity: quantity,
      account: IBKR_ACCOUNT_ID,
      tif: TimeInForce.GTC,
      transmit: true,
      outsideRth: true,
    };

    log(`[Slot ${slot.id}] Placing upside-only sell for ${stock}: ${quantity} shares`);
    log(`[Slot ${slot.id}]   Profit target #${profitOrderId}: LIMIT @ ${profitPrice} (no stop loss)`);

    ib.placeOrder(profitOrderId, contract, profitOrder);

    slot.profitTargetOrderId = profitOrderId;
    slot.stopLossOrderId = 0;
    slot.state = States.SELLING;
    return;
  }

  const stopLossPrice = round(entryPrice - (SlotLossAmount / quantity), 2);
  const stopLossOrderId = globalState.nextOrderId++;

  const ocaGroup: string = `OCA_${profitOrderId}_${crypto.randomBytes(6).toString('hex')}`;

  const profitOrder: Order = {
    orderType: OrderType.LMT,
    action: OrderAction.SELL,
    lmtPrice: profitPrice,
    orderId: profitOrderId,
    totalQuantity: quantity,
    account: IBKR_ACCOUNT_ID,
    tif: TimeInForce.GTC,
    transmit: true,
    outsideRth: true,
    ocaGroup,
    ocaType: 1,
  };

  const stopLossOrder: Order = {
    orderType: OrderType.STP,
    action: OrderAction.SELL,
    auxPrice: stopLossPrice,
    orderId: stopLossOrderId,
    totalQuantity: quantity,
    account: IBKR_ACCOUNT_ID,
    tif: TimeInForce.GTC,
    transmit: true,
    outsideRth: true,
    ocaGroup,
    ocaType: 1,
  };

  log(`[Slot ${slot.id}] Placing OCA sell orders for ${stock}: ${quantity} shares`);
  log(`[Slot ${slot.id}]   Profit target #${profitOrderId}: LIMIT @ ${profitPrice}`);
  log(`[Slot ${slot.id}]   Stop loss #${stopLossOrderId}: STOP @ ${stopLossPrice}`);

  ib.placeOrder(profitOrderId, contract, profitOrder);
  ib.placeOrder(stopLossOrderId, contract, stopLossOrder);

  slot.profitTargetOrderId = profitOrderId;
  slot.stopLossOrderId = stopLossOrderId;
  slot.state = States.SELLING;
}
