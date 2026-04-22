import { WarmupTrades, HotMultiplier } from "../config/constants";
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
      earlyWins: 0,
      earlyLosses: 0,
      todayResolved: 0,
      hotMode: false,
      currentDate: today,
      dailyWins: 0,
      dailyLosses: 0,
    };
    // Reset maxSpend to base (un-multiplied)
    globalState.maxSpend = globalState.baseMaxSpend;
  }
}

/** Called after each trade resolves. Updates regime and adjusts maxSpend. */
export function updateRegime(globalState: GlobalState, wasWin: boolean): void {
  globalState.regime.todayResolved++;

  if (wasWin) {
    globalState.regime.dailyWins++;
  } else {
    globalState.regime.dailyLosses++;
  }

  // During warmup phase, track consecutive early results
  if (!globalState.regime.hotMode && globalState.regime.todayResolved <= WarmupTrades) {
    if (wasWin) {
      globalState.regime.earlyWins++;
    } else {
      globalState.regime.earlyLosses++;
    }

    // Check if warmup is complete
    if (globalState.regime.todayResolved === WarmupTrades) {
      if (globalState.regime.earlyWins === WarmupTrades) {
        // All warmup trades won — activate hot mode
        globalState.regime.hotMode = true;
        globalState.maxSpend = globalState.baseMaxSpend * HotMultiplier;
        log(`HOT MODE ACTIVATED: ${WarmupTrades}/${WarmupTrades} early wins. maxSpend scaled to ${globalState.maxSpend} (${HotMultiplier}x)`);
      } else {
        log(`Warmup complete: ${globalState.regime.earlyWins}/${WarmupTrades} wins. Staying at base leverage.`);
      }
    }
  }

  // Compounding: adjust baseMaxSpend based on cumulative P&L
  // Win adds ~1% of position value, loss removes ~2%
  // We approximate by adjusting baseMaxSpend proportionally
  if (wasWin) {
    globalState.baseMaxSpend *= 1.004; // ~1% profit on a fraction of capital
  } else {
    globalState.baseMaxSpend *= 0.992; // ~2% loss on a fraction of capital
  }

  // Re-apply hot multiplier if active
  if (globalState.regime.hotMode) {
    globalState.maxSpend = globalState.baseMaxSpend * HotMultiplier;
  } else {
    globalState.maxSpend = globalState.baseMaxSpend;
  }
}
