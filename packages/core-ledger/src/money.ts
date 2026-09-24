/**
 * Deterministic Money arithmetic utilities.
 * Guarantees zero floating point errors by strictly operating on integers (minor units: pence / cents).
 */

export class Money {
  /**
   * Converts a decimal pound/dollar amount to integer minor units (pence/cents).
   * E.g. 18.50 -> 1850, 0.05 -> 5.
   */
  public static fromDecimal(amount: number): number {
    if (isNaN(amount)) {
      throw new TypeError(`Cannot convert NaN to Money`);
    }
    // Round to avoid IEEE-754 precision bugs (e.g. 19.99 * 100 = 1998.9999999999998)
    return Math.round(amount * 100);
  }

  /**
   * Converts minor units (pence) to a 2-decimal display string.
   * E.g. 1850 -> "18.50"
   */
  public static toDecimalString(pence: number): string {
    if (!Number.isInteger(pence)) {
      throw new TypeError(`Money pence must be an integer, got: ${pence}`);
    }
    const isNegative = pence < 0;
    const abs = Math.abs(pence);
    const pounds = Math.floor(abs / 100);
    const remainder = abs % 100;
    const sign = isNegative ? '-' : '';
    return `${sign}${pounds}.${remainder.toString().padStart(2, '0')}`;
  }

  /**
   * Formats minor units into standard currency format.
   * E.g. 1850, 'GBP' -> "£18.50", -700, 'GBP' -> "-£7.00"
   */
  public static format(pence: number, currency: string = 'GBP'): string {
    const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : `${currency} `;
    const isNegative = pence < 0;
    const abs = Math.abs(pence);
    const pounds = Math.floor(abs / 100);
    const remainder = abs % 100;
    const sign = isNegative ? '-' : '';
    return `${sign}${symbol}${pounds}.${remainder.toString().padStart(2, '0')}`;
  }

  /**
   * Sums an array of integer pence values safely.
   */
  public static sum(values: number[]): number {
    return values.reduce((acc, curr) => {
      if (!Number.isInteger(curr)) {
        throw new TypeError(`All money values must be integers, got: ${curr}`);
      }
      return acc + curr;
    }, 0);
  }

  /**
   * Asserts that a value is a valid non-negative integer pence.
   */
  public static assertNonNegativePence(pence: number, context: string = 'amount'): void {
    if (!Number.isInteger(pence)) {
      throw new TypeError(`Expected integer pence for ${context}, got: ${pence}`);
    }
    if (pence < 0) {
      throw new RangeError(`${context} cannot be negative: ${pence}`);
    }
  }
}
