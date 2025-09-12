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
