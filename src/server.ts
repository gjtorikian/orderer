import "./config/constants";
import * as bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import * as http from "http";
import * as path from "path";

import { port, TWILIO_CONFIG } from "./config/constants";
import { createIndexRoute } from "./routes/index";
import { createPlaceRoute } from "./routes/place";
import { type GlobalState, States } from "./types";
import { log, error } from "./utils/logger";
import { IBKRClient } from "./utils/ibkr-client";
import { IBKRMonitor } from "./utils/ibkr-monitor";

const app: express.Application = express();
const server: http.Server = http.createServer(app);

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());
app.use(cors());

const twilio = require("twilio")(
  TWILIO_CONFIG.accountSid,
  TWILIO_CONFIG.authToken,
);

const globalState: GlobalState = {
  state: States.READY_TO_BUY,
  currentTrade: {
    price: 0,
    quantity: 0,
    symbol: "",
  },
  sequence: [],
  openOrders: 0,
  message: "",
  latestOrderRes: null,
  latestOrderFilled: false,
  notifiedOfShort: false,
  positionsCount: 0,
  lastOrderId: 0,
  winTimes: 0,
};

const ibkrClient = IBKRClient.getInstance();
const ibkrMonitor = IBKRMonitor.getInstance(globalState, twilio);

app.get("/", createIndexRoute());
app.post("/place", createPlaceRoute(globalState, twilio));

// Initialize IBKR connection
async function initializeIBKR(): Promise<void> {
  try {
    log("Initializing IBKR connection...");
    await ibkrClient.connect();
    log("IBKR connected successfully");
    
    // Start monitoring for order updates
    ibkrMonitor.startMonitoring();
    
  } catch (err: any) {
    error(`Failed to initialize IBKR: ${err.message}`);
    // Retry connection in 30 seconds
    setTimeout(initializeIBKR, 30000);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  log('SIGTERM received, shutting down gracefully');
  ibkrMonitor.stopMonitoring();
  server.close(() => {
    log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log('SIGINT received, shutting down gracefully');
  ibkrMonitor.stopMonitoring();
  server.close(() => {
    log('Server closed');
    process.exit(0);
  });
});

// Start everything
server.listen(port, (): void => {
  log(`Listening on ${port}`);
  
  // Initialize IBKR after server starts
  setTimeout(initializeIBKR, 1000);
});