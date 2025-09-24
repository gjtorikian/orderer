import { TWILIO_CONFIG } from "../config/constants";
import type { GlobalState } from "../types";
import { log } from "../utils/logger";

export async function handlePosition(
  globalState: GlobalState,
  twilio: any,
  _account: string,
  contract: any,
  pos: number,
  avgCost?: number,
): Promise<void> {
  // sometimes IBKR spits out closed positions
  if (pos != 0) {
    log(`Position: ${contract.symbol} - ${pos} @ ${avgCost ?? 'N/A'}`);
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
