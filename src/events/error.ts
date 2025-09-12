import { error } from "../utils/logger";

// Legacy error handler - now simplified since @stoqey/ibkr handles errors differently
// Errors are now handled via try/catch blocks in the IBKRClient wrapper
export function handleError(err: Error, code?: any, reqId?: number): void {
  // For compatibility with existing code, but most error handling is now in try/catch blocks
  if (code) {
    const data: string = JSON.stringify(code, null, 2);
    error(`IBKR Error: ${err.message} - code: ${data} - reqId: ${reqId || 'unknown'}`);
  } else {
    error(`IBKR Error: ${err.message}`);
  }
}