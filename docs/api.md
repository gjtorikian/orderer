# API Reference

The bot runs an Express server on port **5592**.

All authenticated endpoints require the `Authorization` header to match `POSTER_PASSWORD`.

## Endpoints

### `GET /`

Health check. Returns IBKR server time.

**Auth:** Password as query parameter `?password=...`

**Response:** `200` with server time string.

---

### `POST /place`

Submit a trade signal. This is the primary endpoint called by the signal generator (rcandy).

**Auth:** `Authorization` header.

**Body:**

```json
{
  "message": "b AAPL 150.00",
  "metrics": {
    "boxRatio": 0.484,
    "thrust": 1.314,
    "acceleration": 0.007,
    "velocity": 0.087,
    "onBalanceRun": 0.825,
    "vwapGain": 3.292
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes | Trade signal. Format: `"b TICKER PRICE"`. The `b` prefix is required (historical convention for "buy signal"). |
| `metrics` | object | No | Prediction metrics from figureer. When provided in SLOTS mode, the bot classifies the signal as long, short, or skip. When omitted, the signal is treated as a long buy. |

**Metrics fields:**

| Field | Type | Description |
|-------|------|-------------|
| `boxRatio` | number | Box ratio metric. |
| `thrust` | number | Thrust metric. |
| `acceleration` | number | Acceleration metric. |
| `velocity` | number | Velocity metric. |
| `onBalanceRun` | number | On-balance run metric. |
| `vwapGain` | number | VWAP gain metric. |

**Responses:**

| Status | Meaning |
|--------|---------|
| `200` | Trade accepted and order placed. In SLOTS mode, body includes slot info like `"Slot 3 long (4/25)"`. |
| `202` | Trade deferred — previous order still open, or all slots occupied. |
| `204` | Trade rejected — signal filtered out, cold shutdown active, or daily win limit reached. |
| `404` | Auth failed. |
| `503` | Bot not ready (still waiting for IBKR account data). |

---

### `POST /message`

Log a prediction to the daily file. Does not trigger any trades.

**Auth:** `Authorization` header.

**Body:**

```json
{
  "message": "Predicted AAPL at 5: 0.484054 1.313774 0.006753 0.086648 0.8249 3.291875"
}
```

**Response:** `204` on success.

Predictions are appended to `predictions/YYYY-MM-DD.txt`.

## Trade Lifecycle

### SLOTS mode

```
POST /place with metrics
  → classifySignal(): long / short / skip
  → reqOpenOrders() → check slot availability
  → performSlotEntry(): place limit order (BUY for long, SELL for short)
  → monitorSlotBuyOrder(): cancel if price moves against (1m/3m/5m checks)
  → on fill: performSlotSell(): place OCA exit pair
      Long:  SELL limit (profit) + SELL stop (loss)
      Short: BUY limit (profit)  + BUY stop (loss)
  → on exit fill: updateRegime(), free slot, SMS notification
```

### Single-position modes (PERCENTAGE / FIXED)

```
POST /place (no metrics needed)
  → reqOpenOrders() → check state is READY_TO_BUY
  → performBuy(): place limit buy
  → monitorBuyOrder(): cancel if price moves against
  → on fill: performSell(): place OCA sell pair (profit limit + stop loss)
  → on exit fill: increment winTimes, SMS notification
```
