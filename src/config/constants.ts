if (process.env.NODE_ENV != "production") {
  require("dotenv").config();
}

import { TradingMode } from "../types";

export const posterPassword: Buffer = Buffer.from(process.env.POSTER_PASSWORD!);
export const accountSid: string = process.env.TWILIO_ACCOUNT_SID!;
export const authToken: string = process.env.TWILIO_AUTH_TOKEN!;

export const port: number = 5592;
export const MaxSpend: number = parseInt(process.env.MAX_SPEND || "100000", 10);
export const WinPercentage: number = 1 + parseFloat(process.env.WIN_PERCENTAGE || "1") / 100;
export const LossPercentage: number = 1 - parseFloat(process.env.LOSS_PERCENTAGE || "2") / 100;
export const WinCounterMax: number = parseInt(process.env.WIN_COUNTER_MAX || "2", 10);
export const TRADING_MODE: TradingMode = (process.env.TRADING_MODE as TradingMode) || TradingMode.PERCENTAGE;
export const FixedProfitAmount: number = parseFloat(process.env.FIXED_PROFIT_AMOUNT || "100");
export const FixedLossAmount: number = parseFloat(process.env.FIXED_LOSS_AMOUNT || "200");

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
