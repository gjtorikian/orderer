import { type Contract, EventName, type Order, OrderAction, OrderType, SecType, TimeInForce } from "@stoqey/ib";
import {
  DRY_RUN,
  FixedProfitAmount,
  IBKR_ACCOUNT_ID,
  LoopEndMinutes,
  LoopFillTimeoutMs,
  LoopOrderRef,
  LoopStartMinutes,
  LoopSymbol,
  TWILIO_CONFIG,
  WinCounterMax,
} from "../config/constants";
import { type GlobalState, type LoopSession, type LoopState, States } from "../types";
import { error, log } from "./logger";
import type { Quote, QuoteBook } from "./quotes";
import { performSell, round } from "./trading";

// LOOP mode: buy LOOP_SYMBOL at the ask, sell it FixedProfitAmount higher, and repeat, from LOOP_START to LOOP_END
// (Eastern) up to WinCounterMax round trips a day. No signals, no stop loss. A tick every TICK_MS drives the single
// position state machine (READY_TO_BUY -> BUYING -> SELLING -> READY_TO_BUY); IB's orderStatus events move it along.
//
// Safety rails:
// - Every order the loop places carries IB's orderRef = LoopOrderRef. Before the first buy after each (re)connect,
//   IB is asked for open orders in LOOP_SYMBOL; only ones with that tag (say a GTC profit target from before a
//   restart) hold the loop back, and you get one SMS. Options, other symbols, manual orders and an existing position
//   in the symbol are left alone.
// - Once a day the exchange's regular session for LOOP_SYMBOL is read from IB's contract details, so holidays idle
//   and early closes stop buying at the close. The buying window is LOOP_START-LOOP_END clipped to that session.
// - A buy unfilled after LoopFillTimeoutMs is cancelled; the loop waits for IB to confirm, then re-prices from a
//   fresh quote. A cancel that goes unconfirmed, or a rejected sell, halts the loop for the day and texts you.
// - The profit target is GTC: a round trip that never reaches target holds overnight and completes whenever it does.

const TICK_MS = 5_000;
const PREFLIGHT_RETRY_MS = 60_000;
const PREFLIGHT_TIMEOUT_MS = 15_000;
const SESSION_RETRY_MS = 60_000;
const SESSION_TIMEOUT_MS = 15_000;
const REJECT_BACKOFF_MS = 60_000;
const STUCK_CANCEL_MS = 60_000;
const LOG_EVERY_MS = 60_000;
// Far above any order id (handleError treats an error's reqId as an order id) and below the QuoteBook's range.
const CONTRACT_DETAILS_REQ_ID = 2_000_000_000;
const EASTERN_ZONES = new Set(["US/Eastern", "America/New_York", "EST", "EST5EDT"]);

interface Ctx {
  ib: any;
  globalState: GlobalState;
  twilio: any;
  quotes: QuoteBook;
}

interface Clock {
  /** YYYY-MM-DD in Eastern time */
  date: string;
  /** Minutes since midnight Eastern */
  minutes: number;
  weekend: boolean;
}

interface AccountScan {
  /** Open orders in LOOP_SYMBOL that this loop placed (orderRef = LoopOrderRef) */
  loopOrders: number;
  /** Other open orders in LOOP_SYMBOL (options, manual orders): ignored */
  otherOrders: number;
  /** Existing stock position in LOOP_SYMBOL: ignored */
  position: number;
}

export function initialLoopState(): LoopState {
  return {
    day: nowET().date,
    preflightOk: false,
    preflightBusy: false,
    nextPreflightAt: 0,
    blockAnnounced: false,
    session: null,
    sessionBusy: false,
    nextSessionFetchAt: 0,
    buyBusy: false,
    nextBuyAt: 0,
    buyPlacedAt: 0,
    cancelRequestedAt: 0,
    halted: null,
    haltAnnounced: false,
    doneAnnounced: false,
    lastLogAt: new Map(),
  };
}

