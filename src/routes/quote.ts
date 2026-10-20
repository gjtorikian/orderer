import type * as express from "express";
import { verifyPassword } from "../utils/auth";
import { error } from "../utils/logger";
import { type QuoteBook, QuoteError } from "../utils/quotes";

// GET /quote?symbol=SLS (or ?conId=390872440) -> latest IB quote as JSON. Read-only: never places or changes orders.
// Same password as /place, in the Authorization header (or ?password= like GET /). Works whenever IB is connected,
// even before the bot is `ready`.
export function createQuoteRoute(quotes: QuoteBook): express.RequestHandler {
  return async (req: express.Request, res: express.Response): Promise<void | express.Response> => {
    const password = (req.headers.authorization as string) ?? (req.query.password as string);
    if (!verifyPassword(password)) return res.sendStatus(404);

    const symbol = String(req.query.symbol ?? "").trim().toUpperCase();
    const conId = req.query.conId ? Number(req.query.conId) : undefined;
    if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol) && !(conId && Number.isInteger(conId) && conId > 0)) {
      return res.status(400).json({ error: "symbol (e.g. SLS) or conId required" });
    }

    try {
      return res.json(await quotes.get(symbol || `#${conId}`, conId));
    } catch (err: any) {
      if (err instanceof QuoteError) return res.status(err.status).json({ error: err.message });
      error(`[quote] ${symbol || conId}: ${err?.message ?? err}`);
      return res.status(500).json({ error: err?.message ?? "quote failed" });
    }
  };
}
