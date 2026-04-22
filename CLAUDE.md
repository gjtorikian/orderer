# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

This is a stock trading bot that connects to Interactive Brokers (IBKR) via the `@stoqey/ib` API client. It runs an Express server (port 5592) that receives trade signals via HTTP POST and executes buy/sell orders through IBKR's TWS/Gateway.

More information can be found in docs.

### Flow

1. @/Users/gjtorikian/Developer/rcandy POSTs to `/place` with a message like `"b AAPL 150.00"` (password-authenticated via `Authorization` header)
2. The server checks open orders and positions via IB events, then executes a limit buy
3. After buy fills, it automatically places an OCA (One-Cancels-All) pair: a profit-target limit sell and a stop-loss sell
4. Buy orders are monitored and auto-cancelled based on price movement (1m/3m/5m checks)
5. SMS notifications are sent via Twilio on fills and completions

### Trading Modes (set via `TRADING_MODE` env var)

- **PERCENTAGE**: profit/loss targets as percentages of buy price (`WIN_PERCENTAGE`, `LOSS_PERCENTAGE`)
- **FIXED**: fixed dollar profit/loss amounts (`FIXED_PROFIT_AMOUNT`, `FIXED_LOSS_AMOUNT`)
- **SLOTS**: multiple concurrent positions with fixed amounts (`MAX_SLOTS`, `SLOT_PROFIT_AMOUNT`, `SLOT_LOSS_AMOUNT`)

### Key State Management

All trading state lives in a single `GlobalState` object (defined in `src/types/index.ts`) initialized in `server.ts`. The state machine cycles: `READY_TO_BUY → BUYING → SELLING → READY_TO_BUY`. In SLOTS mode, each slot has its own independent state cycle.

### Source Layout

- `src/server.ts` — Entry point. Sets up Express, IB connection, event listeners, and account summary logic (maxSpend/margin caps)
- `src/config/constants.ts` — All env var parsing and configuration
- `src/types/index.ts` — TypeScript types (`GlobalState`, `Slot`, `States` enum, `TradingMode` enum)
- `src/utils/trading.ts` — Core trading logic: buy/sell execution, OCA order placement, buy-order monitoring with timed cancellation, slot management
- `src/events/` — IB event handlers (`orderStatus`, `openOrderEnd`, `position`, `nextValidId`, `error`, `openOrder`)
- `src/routes/` — Express route handlers (`place` for trade signals, `message` for logging predictions, `index` for health check)
- `src/utils/auth.ts` — Timing-safe password verification
- `predictions/` — Daily prediction log files (written by `/message` route)

### Important Details

- `MAX_SPEND` env var can be `"ALL"` to use account's total cash value, or a fixed number
- Order IDs are managed via `globalState.nextOrderId`, initialized from IB's `nextValidId` event
- The bot caps `maxSpend` at the lesser of: configured amount, BuyingPower, and available Reg-T margin capacity
- Buy order monitoring uses market data tick subscriptions (`reqMktData`) with reqId 8001 for single-trade mode, 8100+ for slots
- `WinCounterMax` limits total wins per day before the bot stops trading
