if (process.env.NODE_ENV != "production") {
  require("dotenv").config();
}

const path = require("path");
const posterPassword = Buffer.from(process.env.POSTER_PASSWORD);

const accountSid = process.env.TWILIO_ACCOUNT_SID; // Your Account SID from www.twilio.com/console
const authToken = process.env.TWILIO_AUTH_TOKEN; // Your Auth Token from www.twilio.com/console

const express = require("express");
const cors = require("cors");
const app = express();
const server = require("http").Server(app);
const bodyParser = require("body-parser");
const timingSafeEqual = require("crypto").timingSafeEqual;

const port = 5592;

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());

app.use(cors());

const twilio = new require("twilio")(accountSid, authToken);

const ib = new (require("ib"))({
  host: "127.0.0.1",
  port: 4001,
});

// .16% * 250k = 20 * 8,000; .25% takes care of commissions
const WinPercentage = 1 + 0.25 / 100;
const WinCounterMax = 5;
let openOrders = 0;
let message = "";
let latestOrderRes = null;
let latestOrderFilled = false;
let notifiedOfShort = false;

exchangeOverrides = {
  SPCE: "NYSE",
  MSFT: "NYSE",
};

const states = {
  READY_TO_BUY: "READY_TO_BUY",
  BUYING: "BUYING",
  // BOUGHT: "BOUGHT",
  READY_TO_SELL: "READY_TO_SELL",
  SELLING: "SELLING",
  // SOLD: "SOLD",
};
let state = states.READY_TO_BUY;
let sequence = [];

function log(str) {
  let tz = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  console.log(`${tz}: ${str}`);
}

function error(str) {
  let tz = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  console.error(`${tz}: ${str}`);
}

app.get("/", async function (req, res) {
  let password = Buffer.from(req.query.password || "");

  if (!timingSafeEqual(password, posterPassword)) {
    return res.sendStatus(404);
  }

  ib.once("currentTime", (time) => {
    return res.send(`API time is: ${time}`);
  });
  ib.reqCurrentTime();
});

