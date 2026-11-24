import { describe, expect, it } from "vitest";
import {
  applyCurrencyRounding,
  applyRounding,
  calculateTaiwanFee,
  calculateTaiwanSupplementaryNhiFee,
  calculateTaiwanTax,
  calculateXirrPercentage,
  calculateXirrRate,
  canonicalStockCode,
  DEFAULT_TAIWAN_TAX_RATES,
  escapeLikePattern,
  formatAssetInputAmount,
  formatHomeAmount,
  formatMarketAmount,
  formatMarketPlainAmount,
  formatShareCount,
  formatShareInputValue,
  inferMarketFromCode,
  normalizeExchange,
  normalizeMarket,
  resolveAccountFeeSettings,
  resolveActiveAccountId,
  stockCacheKey,
  transactionFeeForType,
  validateRestoredAccounts,
} from "@/domain";
import {
  CalculationRoundingMode,
  HomeDisplayMode,
  StockExchange,
  StockMarket,
  TransactionType,
  type AccountFeeSettings,
} from "@/types";

describe("market utilities & formatting", () => {
  it("normalizes market, infers market from code (including mixed TW codes), and builds cache keys", () => {
    expect(normalizeMarket("us")).toBe(StockMarket.US);
    expect(normalizeMarket(" TW ")).toBe(StockMarket.TW);
    expect(normalizeMarket("")).toBe(StockMarket.TW);

    expect(inferMarketFromCode("00981A")).toBe(StockMarket.TW);
    expect(inferMarketFromCode("AB12")).toBe(StockMarket.TW);
    expect(inferMarketFromCode("2330")).toBe(StockMarket.TW);
    expect(inferMarketFromCode("AAPL")).toBe(StockMarket.US);
    expect(inferMarketFromCode("BRK.B")).toBe(StockMarket.US);
    expect(inferMarketFromCode("BF-B")).toBe(StockMarket.US);
    expect(inferMarketFromCode("  ")).toBe(StockMarket.TW);

    expect(canonicalStockCode(" aapl ")).toBe("AAPL");
    expect(stockCacheKey("TW", "abc")).toBe("TW:ABC");
    expect(stockCacheKey("US", "abc")).toBe("US:ABC");
  });

  it("normalizes Taiwan exchanges in order", () => {
    expect(normalizeExchange("興櫃股票")).toBe(StockExchange.EMERGING);
    expect(normalizeExchange("上櫃")).toBe(StockExchange.OTC);
    expect(normalizeExchange("上市")).toBe(StockExchange.LISTED);
    expect(normalizeExchange("NYSE")).toBe(StockExchange.UNKNOWN);
  });

  it("applies ROUND vs FLOOR rounding and currency precision", () => {
    expect(applyRounding(10.6, CalculationRoundingMode.ROUND)).toBe(11);
    expect(applyRounding(10.6, CalculationRoundingMode.FLOOR)).toBe(10);
    expect(applyCurrencyRounding(10.556, StockMarket.US, CalculationRoundingMode.ROUND)).toBe(10.56);
    expect(applyCurrencyRounding(10.556, StockMarket.US, CalculationRoundingMode.FLOOR)).toBe(10.55);
    expect(applyCurrencyRounding(10.556, StockMarket.TW, CalculationRoundingMode.ROUND)).toBe(11);
    expect(applyCurrencyRounding(10.556, StockMarket.TW, CalculationRoundingMode.FLOOR)).toBe(10);
  });

  it("validates restored accounts, resolves per-account fee overrides, and resolves activeAccountId", () => {
    const shared: AccountFeeSettings = {
      feeDiscount: 0.28,
      minFeeRegular: 1,
      minFeeOddLot: 1,
    };
    const trimmed = validateRestoredAccounts([
      { id: 1, name: " 退休帳戶 ", feeDiscount: null, minFeeRegular: null, minFeeOddLot: null },
      { id: 2, name: "長期投資", feeDiscount: 0.18, minFeeRegular: 2, minFeeOddLot: 3 },
    ]);
    expect(trimmed[0].name).toBe("退休帳戶");
    expect(resolveAccountFeeSettings(trimmed[0], shared)).toEqual(shared);
    expect(resolveAccountFeeSettings(trimmed[1], shared)).toEqual({
      feeDiscount: 0.18,
      minFeeRegular: 2,
      minFeeOddLot: 3,
    });
    expect(resolveAccountFeeSettings(null, shared)).toEqual(shared);

    expect(resolveActiveAccountId(1, trimmed)).toBe(1);
    expect(resolveActiveAccountId(99, trimmed)).toBe(0);
    expect(resolveActiveAccountId(0, trimmed)).toBe(0);

    const invalidCases = [
      [],
      [{ id: 0, name: "帳戶", feeDiscount: null, minFeeRegular: null, minFeeOddLot: null }],
      [{ id: 1, name: " ", feeDiscount: null, minFeeRegular: null, minFeeOddLot: null }],
      [
        { id: 1, name: "A", feeDiscount: null, minFeeRegular: null, minFeeOddLot: null },
        { id: 1, name: "B", feeDiscount: null, minFeeRegular: null, minFeeOddLot: null },
      ],
      [{ id: 1, name: "帳戶", feeDiscount: -0.1, minFeeRegular: null, minFeeOddLot: null }],
      [{ id: 1, name: "帳戶", feeDiscount: Number.NaN, minFeeRegular: null, minFeeOddLot: null }],
      [{ id: 1, name: "帳戶", feeDiscount: null, minFeeRegular: -1, minFeeOddLot: null }],
    ];
    for (const invalid of invalidCases) {
      expect(() => validateRestoredAccounts(invalid)).toThrow();
    }
  });

  it("formats amounts, shares, asset amounts, and escapes SQL LIKE wildcards", () => {
    expect(formatMarketAmount(1234.567, StockMarket.US)).toBe("1,234.57");
    expect(formatMarketAmount(1234.567, StockMarket.TW)).toBe("1,235");
    expect(formatHomeAmount(1234.5, HomeDisplayMode.US)).toBe("1,234.50");
    expect(formatHomeAmount(1234.5, HomeDisplayMode.COMBINED)).toBe("1,235");
    expect(formatMarketPlainAmount(1234.567, StockMarket.US)).toBe("1234.57");
    expect(formatMarketPlainAmount(1234.567, StockMarket.TW)).toBe("1235");

    expect(formatShareInputValue(1000)).toBe("1000");
    expect(formatShareInputValue(12.5)).toBe("12.5");
    expect(formatShareInputValue(1e-7)).toBe("0.0000001");
    expect(formatShareCount(1234.5)).toBe("1,234.5");
    expect(formatAssetInputAmount(12345.67)).toBe("12345.67");

    expect(escapeLikePattern("A%B_C\\D")).toBe("A\\%B\\_C\\\\D");
  });

  it("computes Taiwan fees (regular vs odd lot), taxes, 2.11% supplementary NHI fee, and transactionFeeForType", () => {
    expect(calculateTaiwanFee(10, 1000, 0.28, 20, 1)).toBe(20);
    expect(calculateTaiwanFee(10, 10, 0.28, 20, 1)).toBe(1);
    expect(calculateTaiwanFee(1000, 1000, 0.28, 20, 1)).toBe(399);

    expect(calculateTaiwanTax(100, 1000, "股票", false, DEFAULT_TAIWAN_TAX_RATES)).toBe(300);
    expect(calculateTaiwanTax(100, 1000, "ETF", false, DEFAULT_TAIWAN_TAX_RATES)).toBe(100);
    expect(calculateTaiwanTax(100, 1000, "股票", true, DEFAULT_TAIWAN_TAX_RATES)).toBe(150);
    expect(calculateTaiwanTax(100, 1000, "ETF", false, DEFAULT_TAIWAN_TAX_RATES, "ROUND", true)).toBe(0);

    // > 20,000 TWD -> 2.11% rounded; 20,000 exact or US -> 0
    expect(calculateTaiwanSupplementaryNhiFee(20000, StockMarket.TW)).toBe(0);
    expect(calculateTaiwanSupplementaryNhiFee(20001, StockMarket.TW)).toBe(422);
    expect(calculateTaiwanSupplementaryNhiFee(100000, StockMarket.TW)).toBe(2110);
    expect(calculateTaiwanSupplementaryNhiFee(100000, StockMarket.US)).toBe(0);

    expect(transactionFeeForType(TransactionType.BUY, 20, 10)).toBe(20);
    expect(transactionFeeForType(TransactionType.CASH_DIVIDEND, 20, 10)).toBe(10);
    expect(transactionFeeForType(TransactionType.MARGIN_REPAYMENT, 20, 10)).toBe(0);
  });
});

