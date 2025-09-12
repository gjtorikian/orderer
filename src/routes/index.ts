import type * as express from "express";
import { verifyPassword } from "../utils/auth";
import { IBKRClient } from "../utils/ibkr-client";

export function createIndexRoute(): express.RequestHandler {
  return async (
    req: express.Request,
    res: express.Response,
  ): Promise<void | express.Response> => {
    if (!verifyPassword(req.query.password as string)) {
      return res.sendStatus(404);
    }

    try {
      const ibkrClient = IBKRClient.getInstance();
      
      if (!ibkrClient.isConnected()) {
        return res.status(503).send("IBKR not connected");
      }

      // Get current time from the new IBKR client
      const time = await ibkrClient.getCurrentTime();
      return res.send(`API time is: ${time}`);
    } catch (err: any) {
      return res.status(500).send(`Error getting time: ${err.message}`);
    }
  };
}