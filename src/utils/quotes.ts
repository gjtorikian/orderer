import { type Contract, EventName, IBApiTickType, SecType } from "@stoqey/ib";
import { log } from "./logger";

// Read-only quote cache behind GET /quote. The first request for a symbol opens a streaming reqMktData subscription;
// later requests read the cache, so a caller can poll every second without a round trip to IB. A subscription nobody
// has asked about for IDLE_MS is cancelled, and at most MAX_SUBSCRIPTIONS are open at once (least recently used goes
// first) so quotes never eat the market-data lines the buy monitors need. Nothing here places or touches orders.

// Far above any order id: handleError() treats an error's reqId as an order id when deciding whether to reset
// trading state, so a quote's reqId must never equal one.
const REQ_ID_BASE = 2_100_000_000;
const IDLE_MS = 10 * 60_000;
const MAX_SUBSCRIPTIONS = 40;
const FIRST_TICK_WAIT_MS = 3_000;

const T = IBApiTickType;
const LAST = new Set<number>([T.LAST, T.DELAYED_LAST]);
const BID = new Set<number>([T.BID, T.DELAYED_BID]);
const ASK = new Set<number>([T.ASK, T.DELAYED_ASK]);
const CLOSE = new Set<number>([T.CLOSE, T.DELAYED_CLOSE]);
const HALTED = new Set<number>([T.HALTED, T.DELAYED_HALTED]);

// No security definition / ambiguous contract: the symbol is wrong. Not subscribed / no permissions: an account
// problem, not the caller's.
const NOT_FOUND_CODES = new Set<number>([200]);
const NO_DATA_CODES = new Set<number>([354, 10089, 10090, 10091, 10167, 10168, 10186, 10197]);

export interface Quote {
  symbol: string;
  conId?: number;
  last: number | null;
  bid: number | null;
  ask: number | null;
  close: number | null;
  /** IBKR's halted tick: false = trading, true = halted. null until IB has sent it. */
  halted: boolean | null;
  /** "general" (regulatory/news) or "volatility" (LULD pause), when halted. */
  haltKind?: "general" | "volatility";
  /** When orderer last received a LAST tick for this symbol (not the exchange print time). */
  lastAt: string | null;
  updatedAt: string | null;
  subscribedAt: string;
}

interface Sub {
  reqId: number;
  key: string;
  quote: Quote;
  lastRequested: number;
  error?: { code: number; message: string };
  waiters: (() => void)[];
}

export class QuoteError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export class QuoteBook {
  private subs = new Map<string, Sub>();
  private byReqId = new Map<number, Sub>();
  private nextReqId = REQ_ID_BASE;

  constructor(private ib: any) {
    ib.on(EventName.tickPrice, (reqId: number, field: number, value: number) => this.onPrice(reqId, field, value));
    ib.on(EventName.tickGeneric, (reqId: number, field: number, value: number) => this.onGeneric(reqId, field, value));
    ib.on(EventName.error, (err: Error, code: any, reqId: number) => this.onError(err, code, reqId));
    // A dropped connection kills every subscription; the next request for each symbol resubscribes.
    ib.on(EventName.disconnected, () => this.clear("IB disconnected"));
    setInterval(() => this.sweep(), 60_000).unref();
  }

  async get(symbol: string, conId?: number): Promise<Quote> {
    if (!this.ib.isConnected) throw new QuoteError("not connected to IB", 503);
    const key = conId ? `#${conId}` : symbol;
    let sub = this.subs.get(key);
    if (sub?.error) {
      // Report it once, then forget it, so a later request retries (permissions can be fixed).
      this.drop(sub);
      throw new QuoteError(sub.error.message, NOT_FOUND_CODES.has(sub.error.code) ? 404 : 502);
    }
    if (!sub) sub = this.subscribe(key, symbol, conId);
    sub.lastRequested = Date.now();
    if (!sub.quote.updatedAt) await this.firstTick(sub);
    if (sub.error) {
      this.drop(sub);
      throw new QuoteError(sub.error.message, NOT_FOUND_CODES.has(sub.error.code) ? 404 : 502);
    }
    if (!sub.quote.updatedAt) throw new QuoteError(`no data for ${symbol} yet; subscribed, try again`, 504);
    return { ...sub.quote };
  }