export function startLoop(ib: any, globalState: GlobalState, twilio: any, quotes: QuoteBook): void {
  const ctx: Ctx = { ib, globalState, twilio, quotes };

  // Order status events may have been missed during an outage: re-check the account before buying again.
  ib.on(EventName.disconnected, (): void => {
    globalState.loop.preflightOk = false;
  });

  log(
    `[loop] ${LoopSymbol}: up to ${WinCounterMax} round trips/day at +$${FixedProfitAmount} each, ` +
      `${fmtClock(LoopStartMinutes)}-${fmtClock(LoopEndMinutes)} ET, no stop loss` +
      (DRY_RUN ? " (DRY_RUN: no orders will be placed)" : ""),
  );

  setInterval((): void => {
    tick(ctx).catch((err: any) => error(`[loop] tick failed: ${err?.message ?? err}`));
  }, TICK_MS);
}

async function tick(ctx: Ctx): Promise<void> {
  const { ib, globalState, twilio } = ctx;
  const L = globalState.loop;
  const now = nowET();

  if (L.day !== now.date) {
    log(`[loop] New trading day ${now.date}: win counter reset (was ${globalState.winTimes}/${WinCounterMax})`);
    L.day = now.date;
    globalState.winTimes = 0;
    L.halted = null;
    L.haltAnnounced = false;
    L.doneAnnounced = false;
  }

  if (!globalState.ready || !ib.isConnected) return;

  if (L.halted) {
    if (!L.haltAnnounced) {
      L.haltAnnounced = true;
      await sms(twilio, `[loop] HALTED: ${L.halted}`);
    }
    return;
  }

  if (globalState.state === States.BUYING) {
    watchOpenBuy(ctx, now);
    return;
  }

  // SELLING: the GTC profit target is working; nothing to do until it fills.
  if (globalState.state !== States.READY_TO_BUY) return;

  if (!L.preflightOk) {
    await preflight(ctx);
    return;
  }

  if (globalState.winTimes >= WinCounterMax) {
    if (!L.doneAnnounced) {
      L.doneAnnounced = true;
      const text = `[loop] ${LoopSymbol}: ${globalState.winTimes}/${WinCounterMax} round trips, done for the day`;
      log(text);
      await sms(twilio, text);
    }
    return;
  }

  if (now.weekend) return;

  const session = await ensureSession(ctx, now);
  if (session?.closed) {
    logEvery(L, "closed", `[loop] ${now.date}: market closed for ${LoopSymbol}; nothing to do today`);
    return;
  }
  if (now.minutes < windowStart(L, now) || now.minutes >= windowEnd(L, now)) return;
  if (Date.now() < L.nextBuyAt) return;

  await placeBuy(ctx);
}

function watchOpenBuy(ctx: Ctx, now: Clock): void {
  const { ib, globalState } = ctx;
  const L = globalState.loop;
  const orderId = globalState.lastOrderId;
  if (!orderId) return;

  if (L.cancelRequestedAt) {
    if (Date.now() - L.cancelRequestedAt > STUCK_CANCEL_MS) {
      halt(
        L,
        `buy #${orderId} did not confirm its cancel within ${STUCK_CANCEL_MS / 1000}s; check TWS for an untracked fill of ${LoopSymbol}`,
      );
    }
    return;
  }

  const age = Date.now() - L.buyPlacedAt;
  const end = windowEnd(L, now);
  const pastEnd = now.minutes >= end;
  if (age < LoopFillTimeoutMs && !pastEnd) return;

  const why = pastEnd ? `buying window ended at ${fmtClock(end)}` : `unfilled after ${Math.round(age / 1000)}s`;
  log(`[loop] Cancelling buy #${orderId}: ${why}${pastEnd ? "" : "; will re-price from a fresh quote"}`);
  L.cancelRequestedAt = Date.now();
  ib.cancelOrder(orderId);
}

