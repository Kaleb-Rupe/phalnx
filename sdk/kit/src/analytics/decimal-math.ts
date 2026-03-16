// Fixed-point decimal math — ported from flash-sdk/utils
// All functions are pure, sync, bigint-only.

/**
 * Ceiling division for positive numerators.
 * For a > 0: ceil(a/b) = (a - 1) / b + 1
 */
export function checkedCeilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("MathOverflow: division by zero");
  if (a > 0n) {
    if (a === b) return 1n;
    return (a - 1n) / b + 1n;
  }
  return a / b;
}

/**
 * Multiply two fixed-point numbers and scale to target exponent.
 * checkedDecimalMul(c1, e1, c2, e2, target_e) computes c1 * c2 scaled from
 * 10^(e1+e2) to 10^target_e using floor division.
 */
export function checkedDecimalMul(
  coefficient1: bigint,
  exponent1: bigint,
  coefficient2: bigint,
  exponent2: bigint,
  targetExponent: bigint,
): bigint {
  if (coefficient1 === 0n || coefficient2 === 0n) return 0n;

  const targetPower = exponent1 + exponent2 - targetExponent;
  const product = coefficient1 * coefficient2;

  if (targetPower > 0n) {
    return product * 10n ** targetPower;
  }
  return product / 10n ** -targetPower;
}

/**
 * Like checkedDecimalMul but uses ceiling division when scaling down.
 */
export function checkedDecimalCeilMul(
  coefficient1: bigint,
  exponent1: bigint,
  coefficient2: bigint,
  exponent2: bigint,
  targetExponent: bigint,
): bigint {
  if (coefficient1 === 0n || coefficient2 === 0n) return 0n;

  const targetPower = exponent1 + exponent2 - targetExponent;
  const product = coefficient1 * coefficient2;

  if (targetPower > 0n) {
    return product * 10n ** targetPower;
  }
  return checkedCeilDiv(product, 10n ** -targetPower);
}

/**
 * Divide two fixed-point numbers and scale to target exponent.
 * Uses intermediate scaling to preserve precision.
 */
export function checkedDecimalDiv(
  coefficient1: bigint,
  exponent1: bigint,
  coefficient2: bigint,
  exponent2: bigint,
  targetExponent: bigint,
): bigint {
  if (coefficient2 === 0n) throw new Error("MathOverflow: division by zero");
  if (coefficient1 === 0n) return 0n;

  let scaleFactor = 0n;
  let targetPower = exponent1 - exponent2 - targetExponent;

  if (exponent1 > 0n) {
    scaleFactor += exponent1;
  }
  if (exponent2 < 0n) {
    scaleFactor -= exponent2;
    targetPower += exponent2;
  }
  if (targetExponent < 0n) {
    scaleFactor -= targetExponent;
    targetPower += targetExponent;
  }

  const scaledCoeff1 =
    scaleFactor > 0n ? coefficient1 * 10n ** scaleFactor : coefficient1;

  if (targetPower >= 0n) {
    return (scaledCoeff1 / coefficient2) * 10n ** targetPower;
  }
  return scaledCoeff1 / coefficient2 / 10n ** -targetPower;
}

/**
 * Scale a value from one exponent to another.
 * scaleToExponent(value, fromExp, toExp): if toExp < fromExp, multiply; else divide.
 */
export function scaleToExponent(
  value: bigint,
  fromExponent: bigint,
  targetExponent: bigint,
): bigint {
  if (targetExponent === fromExponent) return value;

  const delta = targetExponent - fromExponent;
  if (delta > 0n) {
    return value / 10n ** delta;
  }
  return value * 10n ** -delta;
}

/**
 * Integer power: base^exp for bigint.
 */
export function pow(base: bigint, exp: bigint): bigint {
  if (exp < 0n) throw new Error("Negative exponent not supported");
  if (exp === 0n) return 1n;
  let result = 1n;
  let b = base;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result *= b;
    b *= b;
    e >>= 1n;
  }
  return result;
}

/**
 * Absolute value for bigint.
 */
export function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/**
 * Minimum of two bigints.
 */
export function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * Maximum of two bigints.
 */
export function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
