import type * as express from "express";
import { WinCounterMax, TRADING_MODE, MaxSlots } from "../config/constants";
import { type GlobalState, States, TradingMode } from "../types";
import { log } from "../utils/logger";
import { performBuy, getAvailableSlotId, activeSlotCount, performSlotEntry } from "../utils/trading";

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

  if (TRADING_MODE === TradingMode.SLOTS) {
    return handleSlotsOpenOrderEnd(globalState, ib, sendResponse);
  }

  if (globalState.openOrders > 0) {
    return sendResponse(globalState.latestOrderRes, 202, "Previous order hasn't finished yet");
  } else if (globalState.winTimes >= WinCounterMax) {
    const eodMsg: string = `Already won ${globalState.winTimes} times, done for the day`;
    log(eodMsg);

    return sendResponse(globalState.latestOrderRes, 204, eodMsg);
  } else if (globalState.state === States.READY_TO_BUY) {
    globalState.positionsCount = 0;
    ib.once("positionEnd", (): void | express.Response => {
      if (globalState.positionsCount > 1) {
        const note: string = `Note: ${globalState.positionsCount} positions already exist`;
        globalState.positionsCount = 0;
        return sendResponse(globalState.latestOrderRes!, 200, note);
      }

      globalState.state = States.BUYING;
      globalState.sequence = globalState.message.split(" ");
      globalState.direction = globalState.message.startsWith("s ") ? "short" : "long";

      performBuy(ib, globalState);
      return sendResponse(globalState.latestOrderRes!, 200);
    });

    ib.reqPositions();
  }
}

function handleSlotsOpenOrderEnd(
  globalState: GlobalState,
  ib: any,
  sendResponse: (res: any, status: number, message?: string) => void,
): void | express.Response {
  // Check real positions from IBKR (includes carryovers from previous days)
  globalState.positionsCount = 0;
  ib.once("positionEnd", (): void | express.Response => {
    // Slots in BUYING state have no position yet — count them separately
    let buyingSlots = 0;
    for (const slot of globalState.slots.values()) {
      if (slot.state === States.BUYING) {
        buyingSlots++;
      }
    }

    const usedSlots = globalState.positionsCount + buyingSlots;
    if (usedSlots >= MaxSlots) {
      const msg = `All ${MaxSlots} slots occupied (${globalState.positionsCount} positions, ${buyingSlots} buying)`;
      log(msg);
      return sendResponse(globalState.latestOrderRes, 202, msg);
    }

    const slotId = getAvailableSlotId(globalState);
    if (slotId === null) {
      return sendResponse(globalState.latestOrderRes, 202, "No slot IDs available");
    }

    globalState.sequence = globalState.message.split(" ");

    // Determine direction from message prefix: "b" = long, "s" = short
    const direction = globalState.message.startsWith("s ") ? "short" as const : "long" as const;
    performSlotEntry(ib, globalState, slotId, direction);

    const active = usedSlots + 1;
    return sendResponse(globalState.latestOrderRes!, 200, `Slot ${slotId} ${direction} (${active}/${MaxSlots})`);
  });

  ib.reqPositions();
}