async function preflight(ctx: Ctx): Promise<void> {
  const { ib, globalState, twilio } = ctx;
  const L = globalState.loop;
  if (L.preflightBusy || Date.now() < L.nextPreflightAt) return;
  L.preflightBusy = true;
  try {
    const found = await scanAccount(ib, LoopSymbol);
    if (!found) {
      logEvery(
        L,
        "preflight",
        `[loop] IB did not answer the open-orders/positions scan within ${PREFLIGHT_TIMEOUT_MS / 1000}s; retrying`,
      );
      L.nextPreflightAt = Date.now() + PREFLIGHT_RETRY_MS;
      return;
    }
    if (found.position !== 0) {
      logEvery(
        L,
        "position",
        `[loop] Note: the account already holds ${found.position} ${LoopSymbol}; the loop leaves that alone and trades its own shares on top`,
      );
    }
    if (found.loopOrders > 0) {
      const text =
        `[loop] ${found.loopOrders} ${LoopSymbol} order(s) from a previous run are still working ` +
        `(orderRef ${LoopOrderRef}); not buying until they fill or you cancel them`;
      log(text);
      if (!L.blockAnnounced) {
        L.blockAnnounced = true;
        await sms(twilio, text);
      }
      L.nextPreflightAt = Date.now() + PREFLIGHT_RETRY_MS;
      return;
    }
    L.preflightOk = true;
    L.blockAnnounced = false;
    log(
      `[loop] Preflight clear: no leftover loop orders in ${LoopSymbol}` +
        (found.otherOrders ? ` (${found.otherOrders} unrelated ${LoopSymbol} order(s) ignored)` : ""),
    );
  } finally {
    L.preflightBusy = false;
  }
}

/** Ask IB for every open order and the stock position in `symbol`. Resolves null if IB does not answer in time. */
function scanAccount(ib: any, symbol: string): Promise<AccountScan | null> {
  return new Promise((resolve) => {
    const found: AccountScan = { loopOrders: 0, otherOrders: 0, position: 0 };
    let settled = false;

    const onOpenOrder = (_orderId: number, contract: any, order: any): void => {
      if (contract?.symbol !== symbol) return;
      if (contract?.secType === SecType.STK && order?.orderRef === LoopOrderRef) found.loopOrders++;
      else found.otherOrders++;
    };
    const onPosition = (_account: string, contract: any, pos: number): void => {
      if (contract?.symbol === symbol && contract?.secType === SecType.STK && pos) found.position += pos;
    };
    const onPositionEnd = (): void => finish(found);
    const onOpenOrderEnd = (): void => {
      ib.once(EventName.positionEnd, onPositionEnd);
      ib.reqPositions();
    };
    const finish = (result: AccountScan | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ib.off(EventName.openOrder, onOpenOrder);
      ib.off(EventName.position, onPosition);
      ib.off(EventName.openOrderEnd, onOpenOrderEnd);
      ib.off(EventName.positionEnd, onPositionEnd);
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), PREFLIGHT_TIMEOUT_MS);

    ib.on(EventName.openOrder, onOpenOrder);
    ib.on(EventName.position, onPosition);
    ib.once(EventName.openOrderEnd, onOpenOrderEnd);
    ib.reqAllOpenOrders();
  });
}