describe("XIRR solver (ReturnRateCalculator parity)", () => {
  it("computes annual rate using calendar days in zoneId across leap year and DST (golden vector xirr_dst_leap_year_01)", () => {
    const t0 = new Date("2024-01-01T12:00:00-05:00").getTime();
    const t1 = new Date("2025-01-01T12:00:00-05:00").getTime();
    const rate = calculateXirrRate(
      [
        { dateMillis: t0, amount: -1000.0 },
        { dateMillis: t1, amount: 1100.0 },
      ],
      0.1,
      "America/New_York"
    );
    expect(rate).not.toBeNull();
    const expected = Math.pow(1.1, 365 / 366) - 1;
    expect(rate!).toBeCloseTo(expected, 8);
  });

  it("returns null when < 2 flows or all same sign, and falls back to bisection for extreme rates", () => {
    expect(calculateXirrRate([{ dateMillis: 0, amount: -100 }])).toBeNull();
    expect(
      calculateXirrRate([
        { dateMillis: 0, amount: -100 },
        { dateMillis: 86400000, amount: -50 },
      ])
    ).toBeNull();

    // Extreme 10x return over 60 days -> Newton fails or overshoots, bisection handles it cleanly
    const pct = calculateXirrPercentage(
      [
        { dateMillis: Date.UTC(2025, 0, 1), amount: -100 },
        { dateMillis: Date.UTC(2025, 2, 2), amount: 1000 },
      ],
      0.1,
      "UTC"
    );
    expect(pct).not.toBeNull();
    expect(pct!).toBeGreaterThan(100);
  });
});
