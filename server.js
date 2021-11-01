const path = require("path");
const posterPassword = Buffer.from(process.env.POSTER_PASSWORD);

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

class Interval {
  constructor(f, n) {
    this.fn = f;
    this.repeatInterval = n;
    this.handle = null;
  }

  get running() {
    return this.handle !== null;
  }

  run(...args) {
    if (!this.running) {
      this.handle = setInterval(this.fn, this.repeatInterval, ...args);
    } else {
      // optionally throw, display msg, whatever
    }
    return this;
  }

  stop() {
    clearInterval(this.handle);
    this.handle = null;
    return this;
  }
}

const ib = new (require("ib"))({
  host: "127.0.0.1",
  port: 4003,
});

const WinPercentage = 1 + 0.16 / 100; // .16% * 500k = 20 * 8,000
const WinCount = 2;
let openOrders = 0;
let message = "";

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

app.post("/place", function (req, res) {
  let body = req.body;
  message = body.message;
  let password = Buffer.from(req.headers.authorization || "");

  if (!timingSafeEqual(password, posterPassword)) {
    return res.sendStatus(404);
  }

  openOrders = 0;
  ib.reqOpenOrders();
});

ib.connect();

let positionsCount = 0;
let lastOrderId = 0;
let lastOrderCompleted = false;
let winTimes = 0;

ib.on("error", (err, code, reqId) => {
  console.error(`${err.message} - code: ${code} - reqId: ${reqId}`);
})
  .on("position", (account, contract, pos, avgCost) => {
    if (contract.symbol != "GME" && pos != 0) {
      positionsCount++;
    }
  })
  .on("nextValidId", (orderId) => {
    console.log(`Next order Id ${orderId} in state ${state}`);
    if (state == states.BUYING) {
      performBuy(orderId);
    } else if (state == states.READY_TO_SELL) {
      console.log("Entering SELLING state");
      lastOrderId = 0;
      lastOrderCompleted = false;
      state = states.SELLING;
      performSell(orderId);
    } else {
      console.log(`State is ${state}`);
    }
  })
  .on(
    "orderStatus",
    (orderId, status, filled, remaining, avgFillPrice, ...args) => {
      if (lastOrderId == orderId) {
        console.log(
          `Order #${orderId} filled in state ${state} (lastOrderCompleted = ${lastOrderCompleted})`
        );
        if (state == states.BUYING) {
          if (lastOrderCompleted) {
            lastOrderCompleted = false;
            state = states.READY_TO_SELL;
            // set price to sell off of avgFillPrice, not original order submitted price
            // this includes cost of commissions etc
            sequence[3] = avgFillPrice;
            console.log("Preparing to sell");
            ib.reqIds(1);
          } else {
            // for some reason orderStatus is called twice for the same order
            lastOrderCompleted = true;
          }
        } else if (state == states.SELLING) {
          if (lastOrderCompleted) {
            winTimes++;
            state = states.READY_TO_BUY;
          } else {
            // for some reason orderStatus is called twice for the same order
            lastOrderCompleted = true;
          }
        }
      }
    }
  )
  .on("openOrder", function (orderId, contract, order, orderState) {
    // Check open orders
    openOrders++;
  })
  .on("openOrderEnd", function () {
    if (openOrders > 0) {
      return res.status(202).send("Previous order hasn't finished yet");
    } else if (winTimes >= WinCount) {
      return res.status(202).send(`Already won ${winTimes}, done for the day`);
    } else if (state === states.READY_TO_BUY) {
      ib.once("positionEnd", (positions) => {
        if (positionsCount > 0) {
          msg = `After requesting positions: ${positionsCount} positions already exist`;
          positionsCount = 0;
          console.log(msg);
          return res.send(msg);
        }

        console.log("Entering BUYING state");
        state = states.BUYING;
        sequence = message.split(" ");
        ib.reqIds(1);
        return res.sendStatus(200);
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

  console.log(`Placing buy #${lastOrderId} of ${stock} @ ${price}`);
  ib.placeOrder(orderId, contract, order);
}

function performSell(orderId) {
  let stock = sequence[1];
  let quantity = parseInt(sequence[2]);
  let price = round(WinPercentage * parseFloat(sequence[3]), 2);

  contract = ib.contract.stock(stock);

  order = ib.order.limit("SELL", quantity, price);
  lastOrderId = orderId;

  console.log(`Placing sell #${lastOrderId} of ${stock} @ ${price}`);
  ib.placeOrder(orderId, contract, order);
}

server.listen(port, function () {
  console.log(`Listening on ${port}`);
});
