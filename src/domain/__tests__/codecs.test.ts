import { describe, expect, it } from "vitest";
import {
  assignProvisionalImportIds,
  buildMarketRepairAliases,
  CSV_HEADERS,
  decodeCsvBytes,
  deduplicateCsvTransactions,
  describeCsvImportRow,
  describeCsvImportRows,
  exportTransactionsToCsv,
  importTransactionsFromCsv,
  nextAssetBalanceId,
  parseAssetBalanceBackup,
  parseHoldingsOrderBackup,
  requiredExistingTransactionKeysForImport,
  serializeAssetBalanceBackup,
  serializeHoldingsOrderBackup,
  validateTransactionSequence,
} from "@/domain";
import { StockMarket, TransactionType, type Stock, type StockTransaction } from "@/types";

const TW_2330: Stock = {
  name: "台積電",
  code: "2330",
  market: StockMarket.TW,
  exchange: "上市",
  industry: "半導體",
  stockType: "股票",
};

function makeTx(overrides: Partial<StockTransaction>): StockTransaction {
  return {
    id: 1,
    stockCode: "2330",
    market: StockMarket.TW,
    accountId: 1,
    date: new Date(2026, 10, 5, 0, 0, 0, 0).getTime(),
    recordTime: new Date(2026, 10, 5, 9, 8, 7, 123).getTime(),
    type: TransactionType.BUY,
    buyPrice: 100,
    buyShares: 1000,
    sellPrice: 0,
    sellShares: 0,
    fee: 0,
    tax: 0,
    income: 0,
    expense: 100000,
    cashDividend: 0,
    exDividendShares: 0,
    dividendIncome: 0,
    supplementaryHealthInsurancePremium: 0,
    stockDividend: 0,
    dividendShares: 0,
    exRightsShares: 0,
    note: "",
    capitalReductionRatio: 0,
    sharesBeforeReduction: 0,
    sharesAfterReduction: 0,
    cashReturned: 0,
    stockSplitRatio: 0,
    sharesBeforeSplit: 0,
    sharesAfterSplit: 0,
    marginPrincipal: 0,
    marginAnnualRate: 0,
    marginLotId: "",
    marginRepaymentLotId: "",
    marginRepayment: 0,
    marginSelfFunded: 0,
    marginSelfFundedOverridden: false,
    marginActualInterest: 0,
    shortBorrowPrincipal: 0,
    shortBorrowAnnualRate: 0,
    shortLotId: "",
    shortCoverLotId: "",
    shortCoverShares: 0,
    shortCompensationLotId: "",
    shortCompensation: 0,
    ...overrides,
  };
}

