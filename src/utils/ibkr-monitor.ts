import { TWILIO_CONFIG, WinCounterMax } from "../config/constants";
import { type GlobalState, States } from "../types";
import { log } from "./logger";
import { performSell } from "./trading";
import { IBKRClient } from "./ibkr-client";

export class IBKRMonitor {
  private static instance: IBKRMonitor;
  private monitorInterval: NodeJS.Timeout | null = null;
  private globalState: GlobalState;
  private twilio: any;
  private lastKnownOrders: Set<string> = new Set();
  private lastKnownTrades: Set<string> = new Set();

  private constructor(globalState: GlobalState, twilio: any) {
    this.globalState = globalState;
    this.twilio = twilio;
  }

  public static getInstance(globalState: GlobalState, twilio: any): IBKRMonitor {
    if (!IBKRMonitor.instance) {
      IBKRMonitor.instance = new IBKRMonitor(globalState, twilio);
    }
    return IBKRMonitor.instance;
  }

  public startMonitoring(): void {
    if (this.monitorInterval) {
      return;
    }

    log("Starting IBKR order monitoring");
    this.monitorInterval = setInterval(() => {
      this.checkOrderUpdates();
    }, 1000); // Check every second
  }

  public stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      log("Stopped IBKR order monitoring");
    }
  }

  private async checkOrderUpdates(): Promise<void> {
    try {
      const ibkrClient = IBKRClient.getInstance();

      if (!ibkrClient.isConnected()) {
        return;
      }

      // Check for completed trades
      const trades = ibkrClient.getTrades();
      const newTrades = trades.filter(trade =>
        !this.lastKnownTrades.has(this.getTradeId(trade))
      );

      for (const trade of newTrades) {
        const tradeId = this.getTradeId(trade);
        this.lastKnownTrades.add(tradeId);
        await this.handleTradeUpdate(trade);
      }

      // Update open orders count
      const openOrders = ibkrClient.getOpenOrders();
      this.globalState.openOrders = openOrders.length;

    } catch (err: any) {
      log(`Error checking order updates: ${err.message}`);
    }
  }

  private getTradeId(trade: any): string {
    // Create a unique ID for the trade based on available properties
    return `${trade.orderId || trade.execId || trade.reqId || Date.now()}-${trade.symbol || 'unknown'}`;
  }

  private async handleTradeUpdate(trade: any): Promise<void> {
    log(`Trade update: ${JSON.stringify(trade, null, 2)}`);

    // Check if this is our current order
    const currentOrderId = this.globalState.lastOrderId?.toString();
    const tradeOrderId = trade.orderId?.toString() || trade.reqId?.toString();

    if (currentOrderId && currentOrderId === tradeOrderId) {
      const isFilled = this.isOrderFilled(trade);

      if (isFilled && this.globalState.state === States.BUYING) {
        log(`Buy order filled: ${JSON.stringify(trade)}`);
        await this.handleBuyOrderFilled(trade);
      } else if (isFilled && this.globalState.state === States.SELLING) {
        log(`Sell order filled: ${JSON.stringify(trade)}`);
        await this.handleSellOrderFilled(trade);
      }
    }
  }

  private isOrderFilled(trade: any): boolean {
    // Check various properties that might indicate a filled order
    return (
      trade.status === 'Filled' ||
      trade.orderStatus === 'Filled' ||
      (trade.filled !== undefined && trade.filled > 0) ||
      (trade.cumQuantity !== undefined && trade.cumQuantity > 0) ||
      (trade.avgPrice !== undefined && trade.avgPrice > 0)
    );
  }

  private async handleBuyOrderFilled(trade: any): Promise<void> {
    try {
      this.globalState.latestOrderFilled = true;
      this.globalState.state = States.READY_TO_SELL;

      // Update price based on actual fill price
      const fillPrice = trade.avgPrice || trade.price || this.globalState.currentTrade.price;
      const fillQuantity = trade.cumQuantity || trade.quantity || this.globalState.currentTrade.quantity;

      this.globalState.currentTrade.price = fillPrice;
      this.globalState.currentTrade.quantity = fillQuantity;

      log(`Buy order completed at ${fillPrice} for ${fillQuantity} shares`);

      // Immediately place sell order
      log("Entering SELLING state and placing sell order");
      this.globalState.state = States.SELLING;

      await performSell(this.globalState);

    } catch (err: any) {
      log(`Error handling buy order fill: ${err.message}`);
      this.globalState.state = States.READY_TO_BUY;
    }
  }

  private async handleSellOrderFilled(trade: any): Promise<void> {
    try {
      this.globalState.notifiedOfShort = false;
      this.globalState.state = States.READY_TO_BUY;

      const orderId = trade.orderId || trade.reqId || this.globalState.lastOrderId;

      setTimeout(async (): Promise<void> => {
        this.globalState.winTimes++;
        const text: string = `Sold order #${orderId} (${this.globalState.winTimes} / ${WinCounterMax})`;

        log(text);

        await this.twilio.messages.create({
          body: text,
          to: TWILIO_CONFIG.myNumber,
          from: TWILIO_CONFIG.twilioNumber,
        });
      }, 3000);

    } catch (err: any) {
      log(`Error handling sell order fill: ${err.message}`);
    }
  }
}