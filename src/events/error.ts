import { error } from "../utils/logger";

export function handleError(err: Error, code: any, reqId: number): void {
  const data: string = JSON.stringify(code, null, 2);

  // 202: "An active order on the IB server was cancelled."
  // 10148: "An attempt was made to cancel an order that had already been filled by the system."
  // 1100/1102: connectivity issues
  if (
    code &&
    code.code != 202 &&
    code.code != 10148 &&
    code.code != 1100 &&
    code.code != 1102
  ) {
    error(`${err.message} - code: ${data} - reqId: ${reqId}`);
  }
}
