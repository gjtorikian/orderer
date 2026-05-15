# Configuration Reference

All configuration is done via environment variables (`.env` file). See `.env.example` for a template.

## Authentication

| Variable          | Required | Description                                                                                                            |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `POSTER_PASSWORD` | Yes      | Password for `/place` and `/message` endpoints. Checked via timing-safe comparison against the `Authorization` header. |

## Interactive Brokers

| Variable          | Required | Default | Description                                                         |
| ----------------- | -------- | ------- | ------------------------------------------------------------------- |
| `IBKR_ACCOUNT_ID` | Yes      | —       | Your IBKR account ID (e.g. `DU12345` for paper, `U12345` for live). |

Connection to TWS/Gateway is hardcoded to `127.0.0.1:4001`. TWS or IB Gateway must be running locally.

## Twilio (SMS Notifications)

| Variable             | Required | Description                                              |
| -------------------- | -------- | -------------------------------------------------------- |
| `TWILIO_ACCOUNT_SID` | Yes      | Twilio account SID.                                      |
| `TWILIO_AUTH_TOKEN`  | Yes      | Twilio auth token.                                       |
| `MY_NUMBER`          | Yes      | Your phone number (receives SMS). Format: `+1234567890`. |
| `TWILIO_NUMBER`      | Yes      | Twilio sender number. Format: `+1234567890`.             |

## Trading Modes

Set `TRADING_MODE` to one of three values:

### `PERCENTAGE` (default)

Single-position mode. Profit and loss targets are percentages of the entry price.

| Variable          | Default      | Description                                                 |
| ----------------- | ------------ | ----------------------------------------------------------- |
| `TRADING_MODE`    | `PERCENTAGE` | Set to `PERCENTAGE`.                                        |
| `WIN_PERCENTAGE`  | `1`          | Profit target as percent of entry price. `1` = sell at +1%. |
| `LOSS_PERCENTAGE` | `2`          | Stop loss as percent of entry price. `2` = stop at -2%.     |
| `WIN_COUNTER_MAX` | `2`          | Stop trading after this many wins per day.                  |

### `FIXED`

Single-position mode. Profit and loss targets are fixed dollar amounts.

| Variable              | Default | Description                                        |
| --------------------- | ------- | -------------------------------------------------- |
| `TRADING_MODE`        | —       | Set to `FIXED`.                                    |
| `FIXED_PROFIT_AMOUNT` | `100`   | Take profit when position is up this many dollars. |
| `FIXED_LOSS_AMOUNT`   | `200`   | Stop loss when position is down this many dollars. |
| `WIN_COUNTER_MAX`     | `2`     | Stop trading after this many wins per day.         |

### `SLOTS`

Multi-position mode. Runs up to `MAX_SLOTS` independent concurrent positions, each with fixed-dollar exit targets.

| Variable             | Default | Description                                                     |
| -------------------- | ------- | --------------------------------------------------------------- |
| `TRADING_MODE`       | —       | Set to `SLOTS`.                                                 |
| `MAX_SLOTS`          | `25`    | Maximum concurrent positions. Each slot operates independently. |
| `SLOT_PROFIT_AMOUNT` | `100`   | Per-slot profit target in dollars.                              |
| `SLOT_LOSS_AMOUNT`   | `200`   | Per-slot stop loss in dollars.                                  |

## Position Sizing

| Variable               | Default  | Description                                                                                                                           |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_SPEND`            | `100000` | Capital budget per trade. Set to `ALL` to use the account's total cash value (queried from IBKR on startup).                          |
| `MAX_SPEND_MULTIPLIER` | `1`      | Multiplier applied to `MAX_SPEND`. Use for margin leverage. For example, `4` with `MAX_SPEND=ALL` means 4x your cash value per trade. |

In `SLOTS` mode, the per-slot position size is `maxSpend / price`, quantized to lots of 10 shares. The effective per-slot capital is `maxSpend` (which may be scaled by the adaptive regime — see below).

The bot caps `maxSpend` at startup to the lesser of:

1. The configured value (`MAX_SPEND * MAX_SPEND_MULTIPLIER`)
2. IBKR `BuyingPower`
3. Available Reg-T margin capacity (`(RegTEquity - InitMarginReq) * 2`)

## Adaptive Regime

The adaptive regime system detects "hot" days early and scales up position sizes automatically. It only applies in `SLOTS` mode.

| Variable               | Default | Description                                                                                                                                                                                          |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WARMUP_TRADES`        | `5`     | Number of initial trades to evaluate before deciding regime.                                                                                                                                         |
| `HOT_THRESHOLD`        | `0.80`  | Win rate threshold during warmup to activate hot mode. `0.80` = 4 out of 5 warmup trades must win.                                                                                                   |
| `HOT_MULTIPLIER`       | `2.5`   | Multiplier applied to `maxSpend` when hot mode activates. Stacks with `MAX_SPEND_MULTIPLIER`. For example, `MAX_SPEND_MULTIPLIER=4` + `HOT_MULTIPLIER=2.5` = 10x effective leverage during hot mode. |
| `COLD_SHUTDOWN_LOSSES` | `2`     | If this many losses occur during the warmup period, stop accepting trades for the rest of the day.                                                                                                   |

### How it works

1. At the start of each trading day, the regime resets to base mode.
2. The first `WARMUP_TRADES` trade results are tracked.
3. If the win rate during warmup meets or exceeds `HOT_THRESHOLD`, **hot mode** activates: `maxSpend` is multiplied by `HOT_MULTIPLIER` for all remaining trades that day.
4. If losses during warmup reach `COLD_SHUTDOWN_LOSSES`, the bot enters **cold shutdown** and rejects all further signals for the day.
5. Otherwise, the bot continues at base leverage.

### Compounding

After each resolved trade, `baseMaxSpend` is adjusted slightly:

- Win: `baseMaxSpend *= 1.004` (reinvest a fraction of profit)
- Loss: `baseMaxSpend *= 0.992` (reduce exposure after loss)

This compounds over days — position sizes grow as the account grows.

## Example Configurations

### Conservative (no leverage, low risk)

```bash
TRADING_MODE=SLOTS
MAX_SPEND=ALL
MAX_SPEND_MULTIPLIER=1
MAX_SLOTS=25
SLOT_PROFIT_AMOUNT=100
SLOT_LOSS_AMOUNT=200
WARMUP_TRADES=5
HOT_THRESHOLD=0.80
HOT_MULTIPLIER=1        # No scaling
COLD_SHUTDOWN_LOSSES=2
```

### Adaptive with 4x/10x regime (recommended)

```bash
TRADING_MODE=SLOTS
MAX_SPEND=ALL
MAX_SPEND_MULTIPLIER=4
MAX_SLOTS=25
SLOT_PROFIT_AMOUNT=100
SLOT_LOSS_AMOUNT=200
WARMUP_TRADES=5
HOT_THRESHOLD=0.80        # 4/5 wins triggers hot
HOT_MULTIPLIER=2.5        # 4x * 2.5 = 10x in hot mode
COLD_SHUTDOWN_LOSSES=2
```

### Fixed dollar mode (single position, simple)

```bash
TRADING_MODE=FIXED
MAX_SPEND=10000
FIXED_PROFIT_AMOUNT=100
FIXED_LOSS_AMOUNT=200
WIN_COUNTER_MAX=4
```