/** Today's regular session from IB, fetched once a day. Null while unknown (the tick then assumes a normal weekday). */
async function ensureSession(ctx: Ctx, now: Clock): Promise<LoopSession | null> {
  const { ib, globalState } = ctx;
  const L = globalState.loop;
  if (L.session?.date === now.date) return L.session;
  if (L.sessionBusy || Date.now() < L.nextSessionFetchAt) return null;
  L.sessionBusy = true;
  try {
    const details = await fetchLiquidHours(ib, LoopSymbol);
    const session = details ? parseSession(details.hours, now.date) : null;
    if (!session) {
      logEvery(
        L,
        "session",
        `[loop] Could not read today's trading hours for ${LoopSymbol} from IB; assuming a normal weekday session and retrying`,
      );
      L.nextSessionFetchAt = Date.now() + SESSION_RETRY_MS;
      return null;
    }
    if (details?.timeZone && !EASTERN_ZONES.has(details.timeZone)) {
      log(`[loop] IB reports ${LoopSymbol} hours in ${details.timeZone}; treating them as Eastern`);
    }
    L.session = session;
    if (session.closed) {
      log(`[loop] ${now.date}: IB lists ${LoopSymbol} as CLOSED today (holiday or weekend)`);
    } else {
      log(
        `[loop] ${now.date}: ${LoopSymbol} regular session ${fmtClock(session.open)}-${fmtClock(session.close)} ET; ` +
          `buying window ${fmtClock(windowStart(L, now))}-${fmtClock(windowEnd(L, now))}`,
      );
    }
    return session;
  } finally {
    L.sessionBusy = false;
  }
}

function fetchLiquidHours(ib: any, symbol: string): Promise<{ hours: string; timeZone?: string } | null> {
  return new Promise((resolve) => {
    const reqId = CONTRACT_DETAILS_REQ_ID;
    let result: { hours: string; timeZone?: string } | null = null;
    let settled = false;

    const onDetails = (id: number, details: any): void => {
      if (id !== reqId || result) return;
      const hours = details?.liquidHours || details?.tradingHours;
      if (hours) result = { hours, timeZone: details?.timeZoneId };
    };
    const onEnd = (id: number): void => {
      if (id === reqId) finish(result);
    };
    const onError = (_err: Error, _code: any, id: number): void => {
      if (id === reqId) finish(null);
    };
    const finish = (value: { hours: string; timeZone?: string } | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ib.off(EventName.contractDetails, onDetails);
      ib.off(EventName.contractDetailsEnd, onEnd);
      ib.off(EventName.error, onError);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), SESSION_TIMEOUT_MS);

    ib.on(EventName.contractDetails, onDetails);
    ib.on(EventName.contractDetailsEnd, onEnd);
    ib.on(EventName.error, onError);
    const contract: Contract = { symbol, secType: SecType.STK, exchange: "SMART", currency: "USD" };
    ib.reqContractDetails(reqId, contract);
  });
}

/**
 * Pick `date` (YYYY-MM-DD) out of IB's liquidHours/tradingHours string. IB uses either
 * "20261124:0930-1600;20261126:CLOSED" or "20261124:0930-20261124:1600;20261126:CLOSED". Returns null when the
 * date is not listed.
 */
export function parseSession(hours: string, date: string): LoopSession | null {
  const ymd = date.replace(/-/g, "");
  for (const segment of hours.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed.startsWith(`${ymd}:`)) continue;
    const body = trimmed.slice(ymd.length + 1);
    if (body.toUpperCase() === "CLOSED") return { date, open: 0, close: 0, closed: true };

    let open = Number.POSITIVE_INFINITY;
    let close = Number.NEGATIVE_INFINITY;
    for (const range of body.split(",")) {
      const match = /^(?:\d{8}:)?(\d{2})(\d{2})-(?:\d{8}:)?(\d{2})(\d{2})$/.exec(range.trim());
      if (!match) continue;
      open = Math.min(open, parseInt(match[1], 10) * 60 + parseInt(match[2], 10));
      close = Math.max(close, parseInt(match[3], 10) * 60 + parseInt(match[4], 10));
    }
    if (!Number.isFinite(open) || !Number.isFinite(close)) return null;
    return { date, open, close, closed: false };
  }
  return null;
}

function todaySession(L: LoopState, now: Clock): LoopSession | null {
  return L.session && L.session.date === now.date && !L.session.closed ? L.session : null;
}

function windowStart(L: LoopState, now: Clock): number {
  const session = todaySession(L, now);
  return session ? Math.max(LoopStartMinutes, session.open) : LoopStartMinutes;
}

