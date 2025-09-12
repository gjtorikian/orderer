import type * as express from "express";
import { WinCounterMax } from "../config/constants";
import { type GlobalState, States } from "../types";
import { log } from "../utils/logger";

export async function handleOpenOrderEnd(
  globalState: GlobalState,
  ib: any,
): Promise<void | express.Response> {
  if (globalState.latestOrderRes == null) {
    return;
  }

  if (globalState.openOrders > 0) {
    return globalState.latestOrderRes
      .status(202)
      .send("Previous order hasn't finished yet");
  } else if (globalState.winTimes >= WinCounterMax) {
    const eodMsg: string = `Already won ${globalState.winTimes} times, done for the day`;
    log(eodMsg);

    return globalState.latestOrderRes.status(204).send(eodMsg);
  } else if (globalState.state === States.READY_TO_BUY) {
    ib.once("positionEnd", (): void | express.Response => {
      if (globalState.positionsCount > 1) {
        const note: string = `Note: ${globalState.positionsCount} positions already exist`;
        globalState.positionsCount = 0;
        return globalState.latestOrderRes!.send(note);
      }

      globalState.state = States.BUYING;
      globalState.sequence = globalState.message.split(" ");

      ib.reqIds(1);
      return globalState.latestOrderRes!.sendStatus(200);
    });

    ib.reqPositions();
  }
}