app.post("/place", async function (req, res) {
  try {
    let body = req.body;
    message = body.message;
    let password = Buffer.from(req.headers.authorization || "");

    if (!timingSafeEqual(password, posterPassword)) {
      return res.sendStatus(404);
    }

    if (!message.startsWith("b ")) {
      await twilio.messages.create({
        body: message,
        to: process.env.MY_NUMBER,
        from: process.env.TWILIO_NUMBER,
      });
      return res.sendStatus(202);
    } else {
      openOrders = 0;
      latestOrderRes = res;

      ib.reqOpenOrders();
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

ib.connect();

let positionsCount = 0;
let lastOrderId = 0;
let winTimes = 0;

ib.on("error", (err, code, reqId) => {
  data = JSON.stringify(code, null, 2);

  // 202: "An active order on the IB server was cancelled."
  // 10148: "An attempt was made to cancel an order that had already been filled by the system."
  // 1100/1102: connectivity issues
  if (
    code &&
    code.code != 202 &&
    code.code != 10148 &&
    code.code != 1100 &&
    code.code != 1102
  ) {
    error(`${err.message} - code: ${data} - reqId: ${reqId}`);
  }
})
  .on("position", async (account, contract, pos, avgCost) => {
    // sometimes IBKR spits out closed positions
    if (pos != 0) {
      log(`Position: ${contract.symbol} - ${pos} @ ${avgCost}`);
      positionsCount++;
    }
    if (pos < 0 && !notifiedOfShort) {
      notifiedOfShort = true;
      await twilio.messages.create({
        body: "WARNING: Short position identified",
        to: process.env.MY_NUMBER,
        from: process.env.TWILIO_NUMBER,
      });
    }
  })
  .on("nextValidId", (orderId) => {
    log(`Next order Id ${orderId} in state ${state}`);
    if (state == states.BUYING) {
      performBuy(orderId);
    } else if (state == states.READY_TO_SELL) {
      // log("Entering SELLING state");
      lastOrderId = 0;
      state = states.SELLING;
      performSell(orderId);
    } else {
      log(`State is ${state}`);
    }
  })
  .on(
    "orderStatus",
    async (orderId, status, filled, remaining, avgFillPrice, ...args) => {
      unfulfilledCancelled =
        isCancelled(status) && remaining != 0 && avgFillPrice > 0;
      if (lastOrderId == orderId && (unfulfilledCancelled || remaining == 0)) {
        if (unfulfilledCancelled) {
          state = states.BUYING;
        }

        if (state == states.BUYING) {
          latestOrderFilled = true;

          state = states.READY_TO_SELL;
          // set price to sell off of avgFillPrice, not original order submitted price
          // this includes cost of commissions etc
          sequence[3] = avgFillPrice;

          // if cancelled, use quantity of what was actually bought
          if (unfulfilledCancelled) {
            sequence[2] = filled;
          }

          ib.reqIds(1);
        } else if (state == states.SELLING) {
          notifiedOfShort = false;
          state = states.READY_TO_BUY;
          setTimeout(async function () {
            winTimes++;
            let text = `Sold order #${orderId} (${winTimes} / ${WinCounterMax})`;
            log(text);
            await twilio.messages.create({
              body: text,
              to: process.env.MY_NUMBER,
              from: process.env.TWILIO_NUMBER,
            });
          }, 3000);
        }
      }
    }
  )
  .on("openOrder", function (orderId, contract, order, orderState) {
    // Check open orders
    openOrders++;
  })
  .on("openOrderEnd", async function () {
    if (latestOrderRes == null) {
      return;
    }

    if (openOrders > 0) {
      return latestOrderRes
        .status(202)
        .send("Previous order hasn't finished yet");
    } else if (winTimes >= WinCounterMax) {
      let eodMsg = `Already won ${winTimes} times, done for the day`;
      await twilio.messages.create({
        body: eodMsg,
        to: process.env.MY_NUMBER,
        from: process.env.TWILIO_NUMBER,
      });

      return latestOrderRes.status(204).send(eodMsg);
    } else if (state === states.READY_TO_BUY) {
      ib.once("positionEnd", () => {
        if (positionsCount > 1) {
          let note = `Note: ${positionsCount} positions already exist`;
          positionsCount = 0;
          // log(note);
          return latestOrderRes.send(note);
        }

        // log("Entering BUYING state");
        state = states.BUYING;
        sequence = message.split(" ");
        ib.reqIds(1);
        return latestOrderRes.sendStatus(200);
      });

      ib.reqPositions();
    }
  });

function round(value, decimals) {
  return Number(Math.round(value + "e" + decimals) + "e-" + decimals);
}

function performBuy(orderId) {
  let stock = sequence[1];
  let quantity = parseInt(sequence[2]);
  let price = parseFloat(sequence[3]);

  contract = ib.contract.stock(stock);
  contract.exchange = exchangeOverrides[stock] || contract.exchange;

  order = ib.order.limit("BUY", quantity, price);
  lastOrderId = orderId;

  // if the order does not complete in full soon enough, cancel it.
  setTimeout(
    function (orderId) {
      if (!latestOrderFilled) {
        latestOrderRes = null;
        log(`Cancelling order #${orderId}`);
        ib.cancelOrder(orderId);
        state = states.READY_TO_BUY;
      }
      latestOrderFilled = false;
    },
    7500,
    orderId
  );

  log(`Placing buy #${lastOrderId} of ${stock}: ${quantity} @ ${price}`);
  ib.placeOrder(orderId, contract, order);
}

function isCancelled(status) {
  return status == "PendingCancel" || /Cancelled$/.test(status);
}

function performSell(orderId) {
  let stock = sequence[1];
  let quantity = parseInt(sequence[2]);
  let price = round(WinPercentage * parseFloat(sequence[3]), 2);

  contract = ib.contract.stock(stock);

  order = ib.order.limit("SELL", quantity, price);
  lastOrderId = orderId;

  log(`Placing sell #${lastOrderId} of ${stock}: ${quantity} @ ${price}`);
  ib.placeOrder(orderId, contract, order);
}

server.listen(port, function () {
  log(`Listening on ${port}`);
});
