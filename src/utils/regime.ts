import { WarmupTrades, HotThreshold, HotMultiplier } from "../config/constants";
import type { GlobalState } from "../types";
import { log } from "./logger";

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function checkRegimeDayRollover(globalState: GlobalState): void {
  const today = todayET();
  if (globalState.regime.currentDate !== today) {
    log(`New trading day: ${today} (was ${globalState.regime.currentDate}). Resetting regime.`);
    globalState.regime = {
      warmupWins: 0,
      warmupLosses: 0,
      warmupResolved: 0,
      hotMode: false,
      currentDate: today,
      dailyWins: 0,
      dailyLosses: 0,
    };
    globalState.maxSpend = globalState.baseMaxSpend;
  }
}

export function updateRegime(globalState: GlobalState, wasWin: boolean): void {
  if (wasWin) {
    globalState.regime.dailyWins++;
  } else {
    globalState.regime.dailyLosses++;
  }

  if (!globalState.regime.hotMode) {
    globalState.regime.warmupResolved++;

    if (wasWin) {
      globalState.regime.warmupWins++;
    } else {
      globalState.regime.warmupLosses++;
    }

    if (globalState.regime.warmupResolved >= WarmupTrades) {
      const winRate = globalState.regime.warmupWins / globalState.regime.warmupResolved;
      if (winRate >= HotThreshold) {
        globalState.regime.hotMode = true;
        globalState.maxSpend = globalState.baseMaxSpend * HotMultiplier;
        log(`HOT MODE ACTIVATED: ${globalState.regime.warmupWins}/${globalState.regime.warmupResolved} wins (${(winRate * 100).toFixed(0)}% >= ${(HotThreshold * 100).toFixed(0)}%). maxSpend scaled to ${globalState.maxSpend} (${HotMultiplier}x)`);
      } else {
        log(`Warmup complete: ${globalState.regime.warmupWins}/${globalState.regime.warmupResolved} wins (${(winRate * 100).toFixed(0)}%). Staying at base leverage.`);
      }
    }
  }

  if (wasWin) {
    globalState.baseMaxSpend *= 1.004;
  } else {
    globalState.baseMaxSpend *= 0.992;
  }

  if (globalState.regime.hotMode) {
    globalState.maxSpend = globalState.baseMaxSpend * HotMultiplier;
  } else {
    globalState.maxSpend = globalState.baseMaxSpend;
  }
}
