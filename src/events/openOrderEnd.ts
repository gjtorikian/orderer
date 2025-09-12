// Legacy openOrderEnd handler - now handled by IBKRMonitor
// This function is kept for compatibility but functionality moved to IBKRMonitor.handleOpenOrderEnd()

import type * as express from "express";
import { WinCounterMax } from "../config/constants";
import { type GlobalState, States } from "../types";
import { log } from "../utils/logger";

export async function handleOpenOrderEnd(
  globalState: GlobalState,
): Promise<void | express.Response> {
  log(`Legacy openOrderEnd handler called - this should be handled by IBKRMonitor`);
  
  // Basic implementation kept for compatibility
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
    if (globalState.positionsCount > 1) {
      const note: string = `Note: ${globalState.positionsCount} positions already exist`;
      globalState.positionsCount = 0;
      return globalState.latestOrderRes.send(note);
    }

    globalState.state = States.BUYING;
    globalState.sequence = globalState.message.split(" ");

    // In the new system, this will trigger the buy operation through state monitoring
    return globalState.latestOrderRes.sendStatus(200);
  }
}