if (process.env.NODE_ENV != "production") {
  require("dotenv").config();
}

export const posterPassword: Buffer = Buffer.from(process.env.POSTER_PASSWORD!);
export const accountSid: string = process.env.TWILIO_ACCOUNT_SID!;
export const authToken: string = process.env.TWILIO_AUTH_TOKEN!;

export const port: number = 5592;
export const MaxSpend: number = 100000;
export const WinPercentage: number = 1 + 1 / 100; // 1%
export const WinCounterMax: number = 2;

// New @stoqey/ibkr configuration
export const IBKR_CONFIG = {
  host: process.env.IBKR_HOST || "127.0.0.1",
  port: Number(process.env.IBKR_PORT) || 4001,
  clientId: Number(process.env.IBKR_CLIENT_ID) || 69420,
};

export const TWILIO_CONFIG = {
  accountSid,
  authToken,
  myNumber: process.env.MY_NUMBER,
  twilioNumber: process.env.TWILIO_NUMBER,
};
