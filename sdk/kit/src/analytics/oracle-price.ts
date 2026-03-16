// OraclePrice — bigint-native wrapper around Codama's { price, exponent } type.
// Ported from flash-sdk/OraclePrice.ts

import type { OraclePrice as CodamaOraclePrice } from "../generated/protocols/flash-trade/types/oraclePrice.js";
import {
  checkedDecimalMul,
  checkedDecimalDiv,
  abs,
} from "./decimal-math.js";
import { BPS_DECIMALS, BPS_POWER, USD_DECIMALS } from "./constants.js";

/**
 * Oracle price with fixed-point arithmetic methods.
 * Wraps the Codama-generated { price: bigint, exponent: number } type.
 */
export class OraclePrice {
  readonly price: bigint;
  readonly exponent: bigint; // stored as bigint for arithmetic
  readonly confidence: bigint;

  constructor(data: {
    price: bigint;
    exponent: number | bigint;
    confidence?: bigint;
  }) {
    this.price = data.price;
    this.exponent = typeof data.exponent === "number"
      ? BigInt(data.exponent)
      : data.exponent;
    this.confidence = data.confidence ?? 0n;
  }

  /** Create from Codama OraclePrice type */
  static fromCodama(codama: CodamaOraclePrice): OraclePrice {
    return new OraclePrice({
      price: codama.price,
      exponent: codama.exponent,
    });
  }

  /** Scale this price to a different exponent */
  scaleToExponent(targetExponent: bigint): OraclePrice {
    if (targetExponent === this.exponent) return this;

    const delta = targetExponent - this.exponent;
    if (delta > 0n) {
      return new OraclePrice({
        price: this.price / 10n ** delta,
        exponent: targetExponent,
        confidence: this.confidence / 10n ** delta,
      });
    }
    return new OraclePrice({
      price: this.price * 10n ** (-delta),
      exponent: targetExponent,
      confidence: this.confidence * 10n ** (-delta),
    });
  }

  /** Convert token amount to USD amount: amount * price, scaled to USD decimals */
  getAssetAmountUsd(tokenAmount: bigint, tokenDecimals: number): bigint {
    if (tokenAmount === 0n || this.price === 0n) return 0n;

    return checkedDecimalMul(
      tokenAmount,
      BigInt(-tokenDecimals),
      this.price,
      this.exponent,
      BigInt(-USD_DECIMALS),
    );
  }

  /** Convert USD amount to token amount: usdAmount / price, scaled to token decimals */
  getTokenAmount(usdAmount: bigint, tokenDecimals: number): bigint {
    if (usdAmount === 0n || this.price === 0n) return 0n;

    return checkedDecimalDiv(
      usdAmount,
      BigInt(-USD_DECIMALS),
      this.price,
      this.exponent,
      BigInt(-tokenDecimals),
    );
  }

  /** Get divergence factor vs another price in BPS */
  getDivergenceFactor(other: OraclePrice): bigint {
    let thisPrice: OraclePrice;
    let reference: OraclePrice;

    if (this.exponent <= other.exponent) {
      thisPrice = this;
      reference = other.scaleToExponent(this.exponent);
    } else {
      thisPrice = this.scaleToExponent(other.exponent);
      reference = other;
    }

    let factorPrice: bigint;
    if (thisPrice.price > reference.price) {
      factorPrice = (thisPrice.price - reference.price) / reference.price;
    } else {
      factorPrice =
        reference.price !== 0n
          ? (reference.price - thisPrice.price) / reference.price
          : 0n;
    }

    // Scale to BPS
    const factorOracle = new OraclePrice({
      price: factorPrice,
      exponent: thisPrice.exponent,
    });
    return factorOracle.scaleToExponent(BigInt(-BPS_DECIMALS)).price;
  }

  /** Compare with another OraclePrice: -1, 0, or 1 */
  cmp(other: OraclePrice): number {
    let lhs: bigint;
    let rhs: bigint;

    if (this.exponent === other.exponent) {
      lhs = this.price;
      rhs = other.price;
    } else if (this.exponent < other.exponent) {
      const scaled = other.scaleToExponent(this.exponent);
      lhs = this.price;
      rhs = scaled.price;
    } else {
      const scaled = this.scaleToExponent(other.exponent);
      lhs = scaled.price;
      rhs = other.price;
    }

    if (lhs < rhs) return -1;
    if (lhs > rhs) return 1;
    return 0;
  }

  /** Convert to Codama-compatible plain object */
  toCodama(): CodamaOraclePrice {
    return {
      price: this.price,
      exponent: Number(this.exponent),
    };
  }

  /** Get price scaled to USD decimals */
  toUsdPrice(): bigint {
    return this.scaleToExponent(BigInt(-USD_DECIMALS)).price;
  }
}

/** Zero oracle price constant */
export const ZERO_ORACLE_PRICE = new OraclePrice({
  price: 0n,
  exponent: 0n,
});
