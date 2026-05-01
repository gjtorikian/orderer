import type * as express from "express";
import { TWILIO_CONFIG, TRADING_MODE, ColdShutdownLosses } from "../config/constants";
import { type GlobalState, TradingMode } from "../types";
import { verifyPassword } from "../utils/auth";
import { log } from "../utils/logger";
import { checkRegimeDayRollover } from "../utils/regime";

const NOT_READY_LOG_INTERVAL_MS = 60_000;
let lastNotReadyLogAt = 0;
let suppressedNotReadyCount = 0;

export function createPlaceRoute(
  globalState: GlobalState,
  twilio: any,
  ib: any,
): express.RequestHandler {
  return async (
    req: express.Request,
    res: express.Response,
  ): Promise<void | express.Response> => {
    try {
      const body = req.body;
      globalState.message = body?.message ?? "";

      if (!globalState.ready) {
        const now = Date.now();
        if (now - lastNotReadyLogAt >= NOT_READY_LOG_INTERVAL_MS) {
          const suffix = suppressedNotReadyCount > 0
            ? ` (${suppressedNotReadyCount} similar suppressed)`
            : "";
          log(
            `503 /place: bot not ready (state=${globalState.state}, ready=${globalState.ready}, nextOrderId=${globalState.nextOrderId}, maxSpend=${globalState.maxSpend}) for "${globalState.message}"${suffix}`,
          );
          lastNotReadyLogAt = now;
          suppressedNotReadyCount = 0;
        } else {
          suppressedNotReadyCount++;
        }
        return res.status(503).send("Bot is not ready yet (waiting for account data)");
      }

      if (!verifyPassword(req.headers.authorization as string)) {
        return res.sendStatus(404);
      }

      if (!globalState.message.startsWith("b ")) {
        await twilio.messages.create({
          body: globalState.message,
          to: TWILIO_CONFIG.myNumber,
          from: TWILIO_CONFIG.twilioNumber,
        });
        return res.sendStatus(202);
      }

      // Reset regime on day change
      checkRegimeDayRollover(globalState);

      // Cold shutdown: if early long losses exceed threshold, stop for the day
      if (globalState.regime.warmupLongLosses >= ColdShutdownLosses && !globalState.regime.hotMode) {
        return res.status(204).send("Cold shutdown: too many early losses today");
      }

      // Direction from caller via metrics.signal: "L" (long/buy) or "S" (short/sell)
      // If not provided, default to long for backwards compatibility
      const signal = (body.metrics?.signal as string || "L").toUpperCase();
      if (signal === "S") {
        globalState.message = "s" + globalState.message.slice(1);
        log(`SHORT signal for ${globalState.message}`);
      }

      globalState.openOrders = 0;
      globalState.latestOrderRes = res;
      globalState.latestOrderResSent = false;

      ib.reqOpenOrders();
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  };
}
