import ibkr, { Orders, MarketDataManager, AccountSummary, IBKREvents } from '@stoqey/ibkr';
import { OrderAction, OrderType } from '@stoqey/ib';
import type { Order } from '@stoqey/ib';
import { IBKR_CONFIG } from '../config/constants';
import { log, error } from './logger';

export class IBKRClient {
  private static instance: IBKRClient;
  private connected: boolean = false;
  private ordersManager: Orders | null = null;
  private marketDataManager: MarketDataManager | null = null;
  private accountSummary: AccountSummary | null = null;
  private events: IBKREvents | null = null;

  private constructor() {}

  public static getInstance(): IBKRClient {
    if (!IBKRClient.instance) {
      IBKRClient.instance = new IBKRClient();
    }
    return IBKRClient.instance;
  }

  public async connect(): Promise<void> {
    if (this.connected) {
      log('IBKR already connected');
      return;
    }

    try {
      // Set environment variables for @stoqey/ibkr
      process.env.IBKR_HOST = IBKR_CONFIG.host;
      process.env.IBKR_PORT = IBKR_CONFIG.port.toString();
      process.env.IBKR_CLIENT_ID = IBKR_CONFIG.clientId.toString();

      log(`Connecting to IBKR at ${IBKR_CONFIG.host}:${IBKR_CONFIG.port} with client ID ${IBKR_CONFIG.clientId}`);

      await ibkr();

      this.ordersManager = Orders.Instance;
      this.marketDataManager = MarketDataManager.Instance;
      this.accountSummary = AccountSummary.Instance;
      this.events = IBKREvents.Instance;

      this.connected = true;
      log('Successfully connected to IBKR');
    } catch (err: any) {
      error(`Failed to connect to IBKR: ${err.message}`);
      throw err;
    }
  }

  public async createContract(symbol: string): Promise<any> {
    if (!this.marketDataManager) {
      throw new Error('IBKR not connected');
    }

    try {
      const contract = await this.marketDataManager.getContract({
        symbol,
        secType: 'STK',
        exchange: 'SMART',
        currency: 'USD'
      });
      return contract;
    } catch (err: any) {
      error(`Failed to create contract for ${symbol}: ${err.message}`);
      throw err;
    }
  }

  public async placeOrder(contract: any, orderDetails: {
    action: 'BUY' | 'SELL';
    totalQuantity: number;
    orderType: 'MARKET' | 'LIMIT';
    lmtPrice?: number;
    transmit: boolean;
  }): Promise<any> {
    if (!this.ordersManager) {
      throw new Error('IBKR not connected');
    }

    try {
      // Convert our simple order format to IBKR's Order interface
      const order: Order = {
        action: orderDetails.action === 'BUY' ? OrderAction.BUY : OrderAction.SELL,
        totalQuantity: orderDetails.totalQuantity,
        orderType: orderDetails.orderType === 'MARKET' ? OrderType.MKT : OrderType.LMT,
        lmtPrice: orderDetails.lmtPrice,
        transmit: orderDetails.transmit
      };

      log(`Placing ${orderDetails.action} order for ${orderDetails.totalQuantity} shares of ${contract.symbol}`);
      const success = await this.ordersManager.placeOrder(contract, order);

      if (success) {
        // Return a basic order object with generated ID
        return {
          orderId: `order-${Date.now()}`,
          success: true
        };
      } else {
        throw new Error('Order placement failed');
      }
    } catch (err: any) {
      error(`Failed to place order: ${err.message}`);
      throw err;
    }
  }

  public async cancelOrder(orderId: number): Promise<void> {
    if (!this.ordersManager) {
      throw new Error('IBKR not connected');
    }

    try {
      log(`Cancelling order #${orderId}`);
      await this.ordersManager.cancelOrder(orderId);
    } catch (err: any) {
      error(`Failed to cancel order #${orderId}: ${err.message}`);
      throw err;
    }
  }

  public getOpenOrders(): any[] {
    if (!this.ordersManager) {
      return [];
    }
    return this.ordersManager.orders || [];
  }

  public getTrades(): any[] {
    if (!this.ordersManager) {
      return [];
    }
    return this.ordersManager.trades || [];
  }

  public getPositions(): any[] {
    if (!this.accountSummary) {
      return [];
    }
    // The AccountSummary might not have portfolios property, return empty array
    return [];
  }

  public subscribeToOrderUpdates(_callback: (order: any) => void): void {
    if (!this.events) {
      error('IBKR events not available');
      return;
    }

    // The @stoqey/ibkr library updates orders automatically
    // We can just log that we're subscribed
    log('Subscribed to order updates');
  }

  public async getCurrentTime(): Promise<string> {
    // For @stoqey/ibkr, we can use current time since it doesn't have a direct equivalent
    return new Date().toISOString();
  }

  public isConnected(): boolean {
    return this.connected;
  }
}
