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

| Field       | Type   | Required | Description                                                                                                                                                                                                    |
| ----------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message`   | string | Yes      | Trade signal. Format: `"b TICKER PRICE"` or `"b TICKER PRICE MAXSHARES"`. The `b` prefix is required (historical convention). `MAXSHARES` caps the quantity below `floor(maxSpend / PRICE)` (non-SLOTS modes). |
| `metrics`   | object | No       | Prediction metrics from rcandy. Orderer passes them through for logging; it does not filter on them.                                                                                                           |
| `metrics.*` | number | No       | Prediction metric values (`boxRatio`, `thrust`, etc.).                                                                                                                                                         |

**Responses:**

| Status | Meaning                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------- |
| `200`  | Trade accepted and order placed. In SLOTS mode, body includes slot info like `"Slot 3 (4/25)"`. |
| `202`  | Trade deferred — previous order still open, or all slots occupied.                              |
| `204`  | Trade rejected — cold shutdown active, or daily win limit reached.                              |
| `404`  | Auth failed.                                                                                    |
| `503`  | Bot not ready (still waiting for IBKR account data).                                            |

---

### `POST /alert`

Send an SMS to `MY_NUMBER` via Twilio. Does not trigger any trades, and works even before the bot is ready.

**Auth:** `Authorization` header.

**Body:**

```json
{
  "message": "Heads up: AAPL scan triggered"
}
```

The message is truncated to 1500 characters.

**Responses:**

| Status | Meaning                     |
| ------ | --------------------------- |
| `204`  | SMS sent.                   |
| `400`  | `message` missing or empty. |
| `404`  | Auth failed.                |
| `500`  | Twilio send failed.         |

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

---

### `GET /quote`

Latest IB quote for any US stock, as JSON. Read-only: never places, changes or cancels orders. Works whenever IB is connected, even before the bot is ready.

**Auth:** `Authorization` header (or `?password=` like `GET /`).

**Query:** `symbol=SLS` (US stock on SMART) or `conId=390872440`.

```bash
curl -H "Authorization: $POSTER_PASSWORD" "https://<orderer>/quote?symbol=SLS"
```

```json
{
  "symbol": "SLS",
  "last": 10.49,
  "bid": 10.48,
  "ask": 10.5,
  "close": 10.31,
  "halted": false,
  "lastAt": "2026-10-20T19:59:58.120Z",
  "updatedAt": "2026-10-20T19:59:58.120Z",
  "subscribedAt": "2026-10-20T13:30:01.004Z"
}
```

| Field                         | Meaning                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `last`, `bid`, `ask`, `close` | Latest values from IB, or `null` if IB hasn't sent that field. Includes extended hours where IB streams them.                               |
| `halted`                      | IB's halted tick: `false` trading, `true` halted (`haltKind`: `"general"` or `"volatility"` for a LULD pause). `null` until IB has sent it. |
| `lastAt`                      | When orderer received the last `last` tick, not the exchange print time.                                                                    |

The first request for a symbol opens a streaming `reqMktData` subscription and waits up to 3 s for data. Later requests read the cache, so polling every second is cheap. A symbol not requested for 10 minutes is unsubscribed, and at most 40 are open at once (least recently used goes first), leaving market-data lines for the buy monitors. Subscriptions use reqIds from 2,100,000,000 up, so they can't be mistaken for order ids in the error handler.

**Responses:**

| Status | Meaning                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------- |
| `200`  | Quote JSON.                                                                                             |
| `400`  | Neither a valid `symbol` nor `conId`.                                                                   |
| `404`  | Auth failed, or IB has no such security (IB error 200).                                                 |
| `502`  | IB refused market data (no subscription / permissions, competing session). Retried on the next request. |
| `503`  | Not connected to IB.                                                                                    |
| `504`  | Subscribed, but no data within 3 s (thin name outside hours). Try again.                                |

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
