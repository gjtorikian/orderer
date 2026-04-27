import { WarmupTrades, HotThreshold, HotMultiplier } from "../config/constants";
import type { GlobalState } from "../types";
import { log } from "./logger";

/** Get today's date in YYYY-MM-DD (ET) */
function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Reset regime state if the trading day has changed */
export function checkRegimeDayRollover(globalState: GlobalState): void {
  const today = todayET();
  if (globalState.regime.currentDate !== today) {
    log(`New trading day: ${today} (was ${globalState.regime.currentDate}). Resetting regime.`);
    globalState.regime = {
      warmupLongWins: 0,
      warmupLongLosses: 0,
      warmupResolved: 0,
      hotMode: false,
      currentDate: today,
      dailyWins: 0,
      dailyLosses: 0,
    };
    // Reset maxSpend to base (un-multiplied)
    globalState.maxSpend = globalState.baseMaxSpend;
  }
}

/**
 * Called after each trade resolves. Updates regime and adjusts maxSpend.
 * Only LONG results count toward the warmup regime detection.
 */
export function updateRegime(globalState: GlobalState, wasWin: boolean, direction: "long" | "short"): void {
  if (wasWin) {
    globalState.regime.dailyWins++;
  } else {
    globalState.regime.dailyLosses++;
  }

  // Only long trades count toward warmup regime detection
  if (!globalState.regime.hotMode && direction === "long") {
    globalState.regime.warmupResolved++;

    if (wasWin) {
      globalState.regime.warmupLongWins++;
    } else {
      globalState.regime.warmupLongLosses++;
    }

    // Check if warmup is complete
    if (globalState.regime.warmupResolved >= WarmupTrades) {
      const winRate = globalState.regime.warmupLongWins / globalState.regime.warmupResolved;
      if (winRate >= HotThreshold) {
        globalState.regime.hotMode = true;
        globalState.maxSpend = globalState.baseMaxSpend * HotMultiplier;
        log(`HOT MODE ACTIVATED: ${globalState.regime.warmupLongWins}/${globalState.regime.warmupResolved} long wins (${(winRate * 100).toFixed(0)}% >= ${(HotThreshold * 100).toFixed(0)}%). maxSpend scaled to ${globalState.maxSpend} (${HotMultiplier}x)`);
      } else {
        log(`Warmup complete: ${globalState.regime.warmupLongWins}/${globalState.regime.warmupResolved} long wins (${(winRate * 100).toFixed(0)}%). Staying at base leverage.`);
      }
    }
  }

  // Compounding: adjust baseMaxSpend based on cumulative P&L
  if (wasWin) {
    globalState.baseMaxSpend *= 1.004;
  } else {
    globalState.baseMaxSpend *= 0.992;
  }

  // Re-apply hot multiplier if active
  if (globalState.regime.hotMode) {
    globalState.maxSpend = globalState.baseMaxSpend * HotMultiplier;
  } else {
    globalState.maxSpend = globalState.baseMaxSpend;
  }
}
