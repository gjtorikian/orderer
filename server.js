const path = require("path");
const posterPassword = Buffer.from(process.env.POSTER_PASSWORD || "");

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

const iblib = require("@stoqey/ib");
const IBApi = iblib.IBApi;
const EventName = iblib.EventName;

const WinPercentage = 1 + 0.16 / 100; // .16% * 500k = 20 * 8,000

exchangeOverrides = {
  SPCE: "NYSE",
  MSFT: "NYSE",
};

const ib = new IBApi({
  host: "127.0.0.1",
  port: 4001, //4003,
});

const states = {
  READY_TO_BUY: "READY_TO_BUY",
  BUYING: "BUYING",
  // BOUGHT: "BOUGHT",
  // READY_TO_SELL: "READY_TO_SELL",
  SELLING: "SELLING",
  // SOLD: "SOLD",
};
let state = states.READY_TO_BUY;
let sequence = [];

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

let intvl = new Interval(ib.reqCompletedOrders, 5000);

app.get("/", async function (req, res) {
  let password = Buffer.from(req.query.password || "");

  if (!timingSafeEqual(password, posterPassword)) {
    return res.sendStatus(404);
  }

  ib.once(EventName.currentTime, (time) => {
    return res.send(`API time is: ${time}`);
  });
  ib.reqCurrentTime();
});

app.post("/place", function (req, res) {
  return res.sendStatus(404);
  let body = req.body;
  let message = body.message;
  let password = Buffer.from(req.headers.authorization || "");

  if (!timingSafeEqual(password, posterPassword)) {
    return res.sendStatus(404);
  }

  ib.reqPositions();

  ib.once(
    EventName.completedOrdersEnd,
    (account, order, contract, orderState) => {
      if (!lastOrderCompleted) {
        return res.status(204).send("Previous buy hasn't finished yet");
      }

      intvl.stop();

      if (state == states.BUYING) {
        sequence = ["s", contract.stock, order.price, order.totalQuantity];
        state = states.SELLING;
        lastOrderId = 0;
        lastOrderCompleted = false;
        ib.reqIds(1);
      } else if (state == states.SELLING) {
        state = states.READY_TO_BUY;
        positionsCount = 0;
        lastOrderId = 0;
        lastOrderCompleted = false;
      }
    }
  );

  ib.once(EventName.positionEnd, (positions) => {
    if (positionsCount > 0) {
      positionsCount = 0;
      return res.send("Positions already exist");
    }

    sequence = ["b"].concat(message.split(" "));

    if (state == states.READY_TO_BUY) {
      state = states.BUYING;
      ib.reqIds();
      return res.sendStatus(200);
    } else {
      return res.status(204).send("State is not ready to buy");
    }
  });
});

ib.connect();

let positionsCount = 0;
let lastOrderId = 0;
let lastOrderCompleted = false;

ib.on(EventName.error, (err, code, reqId) => {
  console.error(`${err.message} - code: ${code} - reqId: ${reqId}`);
})
  .on(EventName.position, (account, contract, pos, avgCost) => {
    positionsCount++;
  })
  .on(EventName.nextValidId, (orderId) => {
    if (state == states.BUYING) {
      performBuy(orderId);
    } else if (state == states.SELLING) {
      performSell(orderId);
    }
  })
  .on(EventName.completedOrder, (account, order, contract, orderState) => {
    if (lastOrderId == order.orderId) {
      lastOrderCompleted = true;
    }
  });

function performBuy(orderId) {
  let stock = sequence[1];
  let quantity = parseInt(sequence[2]);
  let price = parseFloat(sequence[3]);

  console.log(ib);
  let contract = ib.contract(stock);

  contract.exchange = exchangeOverrides[stock] || contract.exchange;

  const order = {
    orderType: OrderType.LMT,
    action: OrderAction.BUY,
    lmtPrice: price,
    orderId,
    totalQuantity: quantity,
    account: process.env.ACCOUNT_ID,
  };

  lastOrderId = orderId;

  ib.placeOrder(orderId, contract, order);
  intvl.run();
}

function performSell(orderId) {
  let stock = sequence[1].stock;
  let quantity = parseInt(sequence[2]);
  let price = parseFloat(sequence[3]);

  let contract = ib.contract.stock(stock);
  contract.exchange = exchangeOverrides[stock] || contract.exchange;

  const order = {
    orderType: OrderType.LMT,
    action: OrderAction.SELL,
    lmtPrice: Math.round(price * WinPercentage) / 100,
    orderId,
    totalQuantity: quantity,
    account: process.env.ACCOUNT_ID,
  };

  lastOrderId = orderId;

  ib.placeOrder(orderId, contract, order);
  intvl.run();
}

server.listen(port, function () {
  console.log(`Listening on ${port}`);
});
