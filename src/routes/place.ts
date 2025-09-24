import type * as express from "express";
import { TWILIO_CONFIG } from "../config/constants";
import type { GlobalState, States } from "../types";
import { verifyPassword } from "../utils/auth";
import { IBKRClient } from "../utils/ibkr-client";
import { log } from "../utils/logger";
import { performBuy } from "../utils/trading";

export function createPlaceRoute(
  globalState: GlobalState,
  twilio: any,
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
        const ibkrClient = IBKRClient.getInstance();
        
        if (!ibkrClient.isConnected()) {
          return res.status(503).send("IBKR not connected");
        }

        // Get current open orders from IBKR
        const openOrders = ibkrClient.getOpenOrders();
        globalState.openOrders = openOrders.length;

        log(`Checking open orders: ${globalState.openOrders} found`);
        
        if (globalState.openOrders > 0) {
          return res.status(202).send("Previous order hasn't finished yet");
        }

        // Check positions
        const positions = ibkrClient.getPositions();
        const activePositions = positions.filter(p => p.position !== 0);
        
        if (activePositions.length >= 2) {
          const note: string = `Note: ${activePositions.length} positions already exist`;
          return res.send(note);
        }

        // Ready to place buy order
        globalState.sequence = globalState.message.split(" ");
        
        try {
          await performBuy(globalState);
          return res.sendStatus(200);
        } catch (err: any) {
          return res.status(500).send(`Error placing order: ${err.message}`);
        }
      }
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  };
}