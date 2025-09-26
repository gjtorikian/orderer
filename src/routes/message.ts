import type * as express from "express";
import { verifyPassword } from "../utils/auth";
import { promises as fs } from "fs";

export function createMessageRoute(): express.RequestHandler {
  return async (
    req: express.Request,
    res: express.Response,
  ): Promise<void | express.Response> => {
    try {
      const body = req.body;
      const message = body.message;

      if (!verifyPassword(req.headers.authorization as string)) {
        return res.sendStatus(404);
      }

      const date = new Date().toISOString().split('T')[0];
      await fs.appendFile(`predictions/${date}.txt`, message + "\n");
      return res.sendStatus(204);
    } catch (err: any) {
      res.status(500).send(err.message);
    }
  };
}
