// error_type ITEM_ERROR means the bank connection itself is broken — most often
// ITEM_LOGIN_REQUIRED, which needs a re-link and which every later sync will hit until it is fixed.
// Callers treat it differently from a transient failure because it never resolves on its own.
export const ITEM_ERROR_TYPE = "ITEM_ERROR";

export class PlaidError extends Error {
  readonly errorType: string;
  readonly errorCode: string;

  constructor(errorType: string, errorCode: string, message: string) {
    super(message);
    this.name = "PlaidError";
    this.errorType = errorType;
    this.errorCode = errorCode;
  }

  get isItemError(): boolean {
    return this.errorType === ITEM_ERROR_TYPE;
  }
}