function windowEnd(L: LoopState, now: Clock): number {
  const session = todaySession(L, now);
  return session ? Math.min(LoopEndMinutes, session.close) : LoopEndMinutes;
}

async function placeBuy(ctx: Ctx): Promise<void> {
  const { ib, globalState, quotes } = ctx;
  const L = globalState.loop;
  if (L.buyBusy) return;
  L.buyBusy = true;
  try {
    let quote: Quote;
    try {
      quote = await quotes.get(LoopSymbol);
    } catch (err: any) {
      logEvery(L, "quote", `[loop] No quote for ${LoopSymbol} yet: ${err?.message ?? err}`);
      return;
    }
    if (quote.halted) {
      logEvery(L, "halted", `[loop] ${LoopSymbol} is halted (${quote.haltKind ?? "unknown"}); waiting`);
      return;
    }
    const price = quote.ask ?? quote.last;
    if (!price || price <= 0) {
      logEvery(L, "price", `[loop] ${LoopSymbol} quote has no ask or last yet; waiting`);
      return;
    }
    // The quote wait is async; make sure nothing moved the state machine meanwhile.
    if (globalState.state !== States.READY_TO_BUY) return;

    const limit = round(price, 2);
    const quantity = Math.floor(globalState.maxSpend / limit);
    if (quantity < 1) {
      logEvery(L, "size", `[loop] maxSpend ${globalState.maxSpend} buys 0 shares of ${LoopSymbol} @ ${limit}; waiting`);
      return;
    }
    const trip = `round trip ${globalState.winTimes + 1}/${WinCounterMax}`;
    if (DRY_RUN) {
      logEvery(L, "dry", `[loop] DRY_RUN: would buy ${quantity} ${LoopSymbol} LIMIT @ ${limit} (${trip})`);
      return;
    }

    const orderId = globalState.nextOrderId++;
    globalState.state = States.BUYING;
    globalState.currentTrade = { symbol: LoopSymbol, price: limit, quantity };
    globalState.lastOrderId = orderId;
    globalState.profitTargetOrderId = 0;
    globalState.stopLossOrderId = 0;
    globalState.latestOrderFilled = false;
    L.buyPlacedAt = Date.now();
    L.cancelRequestedAt = 0;

    const contract: Contract = { symbol: LoopSymbol, exchange: "SMART", currency: "USD", secType: SecType.STK };
    const order: Order = {
      orderType: OrderType.LMT,
      action: OrderAction.BUY,
      lmtPrice: limit,
      orderId,
      totalQuantity: quantity,
      account: IBKR_ACCOUNT_ID,
      tif: TimeInForce.DAY,
      transmit: true,
      orderRef: LoopOrderRef,
    };

    log(
      `[loop] Buy #${orderId}: ${quantity} ${LoopSymbol} LIMIT @ ${limit} ` +
        `(bid ${quote.bid ?? "?"} / ask ${quote.ask ?? "?"}), ${trip}`,
    );
    ib.placeOrder(orderId, contract, order);
  } finally {
    L.buyBusy = false;
  }
}