  private subscribe(key: string, symbol: string, conId?: number): Sub {
    if (this.subs.size >= MAX_SUBSCRIPTIONS) {
      const lru = [...this.subs.values()].sort((a, b) => a.lastRequested - b.lastRequested)[0];
      this.drop(lru, "evicted (subscription limit)");
    }
    const reqId = this.nextReqId++;
    const contract: Contract = conId
      ? { conId, exchange: "SMART" }
      : { symbol, secType: SecType.STK, exchange: "SMART", currency: "USD" };
    const sub: Sub = {
      reqId, key, lastRequested: Date.now(), waiters: [],
      quote: { symbol, conId, last: null, bid: null, ask: null, close: null, halted: null, lastAt: null, updatedAt: null, subscribedAt: new Date().toISOString() },
    };
    this.subs.set(key, sub);
    this.byReqId.set(reqId, sub);
    this.ib.reqMktData(reqId, contract, "", false, false);
    log(`[quote] subscribed ${key} (reqId ${reqId})`);
    return sub;
  }

  private firstTick(sub: Sub): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, FIRST_TICK_WAIT_MS);
      sub.waiters.push(() => { clearTimeout(t); resolve(); });
    });
  }

  private touch(sub: Sub): void {
    sub.quote.updatedAt = new Date().toISOString();
    for (const w of sub.waiters.splice(0)) w();
  }

  private onPrice(reqId: number, field: number, value: number): void {
    const sub = this.byReqId.get(reqId);
    if (!sub || !(value > 0)) return; // -1 / 0 mean "no data for this field"
    const q = sub.quote;
    if (LAST.has(field)) { q.last = value; q.lastAt = new Date().toISOString(); }
    else if (BID.has(field)) q.bid = value;
    else if (ASK.has(field)) q.ask = value;
    else if (CLOSE.has(field)) q.close = value;
    else return;
    this.touch(sub);
  }

  private onGeneric(reqId: number, field: number, value: number): void {
    const sub = this.byReqId.get(reqId);
    if (!sub || !HALTED.has(field)) return;
    sub.quote.halted = value > 0;
    sub.quote.haltKind = value === 1 ? "general" : value === 2 ? "volatility" : undefined;
    this.touch(sub);
  }

  private onError(err: Error, code: any, reqId: number): void {
    const sub = this.byReqId.get(reqId);
    if (!sub) return;
    const codeNum = Number(code?.code ?? code);
    if (!NOT_FOUND_CODES.has(codeNum) && !NO_DATA_CODES.has(codeNum)) return; // informational
    sub.error = { code: codeNum, message: `IB ${codeNum}: ${err?.message ?? err}` };
    for (const w of sub.waiters.splice(0)) w();
  }

  private drop(sub: Sub, why = "dropped"): void {
    if (this.subs.get(sub.key) !== sub) return;
    this.subs.delete(sub.key);
    this.byReqId.delete(sub.reqId);
    try { this.ib.cancelMktData(sub.reqId); } catch { /* connection already gone */ }
    log(`[quote] ${why} ${sub.key} (reqId ${sub.reqId})`);
  }

  private sweep(): void {
    const now = Date.now();
    for (const sub of [...this.subs.values()]) if (now - sub.lastRequested > IDLE_MS) this.drop(sub, "idle");
  }

  private clear(why: string): void {
    if (this.subs.size) log(`[quote] ${why}: clearing ${this.subs.size} subscriptions`);
    this.subs.clear();
    this.byReqId.clear();
  }
}
