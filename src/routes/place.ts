import type * as express from "express";
import { TWILIO_CONFIG, TRADING_MODE, ColdShutdownLosses } from "../config/constants";
import { type GlobalState, type PredictionMetrics, TradingMode } from "../types";
import { verifyPassword } from "../utils/auth";
import { classifySignal } from "../utils/filters";
import { log } from "../utils/logger";
import { checkRegimeDayRollover } from "../utils/regime";

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
      if (!globalState.ready) {
        return res.status(503).send("Bot is not ready yet (waiting for account data)");
      }

      const body = req.body;
      globalState.message = body.message;

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

      // Cold shutdown: if early losses exceed threshold, stop for the day
      if (globalState.regime.earlyLosses >= ColdShutdownLosses && !globalState.regime.hotMode) {
        return res.status(204).send("Cold shutdown: too many early losses today");
      }

      // If metrics provided, classify signal direction
      if (TRADING_MODE === TradingMode.SLOTS && body.metrics) {
        const metrics = body.metrics as PredictionMetrics;
        const direction = classifySignal(metrics);
        if (!direction) {
          return res.status(204).send("Signal filtered out");
        }
        globalState.pendingMetrics = metrics;
        // Store direction in message for downstream: "b AAPL 150.00" or "s AAPL 150.00"
        if (direction === "short") {
          // Rewrite message prefix from "b" to "s" so downstream knows
          globalState.message = "s" + globalState.message.slice(1);
        }
        log(`Signal classified as ${direction.toUpperCase()} for ${globalState.message}`);
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