export function handleLoopOrderStatus(
  globalState: GlobalState,
  twilio: any,
  ib: any,
  orderId: number,
  status: string,
  filled: number,
  remaining: number,
  avgFillPrice: number,
): void {
  const L = globalState.loop;
  // "Cancelled" and "ApiCancelled" are final. "PendingCancel" is not: the order can still fill.
  const cancelled = /Cancelled$/.test(status);

  if (orderId === globalState.lastOrderId && globalState.state === States.BUYING) {
    if (filled > 0 && (remaining === 0 || (cancelled && avgFillPrice > 0))) {
      onBuyFilled(globalState, ib, filled, avgFillPrice, remaining > 0);
    } else if (cancelled && filled === 0) {
      log(`[loop] Buy #${orderId} cancelled unfilled; back to READY_TO_BUY`);
      globalState.lastOrderId = 0;
      globalState.state = States.READY_TO_BUY;
      L.cancelRequestedAt = 0;
    }
    return;
  }

  if (
    orderId === globalState.profitTargetOrderId &&
    globalState.state === States.SELLING &&
    filled > 0 &&
    remaining === 0
  ) {
    const { symbol, price: entry, quantity } = globalState.currentTrade;
    globalState.profitTargetOrderId = 0;
    globalState.state = States.READY_TO_BUY;
    globalState.winTimes++;

    const done = globalState.winTimes >= WinCounterMax;
    const gross = round((avgFillPrice - entry) * quantity, 2);
    const text =
      `[loop] PROFIT ${globalState.winTimes}/${WinCounterMax}: sold ${filled} ${symbol} @ ${avgFillPrice} ` +
      `(entry ${entry}, +$${gross})${done ? " - done for the day" : ""}`;
    log(text);
    if (done) L.doneAnnounced = true;
    if (done || WinCounterMax <= 5 || globalState.winTimes % 5 === 0) {
      void sms(twilio, text);
    }
  }
}

function onBuyFilled(globalState: GlobalState, ib: any, filled: number, avgFillPrice: number, partial: boolean): void {
  const L = globalState.loop;
  globalState.latestOrderFilled = true;
  // Sell off the real fill, not the limit we asked for.
  globalState.currentTrade.price = avgFillPrice;
  globalState.currentTrade.quantity = filled;
  globalState.lastOrderId = 0;
  L.cancelRequestedAt = 0;
  globalState.state = States.SELLING;
  log(
    `[loop] Buy filled${partial ? " (partial, rest cancelled)" : ""}: ${filled} ${globalState.currentTrade.symbol} ` +
      `@ ${avgFillPrice}; placing profit target`,
  );
  performSell(ib, globalState);
}

/** Called from the IB error handler when an order is rejected outright. */
export function handleLoopOrderRejected(globalState: GlobalState, orderId: number): void {
  const L = globalState.loop;
  if (orderId === globalState.lastOrderId && globalState.state === States.BUYING) {
    log(`[loop] Buy #${orderId} rejected by IBKR; retrying in ${REJECT_BACKOFF_MS / 1000}s`);
    globalState.lastOrderId = 0;
    globalState.state = States.READY_TO_BUY;
    L.cancelRequestedAt = 0;
    L.nextBuyAt = Date.now() + REJECT_BACKOFF_MS;
    return;
  }
  if (orderId === globalState.profitTargetOrderId && globalState.state === States.SELLING) {
    // Stay in SELLING so the loop never buys on top of an unsold position.
    halt(
      L,
      `profit-target sell #${orderId} rejected by IBKR; ${globalState.currentTrade.quantity} ` +
        `${globalState.currentTrade.symbol} is held with no exit order`,
    );
  }
}

function halt(L: LoopState, reason: string): void {
  if (L.halted) return;
  L.halted = reason;
  L.haltAnnounced = false;
  error(`[loop] HALTED: ${reason}`);
}

async function sms(twilio: any, body: string): Promise<void> {
  try {
    await twilio.messages.create({ body, to: TWILIO_CONFIG.myNumber, from: TWILIO_CONFIG.twilioNumber });
  } catch (err: any) {
    error(`[loop] SMS failed: ${err?.message ?? err}`);
  }
}

/** Log `text` for `key` at most once a minute, so a waiting loop does not flood the log every tick. */
function logEvery(L: LoopState, key: string, text: string): void {
  const now = Date.now();
  if (now - (L.lastLogAt.get(key) ?? 0) < LOG_EVERY_MS) return;
  L.lastLogAt.set(key, now);
  log(text);
}

function nowET(): Clock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    // Some engines print midnight as "24" with hour12: false.
    minutes: (parseInt(get("hour"), 10) % 24) * 60 + parseInt(get("minute"), 10),
    weekend: weekday === "Sat" || weekday === "Sun",
  };
}

function fmtClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
