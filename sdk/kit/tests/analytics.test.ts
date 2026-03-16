import { expect } from "chai";
import {
  // Constants
  BPS_DECIMALS,
  BPS_POWER,
  USD_DECIMALS,
  USD_POWER,
  RATE_DECIMALS,
  RATE_POWER,
  ORACLE_EXPONENT,
  HOUR_SECONDS,
  // Decimal math
  checkedCeilDiv,
  checkedDecimalMul,
  checkedDecimalCeilMul,
  checkedDecimalDiv,
  scaleToExponent,
  pow,
  abs,
  min,
  max,
  // Oracle price
  OraclePrice,
  ZERO_ORACLE_PRICE,
  // Types
  PositionSide,
  // PnL
  getPnlUsd,
  getNetPnlUsd,
  hasProfit,
  // Leverage
  getCurrentLeverage,
  getMaxLeverage,
  isOverLeveraged,
  // Liquidation
  getLiquidationPrice,
  getLiquidationPriceFromEntry,
  isLiquidatable,
  // Fees
  getCumulativeLockFee,
  getLockFeeAndUnsettledUsd,
  getExitFeeUsd,
  getExitFeeUsdWithDiscount,
  getOpenFeeUsd,
  getBorrowRate,
  // Entry/exit price
  getTradeSpread,
  getEntryPrice,
  getExitPrice,
  getPriceAfterSlippage,
  // Position metrics
  getPositionMetrics,
  // Decrease size
  getDecreaseSizeResult,
  // Withdrawable
  getMaxWithdrawable,
  // Sizing
  getSizeFromLeverageAndCollateral,
  getRequiredCollateral,
  getMaxPositionSizeUsd,
  // Slippage
  estimateSlippage,
  getSwapPriceImpact,
  // Swap fees
  getSwapFee,
  getAddLiquidityFee,
  getRemoveLiquidityFee,
  // Helpers
  getMinAndMaxOraclePrice,
  getAveragePrice,
} from "../src/analytics/index.js";
import type {
  PositionInfo,
  CustodyInfo,
  PnlResult,
} from "../src/analytics/index.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

/** Create a standard BTC oracle price: $60,000 with 9-decimal exponent */
function btcPrice(usd: number = 60_000): OraclePrice {
  return new OraclePrice({
    price: BigInt(usd) * 10n ** BigInt(ORACLE_EXPONENT),
    exponent: -ORACLE_EXPONENT,
  });
}

/** Create a standard stablecoin oracle price: $1.00 */
function stablePrice(): OraclePrice {
  return new OraclePrice({
    price: 10n ** BigInt(ORACLE_EXPONENT), // 1.000000000
    exponent: -ORACLE_EXPONENT,
  });
}

/** Create default custody info */
function makeCustody(overrides?: Partial<CustodyInfo>): CustodyInfo {
  return {
    decimals: 9,
    fees: {
      openPosition: 100_000n, // 0.01% (100_000 / 1e9)
      closePosition: 100_000n,
      swapSpread: 10n,
      volatility: 50_000n,
    },
    borrowRateState: {
      currentRate: 1_000_000n, // ~0.1% per hour
      cumulativeLockFee: 100_000_000n,
      lastUpdate: 1000n,
    },
    borrowRate: {
      optimalUtilization: 800_000_000n, // 80%
      slope1: 10_000_000n,
      slope2: 100_000_000n,
    },
    pricing: {
      tradeSpreadMin: 10n,
      tradeSpreadMax: 100n,
      swapSpread: 10n,
      maxPositionSizeUsd: 1_000_000_000_000n, // $1M
      maxLeverage: 1_000_000, // 100x
      maxInitLeverage: 500_000, // 50x
      maxDegenLeverage: 5_000_000, // 500x
      maxInitDegenLeverage: 2_500_000, // 250x
      minCollateralUsd: 10_000_000, // $10
      minDegenCollateralUsd: 5_000_000, // $5
      maxUtilization: 900_000_000, // 90%
      delaySeconds: 0n,
    },
    oracle: {
      maxDivergenceBps: 500n,
      maxConfBps: 200n,
      maxPriceAgeSec: 60,
    },
    isStable: false,
    ...overrides,
  };
}

