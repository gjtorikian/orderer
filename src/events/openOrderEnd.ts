import type * as express from "express";
import { WinCounterMax } from "../config/constants";
import { type GlobalState, States } from "../types";
import { log } from "../utils/logger";

export async function handleOpenOrderEnd(
  globalState: GlobalState,
  ib: any,
): Promise<void | express.Response> {
  if (globalState.latestOrderRes == null || globalState.latestOrderResSent) {
    return;
  }

  // Helper function to safely send response
  const sendResponse = (res: any, status: number, message?: string) => {
    if (!globalState.latestOrderResSent) {
      globalState.latestOrderResSent = true;
      if (message) {
        return res.status(status).send(message);
      } else {
        return res.sendStatus(status);
      }
    }
  };

  if (globalState.openOrders > 0) {
    return sendResponse(globalState.latestOrderRes, 202, "Previous order hasn't finished yet");
  } else if (globalState.winTimes >= WinCounterMax) {
    const eodMsg: string = `Already won ${globalState.winTimes} times, done for the day`;
    log(eodMsg);

    return sendResponse(globalState.latestOrderRes, 204, eodMsg);
  } else if (globalState.state === States.READY_TO_BUY) {
    ib.once("positionEnd", (): void | express.Response => {
      if (globalState.positionsCount > 1) {
        const note: string = `Note: ${globalState.positionsCount} positions already exist`;
        globalState.positionsCount = 0;
        return sendResponse(globalState.latestOrderRes!, 200, note);
      }

      globalState.state = States.BUYING;
      globalState.sequence = globalState.message.split(" ");

      ib.reqIds();
      return sendResponse(globalState.latestOrderRes!, 200);
    });

    ib.reqPositions();
  }
}
