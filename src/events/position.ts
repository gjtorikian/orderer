import type { GlobalState } from "../types";
import { log } from "../utils/logger";

export async function handlePosition(
  globalState: GlobalState,
  _twilio: any,
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
}
