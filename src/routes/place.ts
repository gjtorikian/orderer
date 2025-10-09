import type * as express from "express";
import { TWILIO_CONFIG } from "../config/constants";
import type { GlobalState } from "../types";
import { verifyPassword } from "../utils/auth";

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
      } else {
        globalState.openOrders = 0;
        globalState.latestOrderRes = res;
        globalState.latestOrderResSent = false;

        ib.reqOpenOrders();
      }
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  };
}
