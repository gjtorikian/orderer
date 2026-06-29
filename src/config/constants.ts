require("dotenv").config();

import { TradingMode } from "../types";

export const posterPassword: Buffer = Buffer.from(process.env.POSTER_PASSWORD!);
export const accountSid: string = process.env.TWILIO_ACCOUNT_SID!;
export const authToken: string = process.env.TWILIO_AUTH_TOKEN!;

export const port: number = 5592;
export const DRY_RUN: boolean = (process.env.DRY_RUN || "").toLowerCase() === "true";
// Upside-only: place only the profit-target limit sell, no stop loss. A losing
// position is never auto-sold; it holds until exited manually or it recovers to target.
export const DisableStopLoss: boolean = (process.env.DISABLE_STOP_LOSS || "").toLowerCase() === "true";
export const MAX_SPEND_RAW: string = process.env.MAX_SPEND || "100000";
export const UseAllCapital: boolean = MAX_SPEND_RAW.toUpperCase() === "ALL";
if (!UseAllCapital && isNaN(parseInt(MAX_SPEND_RAW, 10))) {
  throw new Error(`Invalid MAX_SPEND value: "${MAX_SPEND_RAW}". Must be a number or "ALL".`);
}
export const MaxSpendFixed: number = UseAllCapital ? 0 : parseInt(MAX_SPEND_RAW, 10);
export const MaxSpendMultiplier: number = parseFloat(process.env.MAX_SPEND_MULTIPLIER || "1");
export const WinPercentage: number = 1 + parseFloat(process.env.WIN_PERCENTAGE || "1") / 100;
export const LossPercentage: number = 1 - parseFloat(process.env.LOSS_PERCENTAGE || "2") / 100;
export const WinCounterMax: number = parseInt(process.env.WIN_COUNTER_MAX || "2", 10);
export const TRADING_MODE: TradingMode = (process.env.TRADING_MODE as TradingMode) || TradingMode.PERCENTAGE;
export const FixedProfitAmount: number = parseFloat(process.env.FIXED_PROFIT_AMOUNT || "100");
export const FixedLossAmount: number = parseFloat(process.env.FIXED_LOSS_AMOUNT || "200");
export const MaxSlots: number = parseInt(process.env.MAX_SLOTS || "25", 10);
export const SlotProfitAmount: number = parseFloat(process.env.SLOT_PROFIT_AMOUNT || "100");
export const SlotLossAmount: number = parseFloat(process.env.SLOT_LOSS_AMOUNT || "200");

// Adaptive regime: after WARMUP_TRADES resolved, if win rate >= HOT_THRESHOLD, scale to HOT_MULTIPLIER
export const WarmupTrades: number = parseInt(process.env.WARMUP_TRADES || "5", 10);
export const HotThreshold: number = parseFloat(process.env.HOT_THRESHOLD || "0.80");
export const HotMultiplier: number = parseFloat(process.env.HOT_MULTIPLIER || "2.5");
// Shutdown if early losses reach this count
export const ColdShutdownLosses: number = parseInt(process.env.COLD_SHUTDOWN_LOSSES || "2", 10);

export const IB_CONFIG = {
  host: "127.0.0.1",
  port: 4001,
};

export const TWILIO_CONFIG = {
  accountSid,
  authToken,
  myNumber: process.env.MY_NUMBER,
  twilioNumber: process.env.TWILIO_NUMBER,
};

export const IBKR_ACCOUNT_ID = process.env.IBKR_ACCOUNT_ID!;
