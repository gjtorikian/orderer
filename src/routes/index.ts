import type * as express from "express";
import { verifyPassword } from "../utils/auth";

export function createIndexRoute(ib: any): express.RequestHandler {
  return async (
    req: express.Request,
    res: express.Response,
  ): Promise<void | express.Response> => {
    if (!verifyPassword(req.query.password as string)) {
      return res.sendStatus(404);
    }

    ib.once("currentTime", (time: any) => {
      return res.send(`API time is: ${time}`);
    });
    ib.reqCurrentTime();
  };
}