/** Create default position */
function makePosition(overrides?: Partial<PositionInfo>): PositionInfo {
  return {
    sizeAmount: 100_000_000n, // 0.1 BTC (9 decimals)
    sizeUsd: 6_000_000_000n, // $6,000
    collateralUsd: 1_000_000_000n, // $1,000
    entryPrice: {
      price: 60_000n * 10n ** BigInt(ORACLE_EXPONENT),
      exponent: -ORACLE_EXPONENT,
    },
    referencePrice: {
      price: 60_000n * 10n ** BigInt(ORACLE_EXPONENT),
      exponent: -ORACLE_EXPONENT,
    },
    sizeDecimals: 9,
    collateralDecimals: 6,
    lockedAmount: 7_000_000n, // $7 locked
    lockedDecimals: 6,
    cumulativeLockFeeSnapshot: 100_000_000n,
    unsettledFeesUsd: 0n,
    updateTime: 500n,
    priceImpactUsd: 0n,
    side: PositionSide.Long,
    degenSizeUsd: 0n,
    ...overrides,
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

describe("analytics/constants", () => {
  it("exports correct BPS values", () => {
    expect(BPS_DECIMALS).to.equal(4);
    expect(BPS_POWER).to.equal(10_000n);
  });

  it("exports correct USD values", () => {
    expect(USD_DECIMALS).to.equal(6);
    expect(USD_POWER).to.equal(1_000_000n);
  });

  it("exports correct RATE values", () => {
    expect(RATE_DECIMALS).to.equal(9);
    expect(RATE_POWER).to.equal(1_000_000_000n);
  });

  it("exports correct ORACLE_EXPONENT", () => {
    expect(ORACLE_EXPONENT).to.equal(9);
  });

  it("exports HOUR_SECONDS", () => {
    expect(HOUR_SECONDS).to.equal(3600n);
  });
});

// ─── Decimal Math ───────────────────────────────────────────────────────────

describe("analytics/decimal-math", () => {
  describe("checkedCeilDiv", () => {
    it("returns ceiling for positive numerator", () => {
      expect(checkedCeilDiv(7n, 3n)).to.equal(3n); // ceil(7/3) = 3
      expect(checkedCeilDiv(9n, 3n)).to.equal(3n); // exact
      expect(checkedCeilDiv(10n, 3n)).to.equal(4n); // ceil(10/3) = 4
    });

    it("returns 1 when a == b", () => {
      expect(checkedCeilDiv(5n, 5n)).to.equal(1n);
    });

    it("throws on division by zero", () => {
      expect(() => checkedCeilDiv(5n, 0n)).to.throw("MathOverflow");
    });
  });

  describe("checkedDecimalMul", () => {
    it("multiplies two fixed-point numbers", () => {
      // 2.5 * 3.0 = 7.5 → in USD decimals (6): 7_500_000
      const result = checkedDecimalMul(
        2_500_000n, // 2.5 at 6 decimals
        -6n,
        3_000_000n, // 3.0 at 6 decimals
        -6n,
        -6n, // target: 6 decimals
      );
      expect(result).to.equal(7_500_000n);
    });

    it("returns 0 when either coefficient is 0", () => {
      expect(checkedDecimalMul(0n, -6n, 100n, -6n, -6n)).to.equal(0n);
      expect(checkedDecimalMul(100n, -6n, 0n, -6n, -6n)).to.equal(0n);
    });
  });

  describe("checkedDecimalDiv", () => {
    it("divides two fixed-point numbers", () => {
      // 10 USD / 2 price = 5 tokens
      const result = checkedDecimalDiv(
        10_000_000n, // 10.0 at 6 decimals
        -6n,
        2_000_000_000n, // price 2.0 at 9 decimals
        -9n,
        -6n, // target: 6 decimals
      );
      expect(result).to.equal(5_000_000n);
    });

    it("throws on division by zero", () => {
      expect(() => checkedDecimalDiv(100n, -6n, 0n, -6n, -6n)).to.throw(
        "MathOverflow",
      );
    });

    it("returns 0 for zero numerator", () => {
      expect(checkedDecimalDiv(0n, -6n, 100n, -6n, -6n)).to.equal(0n);
    });
  });

  describe("scaleToExponent", () => {
    it("scales up (more precise)", () => {
      // 100 at exp -6 → exp -9 = 100_000
      expect(scaleToExponent(100n, -6n, -9n)).to.equal(100_000n);
    });

    it("scales down (less precise)", () => {
      // 100_000 at exp -9 → exp -6 = 100
      expect(scaleToExponent(100_000n, -9n, -6n)).to.equal(100n);
    });

    it("no-op when exponents are equal", () => {
      expect(scaleToExponent(42n, -6n, -6n)).to.equal(42n);
    });
  });

  describe("pow", () => {
    it("computes integer powers", () => {
      expect(pow(2n, 10n)).to.equal(1024n);
      expect(pow(10n, 6n)).to.equal(1_000_000n);
      expect(pow(5n, 0n)).to.equal(1n);
    });
  });

  describe("abs/min/max", () => {
    it("abs returns absolute value", () => {
      expect(abs(-5n)).to.equal(5n);
      expect(abs(5n)).to.equal(5n);
      expect(abs(0n)).to.equal(0n);
    });

    it("min returns minimum", () => {
      expect(min(3n, 7n)).to.equal(3n);
      expect(min(7n, 3n)).to.equal(3n);
    });

    it("max returns maximum", () => {
      expect(max(3n, 7n)).to.equal(7n);
      expect(max(7n, 3n)).to.equal(7n);
    });
  });
});

// ─── Oracle Price ───────────────────────────────────────────────────────────

describe("analytics/oracle-price", () => {
  it("constructs from raw data", () => {
    const price = btcPrice();
    expect(price.price).to.equal(60_000n * 10n ** 9n);
    expect(price.exponent).to.equal(-9n);
  });

  it("creates from Codama type", () => {
    const codama = { price: 60_000_000_000_000n, exponent: -9 };
    const price = OraclePrice.fromCodama(codama);
    expect(price.price).to.equal(60_000_000_000_000n);
    expect(price.exponent).to.equal(-9n);
  });

  it("scales to different exponent", () => {
    const price = btcPrice();
    const scaled = price.scaleToExponent(-6n);
    expect(scaled.price).to.equal(60_000_000_000n); // 60000 * 10^6
    expect(scaled.exponent).to.equal(-6n);
  });

  it("getAssetAmountUsd converts tokens to USD", () => {
    const price = btcPrice(); // $60,000
    // 0.1 BTC (9 decimals) = $6,000 = 6_000_000_000 (6 USD decimals)
    const usd = price.getAssetAmountUsd(100_000_000n, 9);
    expect(usd).to.equal(6_000_000_000n);
  });

  it("getTokenAmount converts USD to tokens", () => {
    const price = btcPrice(); // $60,000
    // $6,000 = 0.1 BTC = 100_000_000 (9 decimals)
    const tokens = price.getTokenAmount(6_000_000_000n, 9);
    expect(tokens).to.equal(100_000_000n);
  });

  it("toCodama returns plain object", () => {
    const price = btcPrice();
    const codama = price.toCodama();
    expect(codama.price).to.equal(price.price);
    expect(codama.exponent).to.equal(Number(price.exponent));
  });

  it("cmp compares prices correctly", () => {
    const p1 = btcPrice(60_000);
    const p2 = btcPrice(61_000);
    expect(p1.cmp(p2)).to.equal(-1);
    expect(p2.cmp(p1)).to.equal(1);
    expect(p1.cmp(btcPrice(60_000))).to.equal(0);
  });

  it("ZERO_ORACLE_PRICE has zero values", () => {
    expect(ZERO_ORACLE_PRICE.price).to.equal(0n);
    expect(ZERO_ORACLE_PRICE.exponent).to.equal(0n);
  });
});

// ─── Fees ───────────────────────────────────────────────────────────────────

describe("analytics/fees", () => {
  const custody = makeCustody();
  const position = makePosition();

  describe("getCumulativeLockFee", () => {
    it("extrapolates from last update", () => {
      const result = getCumulativeLockFee(
        custody.borrowRateState,
        2000n, // 1000 seconds after last update
      );
      // (2000 - 1000) * 1_000_000 / 3600 + 100_000_000
      const expected = (1000n * 1_000_000n) / 3600n + 100_000_000n;
      expect(result).to.equal(expected);
    });

    it("returns snapshot when timestamp <= lastUpdate", () => {
      const result = getCumulativeLockFee(custody.borrowRateState, 500n);
      expect(result).to.equal(100_000_000n);
    });
  });

  describe("getExitFeeUsd", () => {
    it("calculates exit fee correctly", () => {
      // sizeUsd * closePosition / RATE_POWER
      // 6_000_000_000 * 100_000 / 1_000_000_000 = 600_000
      const fee = getExitFeeUsd(position, custody);
      expect(fee).to.equal(600_000n);
    });
  });

  describe("getExitFeeUsdWithDiscount", () => {
    it("applies discount", () => {
      const fee = getExitFeeUsdWithDiscount(position, custody, 5000n); // 50% discount
      const baseFee = getExitFeeUsd(position, custody);
      expect(fee).to.equal(baseFee - (baseFee * 5000n) / BPS_POWER);
    });
  });

  describe("getOpenFeeUsd", () => {
    it("calculates open fee", () => {
      const fee = getOpenFeeUsd(6_000_000_000n, custody);
      expect(fee).to.equal(600_000n);
    });
  });

  describe("getBorrowRate", () => {
    it("returns slope1-proportional rate below optimal", () => {
      // 50% utilization, optimal=80%: rate = 500M * 10M / 800M = 6_250_000
      const rate = getBorrowRate(custody, 500_000_000n);
      expect(rate).to.equal(6_250_000n);
    });

    it("returns slope1+slope2 at max utilization", () => {
      const rate = getBorrowRate(custody, 900_000_000n);
      // At optimal: slope1 = 10M
      // Between optimal(80%) and max(90%): slope2 proportional
      // (900M - 800M) * 100M / (900M - 800M) = 100M
      // Total = 10M + 100M = 110M
      expect(rate).to.equal(110_000_000n);
    });
  });
});

// ─── Entry/Exit Price ───────────────────────────────────────────────────────

describe("analytics/entry-exit-price", () => {
  const custody = makeCustody();

  describe("getTradeSpread", () => {
    it("returns 0 for zero size", () => {
      expect(getTradeSpread(custody, 0n)).to.equal(0n);
    });

    it("returns min spread for small positions", () => {
      // Small position relative to maxPositionSizeUsd
      const spread = getTradeSpread(custody, 1_000_000n);
      expect(spread >= custody.pricing.tradeSpreadMin).to.be.true;
    });
  });

  describe("getEntryPrice", () => {
    it("adds spread for longs", () => {
      const entry = getEntryPrice(
        PositionSide.Long,
        btcPrice(),
        btcPrice(),
        custody,
        6_000_000_000n,
      );
      // Entry should be above oracle for longs
      expect(entry.price > btcPrice().price).to.be.true;
    });

    it("subtracts spread for shorts", () => {
      const entry = getEntryPrice(
        PositionSide.Short,
        btcPrice(),
        btcPrice(),
        custody,
        6_000_000_000n,
      );
      // Entry should be below oracle for shorts
      expect(entry.price < btcPrice().price).to.be.true;
    });
  });

  describe("getExitPrice", () => {
    it("subtracts spread for longs (inverse of entry)", () => {
      const exit = getExitPrice(
        PositionSide.Long,
        btcPrice(),
        btcPrice(),
        custody,
        6_000_000_000n,
      );
      expect(exit.price < btcPrice().price).to.be.true;
    });

    it("adds spread for shorts", () => {
      const exit = getExitPrice(
        PositionSide.Short,
        btcPrice(),
        btcPrice(),
        custody,
        6_000_000_000n,
      );
      expect(exit.price > btcPrice().price).to.be.true;
    });
  });

  describe("getPriceAfterSlippage", () => {
    it("increases entry price for long", () => {
      const result = getPriceAfterSlippage(
        true,
        100n, // 1% slippage
        btcPrice(),
        PositionSide.Long,
      );
      expect(result.price > btcPrice().price).to.be.true;
    });

    it("decreases exit price for long", () => {
      const result = getPriceAfterSlippage(
        false,
        100n,
        btcPrice(),
        PositionSide.Long,
      );
      expect(result.price < btcPrice().price).to.be.true;
    });
  });
});

// ─── PnL ────────────────────────────────────────────────────────────────────

describe("analytics/pnl", () => {
  const custody = makeCustody();

  it("calculates profit for long when price increases", () => {
    const position = makePosition({
      side: PositionSide.Long,
      updateTime: 0n, // delay expired
    });
    const pnl = getPnlUsd(
      position,
      btcPrice(65_000), // price went up
      btcPrice(65_000),
      custody,
      2000n, // well past delay
    );
    expect(pnl.profitUsd > 0n).to.be.true;
    expect(pnl.lossUsd).to.equal(0n);
  });

  it("calculates loss for long when price decreases", () => {
    const position = makePosition({
      side: PositionSide.Long,
      updateTime: 0n,
    });
    const pnl = getPnlUsd(
      position,
      btcPrice(55_000), // price went down
      btcPrice(55_000),
      custody,
      2000n,
    );
    expect(pnl.profitUsd).to.equal(0n);
    expect(pnl.lossUsd > 0n).to.be.true;
  });

  it("calculates profit for short when price decreases", () => {
    const position = makePosition({
      side: PositionSide.Short,
      updateTime: 0n,
    });
    const pnl = getPnlUsd(
      position,
      btcPrice(55_000), // price went down — good for shorts
      btcPrice(55_000),
      custody,
      2000n,
    );
    expect(pnl.profitUsd > 0n).to.be.true;
    expect(pnl.lossUsd).to.equal(0n);
  });

  it("calculates loss for short when price increases", () => {
    const position = makePosition({
      side: PositionSide.Short,
      updateTime: 0n,
    });
    const pnl = getPnlUsd(
      position,
      btcPrice(65_000), // price went up — bad for shorts
      btcPrice(65_000),
      custody,
      2000n,
    );
    expect(pnl.profitUsd).to.equal(0n);
    expect(pnl.lossUsd > 0n).to.be.true;
  });

  it("returns zero for empty position", () => {
    const position = makePosition({ sizeUsd: 0n });
    const pnl = getPnlUsd(position, btcPrice(), btcPrice(), custody, 1000n);
    expect(pnl.profitUsd).to.equal(0n);
    expect(pnl.lossUsd).to.equal(0n);
  });

  describe("getNetPnlUsd", () => {
    it("returns positive for profit", () => {
      expect(
        getNetPnlUsd({ profitUsd: 100n, lossUsd: 0n, priceImpactUsd: 0n }),
      ).to.equal(100n);
    });

    it("returns negative for loss", () => {
      expect(
        getNetPnlUsd({ profitUsd: 0n, lossUsd: 50n, priceImpactUsd: 0n }),
      ).to.equal(-50n);
    });
  });

  describe("hasProfit", () => {
    it("returns true when profit > loss", () => {
      expect(hasProfit({ profitUsd: 100n, lossUsd: 0n, priceImpactUsd: 0n })).to
        .be.true;
    });

    it("returns false when loss >= profit", () => {
      expect(hasProfit({ profitUsd: 0n, lossUsd: 100n, priceImpactUsd: 0n })).to
        .be.false;
    });
  });
});

// ─── Leverage ───────────────────────────────────────────────────────────────

describe("analytics/leverage", () => {
  const custody = makeCustody();
  const collateralCustody = makeCustody({ decimals: 6, isStable: true });

  it("calculates leverage correctly", () => {
    const position = makePosition({ updateTime: 0n });
    const leverage = getCurrentLeverage(
      position,
      btcPrice(),
      btcPrice(),
      custody,
      collateralCustody,
      2000n,
    );
    // sizeUsd = 6B, collateralUsd = 1B → ~6x leverage = ~60000 BPS
    // But fees reduce margin, so leverage will be slightly higher
    expect(leverage > 50_000n).to.be.true;
    expect(leverage < 100_000n).to.be.true;
  });

  it("returns max leverage when margin is zero", () => {
    const position = makePosition({
      collateralUsd: 0n,
      updateTime: 0n,
    });
    const leverage = getCurrentLeverage(
      position,
      btcPrice(30_000), // huge loss
      btcPrice(30_000),
      custody,
      collateralCustody,
      2000n,
    );
    expect(leverage).to.equal(BigInt(Number.MAX_SAFE_INTEGER));
  });

  it("getMaxLeverage returns correct value", () => {
    expect(getMaxLeverage(custody, false)).to.equal(1_000_000);
    expect(getMaxLeverage(custody, true)).to.equal(5_000_000);
  });

  it("isOverLeveraged detects over-leveraged positions", () => {
    // Position at ~6x with max 100x → should not be over-leveraged
    const position = makePosition({ updateTime: 0n });
    const result = isOverLeveraged(
      position,
      btcPrice(),
      btcPrice(),
      custody,
      collateralCustody,
      2000n,
    );
    expect(result.isOverLeveraged).to.be.false;
  });
});

// ─── Liquidation ────────────────────────────────────────────────────────────

describe("analytics/liquidation", () => {
  const custody = makeCustody();
  const collateralCustody = makeCustody({ decimals: 6, isStable: true });

  it("calculates liquidation price for long", () => {
    const position = makePosition({
      side: PositionSide.Long,
      updateTime: 0n,
    });
    const liqPrice = getLiquidationPrice(
      position,
      custody,
      collateralCustody,
      2000n,
    );
    // Liq price should be below entry for longs
    expect(liqPrice.price > 0n).to.be.true;
  });

  it("calculates liquidation price for short", () => {
    const position = makePosition({
      side: PositionSide.Short,
      updateTime: 0n,
    });
    const liqPrice = getLiquidationPrice(
      position,
      custody,
      collateralCustody,
      2000n,
    );
    // Liq price should be above entry for shorts
    expect(liqPrice.price > 0n).to.be.true;
  });

  it("isLiquidatable returns false for healthy position", () => {
    const position = makePosition({ updateTime: 0n });
    const result = isLiquidatable(
      position,
      btcPrice(),
      btcPrice(),
      custody,
      collateralCustody,
      2000n,
    );
    expect(result).to.be.false;
  });

  it("isLiquidatable returns true when price crashes", () => {
    const position = makePosition({
      side: PositionSide.Long,
      sizeUsd: 100_000_000_000n, // $100k position
      collateralUsd: 1_000_000_000n, // $1k collateral (100x)
      updateTime: 0n,
    });
    const result = isLiquidatable(
      position,
      btcPrice(50_000), // 16% drop
      btcPrice(50_000),
      custody,
      collateralCustody,
      2000n,
    );
    expect(result).to.be.true;
  });

  it("returns zero price for empty position", () => {
    const position = makePosition({ sizeAmount: 0n, sizeUsd: 0n });
    const liqPrice = getLiquidationPriceFromEntry(
      btcPrice(),
      0n,
      PositionSide.Long,
      custody,
      position,
    );
    expect(liqPrice.price).to.equal(0n);
  });
});

// ─── Position Metrics ───────────────────────────────────────────────────────

describe("analytics/position-metrics", () => {
  const custody = makeCustody();
  const collateralCustody = makeCustody({ decimals: 6, isStable: true });

  it("returns all metrics in one call", () => {
    const position = makePosition({ updateTime: 0n });
    const metrics = getPositionMetrics(
      position,
      btcPrice(),
      btcPrice(),
      custody,
      collateralCustody,
      2000n,
    );

    expect(metrics.pnl).to.have.property("profitUsd");
    expect(metrics.pnl).to.have.property("lossUsd");
    expect(metrics.leverage > 0n).to.be.true;
    expect(metrics.liquidationPrice).to.be.instanceOf(OraclePrice);
    expect(metrics.fees).to.have.property("exitFeeUsd");
    expect(metrics.fees).to.have.property("lockAndUnsettledFeeUsd");
  });

  it("returns zero metrics for empty position", () => {
    const position = makePosition({ sizeUsd: 0n });
    const metrics = getPositionMetrics(
      position,
      btcPrice(),
      btcPrice(),
      custody,
      collateralCustody,
      2000n,
    );
    expect(metrics.leverage).to.equal(0n);
    expect(metrics.pnl.profitUsd).to.equal(0n);
  });
});

// ─── Decrease Size ──────────────────────────────────────────────────────────

describe("analytics/decrease-size", () => {
  const custody = makeCustody();
  const collateralCustody = makeCustody({ decimals: 6, isStable: true });

  it("calculates partial close correctly", () => {
    const position = makePosition({ updateTime: 0n });
    const result = getDecreaseSizeResult(
      position,
      3_000_000_000n, // close half ($3,000 of $6,000)
      btcPrice(),
      btcPrice(),
      custody,
      stablePrice(),
      stablePrice(),
      collateralCustody,
      2000n,
    );

    // New size should be approximately half
    expect(result.newSizeUsd < position.sizeUsd).to.be.true;
    expect(result.newSizeUsd > 0n).to.be.true;
    expect(result.feeUsd >= 0n).to.be.true;
  });
});

// ─── Withdrawable ───────────────────────────────────────────────────────────

describe("analytics/withdrawable", () => {
  const custody = makeCustody();
  const collateralCustody = makeCustody({ decimals: 6, isStable: true });

  it("returns non-zero for healthy position", () => {
    const position = makePosition({
      collateralUsd: 10_000_000_000n, // $10k collateral, $6k position
      updateTime: 0n,
    });
    const result = getMaxWithdrawable(
      position,
      btcPrice(),
      btcPrice(),
      custody,
      stablePrice(),
      stablePrice(),
      collateralCustody,
      2000n,
    );
    expect(result.maxWithdrawableAmountUsd > 0n).to.be.true;
  });

  it("returns zero for over-leveraged position", () => {
    const position = makePosition({
      collateralUsd: 100_000_000n, // $100 collateral, $6k position = 60x
      updateTime: 0n,
    });
    const result = getMaxWithdrawable(
      position,
      btcPrice(),
      btcPrice(),
      custody,
      stablePrice(),
      stablePrice(),
      collateralCustody,
      2000n,
    );
    expect(result.maxWithdrawableAmountUsd).to.equal(0n);
  });
});

// ─── Sizing ─────────────────────────────────────────────────────────────────

describe("analytics/sizing", () => {
  const custody = makeCustody();
  const collateralCustody = makeCustody({ decimals: 6, isStable: true });

  it("getSizeFromLeverageAndCollateral returns non-zero", () => {
    const size = getSizeFromLeverageAndCollateral(
      1_000_000_000n, // 1000 USDC (6 decimals)
      5, // 5x leverage
      PositionSide.Long,
      btcPrice(),
      btcPrice(),
      custody,
      stablePrice(),
      stablePrice(),
      collateralCustody,
    );
    expect(size > 0n).to.be.true;
  });

  it("getRequiredCollateral returns non-zero", () => {
    const collateral = getRequiredCollateral(
      100_000_000n, // 0.1 BTC
      5, // 5x leverage
      PositionSide.Long,
      btcPrice(),
      btcPrice(),
      custody,
      stablePrice(),
      stablePrice(),
      collateralCustody,
    );
    expect(collateral > 0n).to.be.true;
  });

  it("getMaxPositionSizeUsd returns custody max", () => {
    expect(getMaxPositionSizeUsd(custody)).to.equal(
      custody.pricing.maxPositionSizeUsd,
    );
  });
});

// ─── Slippage ───────────────────────────────────────────────────────────────

describe("analytics/slippage", () => {
  it("estimateSlippage returns proportional value", () => {
    // 1% of pool = 100 BPS
    const slippage = estimateSlippage(1_000_000n, 100_000_000n);
    expect(slippage).to.equal(100n);
  });

  it("returns BPS_POWER for zero liquidity", () => {
    expect(estimateSlippage(100n, 0n)).to.equal(BPS_POWER);
  });

  it("returns 0 for zero trade", () => {
    expect(estimateSlippage(0n, 100n)).to.equal(0n);
  });

  it("getSwapPriceImpact returns reasonable values", () => {
    const result = getSwapPriceImpact(
      1_000_000_000n, // 1 token
      btcPrice(),
      stablePrice(),
      9,
      6,
      1_000_000_000_000n, // $1M liquidity
    );
    expect(result.estimatedAmountOut > 0n).to.be.true;
    expect(result.priceImpactBps >= 0n).to.be.true;
  });
});

// ─── Swap Fees ──────────────────────────────────────────────────────────────

describe("analytics/swap-fees", () => {
  const custody = makeCustody();

  it("getSwapFee returns non-zero for non-zero amount", () => {
    const fee = getSwapFee(1_000_000_000n, custody);
    expect(fee > 0n).to.be.true;
  });

  it("getAddLiquidityFee returns fee", () => {
    const fee = getAddLiquidityFee(1_000_000_000n, custody);
    expect(fee > 0n).to.be.true;
  });

  it("getRemoveLiquidityFee returns fee", () => {
    const fee = getRemoveLiquidityFee(1_000_000_000n, custody);
    expect(fee > 0n).to.be.true;
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

describe("analytics/helpers", () => {
  const custody = makeCustody();

  it("getMinAndMaxOraclePrice returns same when no divergence", () => {
    const { min: minP, max: maxP } = getMinAndMaxOraclePrice(
      btcPrice(),
      btcPrice(),
      custody,
    );
    expect(minP.price).to.equal(maxP.price);
  });

  it("getAveragePrice computes weighted average", () => {
    const avg = getAveragePrice(100n, 50n, 200n, 50n);
    // (100*50 + 200*50) / 100 = 150
    expect(avg).to.equal(150n);
  });

  it("getAveragePrice returns 0 for zero total size", () => {
    expect(getAveragePrice(100n, 0n, 200n, 0n)).to.equal(0n);
  });
});

// ─── Export Verification ────────────────────────────────────────────────────

describe("analytics/index exports", () => {
  it("re-exports all public functions", () => {
    // Constants
    expect(BPS_DECIMALS).to.exist;
    expect(BPS_POWER).to.exist;
    expect(USD_DECIMALS).to.exist;
    expect(RATE_DECIMALS).to.exist;
    expect(RATE_POWER).to.exist;
    expect(ORACLE_EXPONENT).to.exist;

    // Classes
    expect(OraclePrice).to.exist;
    expect(ZERO_ORACLE_PRICE).to.exist;

    // Enums
    expect(PositionSide.Long).to.equal(1);
    expect(PositionSide.Short).to.equal(2);

    // Functions
    expect(getPnlUsd).to.be.a("function");
    expect(getCurrentLeverage).to.be.a("function");
    expect(getLiquidationPrice).to.be.a("function");
    expect(getPositionMetrics).to.be.a("function");
    expect(getDecreaseSizeResult).to.be.a("function");
    expect(getMaxWithdrawable).to.be.a("function");
    expect(getSizeFromLeverageAndCollateral).to.be.a("function");
    expect(estimateSlippage).to.be.a("function");
  });
});
