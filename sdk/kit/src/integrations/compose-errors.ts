export class ComposeError extends Error {
  constructor(
    public readonly protocol: string,
    public readonly code: string,
    message: string,
  ) {
    super(`[${protocol}] ${message}`);
    this.name = "ComposeError";
  }
}

export class FlashTradeComposeError extends ComposeError {
  constructor(code: string, message: string) {
    super("flash-trade", code, message);
    this.name = "FlashTradeComposeError";
  }
}

export class KaminoComposeError extends ComposeError {
  constructor(code: string, message: string) {
    super("kamino", code, message);
    this.name = "KaminoComposeError";
  }
}
