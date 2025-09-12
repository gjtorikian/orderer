// Legacy position handler - now handled by IBKRMonitor
// This function is kept for compatibility but functionality moved to IBKRMonitor.checkPositions()

import { TWILIO_CONFIG } from "../config/constants";
import type { GlobalState } from "../types";
import { log } from "../utils/logger";

export async function handlePosition(
  globalState: GlobalState,
  twilio: any,
  _account: string,
  contract: any,
  pos: number,
  avgCost: number,
): Promise<void> {
  // Legacy handler - functionality now in IBKRMonitor
  // Kept for backward compatibility but this won't be called in the new system
  log(`Legacy position handler called - this should be handled by IBKRMonitor`);
  
  // Basic position logging for debugging
  if (pos != 0) {
    log(`Position: ${contract.symbol} - ${pos} @ ${avgCost}`);
    globalState.positionsCount++;
  }

  if (pos < 0 && !globalState.notifiedOfShort) {
    globalState.notifiedOfShort = true;
    await twilio.messages.create({
      body: "WARNING: Short position identified",
      to: TWILIO_CONFIG.myNumber,
      from: TWILIO_CONFIG.twilioNumber,
    });
  }
}