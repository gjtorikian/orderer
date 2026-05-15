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
    "boxRatio": 0.48,
    "thrust": 1.31,
    "acceleration": 0.007,
    "velocity": 0.087,
    "onBalanceRun": 0.82,
    "vwapGain": 3.29
  }
}
```

| Field       | Type   | Required | Description                                                                                                                            |
| ----------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `message`   | string | Yes      | Trade signal. Format: `"b TICKER PRICE"`. The `b` prefix is required (historical convention).                                          |
| `metrics`   | object | No       | Prediction metrics from rcandy. Orderer passes them through for logging; it does not filter on them.                                   |
| `metrics.*` | number | No       | Prediction metric values (`boxRatio`, `thrust`, etc.).                                                                                 |

**Responses:**

| Status | Meaning                                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------- |
| `200`  | Trade accepted and order placed. In SLOTS mode, body includes slot info like `"Slot 3 (4/25)"`.      |
| `202`  | Trade deferred — previous order still open, or all slots occupied.                                   |
| `204`  | Trade rejected — cold shutdown active, or daily win limit reached.                                   |
| `404`  | Auth failed.                                                                                         |
| `503`  | Bot not ready (still waiting for IBKR account data).                                                 |

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
POST /place
  → reqOpenOrders() → check slot availability
  → performSlotEntry(): place limit BUY
  → monitorSlotBuyOrder(): cancel if price moves against (1m/3m/5m checks)
  → on fill: performSlotSell(): place OCA exit pair (SELL limit profit + SELL stop loss)
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