describe("CSV & Asset Backup Codecs golden vectors", () => {
  it("exports 46-column UTF-8 BOM CSV and round-trips NHI premium & multiline notes", () => {
    expect(CSV_HEADERS).toHaveLength(46);
    const tx = makeTx({
      type: TransactionType.CASH_DIVIDEND,
      buyPrice: 0,
      buyShares: 0,
      expense: 0,
      cashDividend: 100,
      exDividendShares: 1000,
      fee: 10,
      income: 97880,
      dividendIncome: 97880,
      supplementaryHealthInsurancePremium: 2110,
      note: '備註 "第一行"\n第二行',
    });
    const bytes = exportTransactionsToCsv([{ transaction: tx, stock: TW_2330 }]);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);

    const imported = importTransactionsFromCsv(bytes);
    expect(imported).toHaveLength(1);
    expect(imported[0].transaction.dividendIncome).toBe(97880);
    expect(imported[0].transaction.supplementaryHealthInsurancePremium).toBe(2110);
    expect(imported[0].transaction.note).toBe('備註 "第一行"\n第二行');
  });

  it("csv_import_excel_dates_and_grouped_numbers_02 & csv_old_format_self_funded_override_false_04", () => {
    const headersWithoutOverride = CSV_HEADERS.filter((h) => h !== "融資自備款是否覆寫");
    const row = headersWithoutOverride.map((h) => {
      switch (h) {
        case "交易":
          return "融資買進";
        case "帳戶ID":
          return "1";
        case "市場":
          return "TW";
        case "日期":
          return "2026/11/5";
        case "紀錄時間":
          return "2026-11-5 09:08:07.123";
        case "股名":
          return "元大台灣50";
        case "股號":
          return "0050";
        case "買進價格":
          return "100";
        case "買進股數":
          return '"1,000"';
        case "支出":
          return '"100,000.25"';
        case "融資本金":
          return "60000";
        case "融資自備款":
          return "40000";
        default:
          return "0";
      }
    });
    const csv = `${headersWithoutOverride.join(",")}\n${row.join(",")}\n`;
    const imported = importTransactionsFromCsv(csv);
    expect(imported[0].stockCode).toBe("0050");
    expect(imported[0].transaction.buyShares).toBe(1000);
    expect(imported[0].transaction.expense).toBe(100000.25);
    expect(imported[0].transaction.marginSelfFunded).toBe(40000);
    expect(imported[0].transaction.marginSelfFundedOverridden).toBe(false);
  });

  it("decodes UTF-16LE BOM and Big5 CSV bytes", () => {
    // UTF-16LE BOM for "abc"
    const utf16le = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00, 0x63, 0x00]);
    expect(decodeCsvBytes(utf16le)).toBe("abc");

    // Big5 bytes for "台積電" = A5 x B3 -> 0xA5 0x78 0xBF 0x6E 0xB9 0x71
    const big5 = new Uint8Array([0xa5, 0x78, 0xbf, 0x6e, 0xb9, 0x71]);
    expect(decodeCsvBytes(big5)).toBe("台積電");
  });

  it("csv_provisional_import_ids_same_timestamp_05, dedup & market repair aliases 06-07, error context 10-11", () => {
    const existingOpening = makeTx({
      id: 10,
      date: 1,
      recordTime: 1,
      type: TransactionType.MARGIN_BUY,
      marginPrincipal: 60000,
      marginLotId: "margin-1",
    });
    const importedRepayment = makeTx({
      id: 0,
      date: 1,
      recordTime: 1,
      type: TransactionType.MARGIN_REPAYMENT,
      buyPrice: 0,
      buyShares: 0,
      marginRepaymentLotId: "margin-1",
      marginRepayment: 10000,
      expense: 10000,
    });
    expect(validateTransactionSequence([existingOpening, importedRepayment]).valid).toBe(false);
    const [withProvisional] = assignProvisionalImportIds([existingOpening], [importedRepayment]);
    expect(withProvisional.id).toBeGreaterThan(existingOpening.id);
    expect(validateTransactionSequence([existingOpening, withProvisional]).valid).toBe(true);

    const aliases = buildMarketRepairAliases(
      [{ market: StockMarket.TW, code: "2330" }],
      {
        "2330": [
          { ...TW_2330, market: StockMarket.TW },
          { ...TW_2330, market: StockMarket.US },
        ],
      }
    );
    expect(aliases).toEqual({ "US:2330": StockMarket.TW });

    const legacyExisting = makeTx({ id: 41, market: StockMarket.US, recordTime: 100 });
    const newImported = makeTx({ id: 0, market: StockMarket.TW, recordTime: 100 });
    const deduped = deduplicateCsvTransactions(
      [{ stockName: "台積電", stockCode: "2330", market: StockMarket.TW, transaction: newImported }],
      [legacyExisting],
      aliases
    );
    expect(deduped).toEqual([]);

    const reqKeys = requiredExistingTransactionKeysForImport(
      [
        { market: StockMarket.TW, code: "2330" },
        { market: StockMarket.US, code: "AAPL" },
      ],
      {
        "2330": [{ ...TW_2330, market: StockMarket.US }],
        AAPL: [{ name: "Apple", code: "AAPL", market: StockMarket.US, exchange: "", industry: "", stockType: "" }],
      }
    );
    expect(reqKeys).toHaveLength(3);

    const rowCtx = describeCsvImportRow({
      stockName: "元大台灣50",
      stockCode: "0050",
      market: StockMarket.TW,
      transaction: makeTx({ stockCode: "0050", accountId: 1, type: TransactionType.STOCK_SPLIT }),
      sourceRowNumber: 136,
      sourceId: "413",
    });
    expect(rowCtx).toBe("（CSV 第 136 列，id=413，股號=0050，交易=分割，帳戶=1）");
    expect(describeCsvImportRows([])).toBe("");
  });

  it("asset_balance_utf8_round_trip_08, rejections_09, and holdings order backup", () => {
    const balances = {
      bankDeposits: [
        { id: 1, name: '台幣存款\n備用金 "A"', amount: 12345.67 },
        { id: 2, name: "零餘額", amount: 0 },
      ],
      loans: [{ id: 1, name: "房貸", amount: 99999.12 }],
    };
    const json = serializeAssetBalanceBackup(balances);
    expect(parseAssetBalanceBackup(json)).toEqual(balances);
    expect(parseAssetBalanceBackup(`\uFEFF${json}`)).toEqual(balances);
    expect(parseAssetBalanceBackup(serializeAssetBalanceBackup({ bankDeposits: [], loans: [] }))).toEqual({
      bankDeposits: [],
      loans: [],
    });

    expect(() =>
      parseAssetBalanceBackup(JSON.stringify({ format: "wrong", version: 1, bankDeposits: [], loans: [] }))
    ).toThrow();
    expect(() =>
      parseAssetBalanceBackup(
        JSON.stringify({
          format: "stockify.asset-balances",
          version: 1,
          bankDeposits: [{ id: 0, name: "A", amount: 1 }],
          loans: [],
        })
      )
    ).toThrow();
    expect(() =>
      parseAssetBalanceBackup(
        '{"format":"stockify.asset-balances","version":1,"bankDeposits":[],"loans":[{"id":1,"name":"L","amount":1e999}]}'
      )
    ).toThrow();

    expect(nextAssetBalanceId([1, 5, 3])).toBe(6);

    const orderJson = serializeHoldingsOrderBackup({
      order: ["TW:2330", " US:AAPL ", "TW:2330"],
      realizedOrder: ["TW:0050"],
    });
    expect(parseHoldingsOrderBackup(orderJson)).toEqual({
      order: ["TW:2330", "US:AAPL"],
      realizedOrder: ["TW:0050"],
    });
    expect(parseHoldingsOrderBackup("TW:2330\n\nUS:AAPL\n")).toEqual({
      order: ["TW:2330", "US:AAPL"],
      realizedOrder: [],
    });
  });
});
