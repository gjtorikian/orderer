import type { PredictionMetrics, TradeDirection } from "../types";
import { log } from "./logger";

// Long filter: moderate tier (from analysis)
// onBalanceRun > 1.9724 AND vwapGain > 3.4966
function isLongSignal(m: PredictionMetrics): boolean {
  return m.onBalanceRun > 1.9724 && m.vwapGain > 3.4966;
}

// Short filter: high-confidence reversal signal (from analysis)
// boxRatio < 0.1939 AND thrust > 5.2361
function isShortSignal(m: PredictionMetrics): boolean {
  return m.boxRatio < 0.1939 && m.thrust > 5.2361;
}

/**
 * Determine trade direction from prediction metrics.
 * Returns null if the prediction doesn't pass any filter (skip).
 * If both match, long takes priority (conflicting signal = skip).
 */
export function classifySignal(m: PredictionMetrics): TradeDirection | null {
  const long = isLongSignal(m);
  const short = isShortSignal(m);

  if (long && short) {
    log(`Conflicting signal (long AND short), skipping`);
    return null;
  }
  if (long) return "long";
  if (short) return "short";

  log(`No filter matched (OBR=${m.onBalanceRun.toFixed(3)}, vwap=${m.vwapGain.toFixed(3)}, box=${m.boxRatio.toFixed(3)}, thrust=${m.thrust.toFixed(3)}), skipping`);
  return null;
}
