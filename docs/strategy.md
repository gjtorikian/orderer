# Trading Strategy

This document describes the adaptive long/short strategy implemented in orderer, derived from backtesting 81,961 predictions over 138 trading days (Sep 2025 – Apr 2026).

## Overview

The strategy uses figureer prediction metrics to classify signals as long (stock going up) or short (stock going down), trades multiple concurrent positions, and dynamically scales leverage based on early-day performance.

## Signal Filters

### Long filter (Moderate tier)

```
onBalanceRun > 1.9724 AND vwapGain > 3.4966
```

- **Historical WR:** 75.9% (at 1% win / 2% loss thresholds)
- **EV/trade:** +0.278%
- **Coverage:** Active 97% of trading days
- **Avg time to win:** ~22 minutes
- **Avg time to loss:** ~23 minutes

### Short filter (Reversal signal)

```
boxRatio < 0.1939 AND thrust > 5.2361
```

- **Historical WR:** 98.8% (337 trades, 4 losses)
- **Coverage:** Sparse — fires on ~30% of days
- **Use case:** High-confidence shorts when the signal appears

### What the metrics mean

| Metric | Description | Long signal | Short signal |
|--------|-------------|-------------|--------------|
| `onBalanceRun` | Volume-weighted momentum | High (>1.97) = bullish pressure | — |
| `vwapGain` | Price deviation from VWAP | High (>3.50) = strong above VWAP | — |
| `boxRatio` | Price consolidation pattern | — | Low (<0.19) = breaking down |
| `thrust` | Rate of price change | — | High (>5.24) = overextended, reversal likely |
| `acceleration` | Rate of thrust change | Strong predictor of direction (used in aggressive filters) | — |
| `velocity` | Smoothed momentum | High = strong trend | — |

## Adaptive Regime

The regime system solves a key problem: some days the filter's edge is much stronger than others. By testing the water with the first 2 trades, the bot detects good days early and scales up.

### Logic

```
Day starts → base leverage (e.g., 4x)
  First 2 trades both win? → HOT MODE: scale to 10x for rest of day
  First 2 trades include 2 losses? → COLD SHUTDOWN: stop trading
  Otherwise → stay at base leverage
```

### Why this works

From backtesting on 100 trading days:
- Days where the first 2 trades win tend to continue winning (39 out of 96 active days triggered hot mode)
- Hot mode captured the bulk of profits: the 9-11 days over $1,000 profit carry the portfolio
- Cold shutdown avoids the worst days (like Apr 14: -$4,504 unprotected)

### Performance (backtested, $70k starting capital)

| Config | Final | Return | Max Drawdown |
|--------|-------|--------|-------------|
| Long+Short, 4x/10x adaptive | $109,920 | +57.0% | 6.6% |
| Long+Short, 5x/14x adaptive | $126,543 | +80.8% | 8.8% |
| Long-only, 4x/10x adaptive | $107,208 | +53.2% | 6.6% |

## Entry Monitoring

After placing an entry order, the bot monitors the stock's price and cancels if it moves unfavorably. This applies to both long and short entries.

| Time | Condition | Action |
|------|-----------|--------|
| 1 min | Price moved >0.2% against entry | Cancel (WR drops below breakeven) |
| 1 min | Price moved >0.5% in favor, unfilled | Cancel (missed the move) |
| 3 min | Any movement against entry | Cancel |
| 3 min | Still favorable >0.5%, unfilled | Cancel |
| 5 min | Any state | Hard cancel |

## Exit Orders

Every filled entry immediately gets an OCA (One-Cancels-All) exit pair:

### Long position exits
- **Profit target:** SELL limit at `entryPrice + (SLOT_PROFIT_AMOUNT / quantity)`
- **Stop loss:** SELL stop at `entryPrice - (SLOT_LOSS_AMOUNT / quantity)`

### Short position exits
- **Profit target:** BUY limit at `entryPrice - (SLOT_PROFIT_AMOUNT / quantity)`
- **Stop loss:** BUY stop at `entryPrice + (SLOT_LOSS_AMOUNT / quantity)`

The first order to fill cancels the other.

## Compounding

Position sizes adjust automatically as capital grows or shrinks:
- After a win: base capital grows by ~0.4%
- After a loss: base capital shrinks by ~0.8%
- Hot mode multiplier applies on top of the adjusted base

Over time, this compounds — a winning streak grows position sizes, increasing dollar returns.

## Risk Management

| Protection | Mechanism |
|------------|-----------|
| Per-trade stop loss | OCA pair ensures every position has a hard stop |
| Daily cold shutdown | 2 early losses → stop trading for the day |
| Entry monitoring | Cancel unfilled orders if price moves wrong in 1-5 minutes |
| Margin cap | `maxSpend` capped at IBKR BuyingPower and available Reg-T margin |
| Slot limit | Max 25 concurrent positions prevents overexposure |
| Compounding decay | Losses shrink subsequent position sizes automatically |
