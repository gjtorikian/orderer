import type * as express from "express";
import { TWILIO_CONFIG } from "../config/constants";
import { verifyPassword } from "../utils/auth";
import { log } from "../utils/logger";

// POST /alert { "message": "..." } -> SMS to MY_NUMBER. Same password as /place.
// Works even when the bot is not `ready`, so scan/trigger texts arrive regardless of IB state.
export function createAlertRoute(twilio: any): express.RequestHandler {
  return async (req: express.Request, res: express.Response): Promise<void | express.Response> => {
    try {
      if (!verifyPassword(req.headers.authorization as string)) return res.sendStatus(404);
      const message: string = String(req.body?.message ?? "").slice(0, 1500);
      if (!message) return res.status(400).send("message required");
      await twilio.messages.create({ body: message, from: TWILIO_CONFIG.twilioNumber, to: TWILIO_CONFIG.myNumber });
      log(`[alert] ${message.replace(/\n/g, " | ")}`);
      return res.sendStatus(204);
    } catch (err: any) {
      log(`[alert] failed: ${err?.message ?? err}`);
      return res.status(500).send(err?.message ?? "alert failed");
    }
  };
}
