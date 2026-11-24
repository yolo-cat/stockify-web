import {
  StockMarket,
  TransactionType,
  type CsvTransaction,
  type Stock,
  type StockKey,
  type StockTransaction,
} from "@/types";
import {
  canonicalStockCode,
  formatMarketPlainAmount,
  formatShareInputValue,
  inferMarketFromCode,
  normalizeMarket,
  stockCacheKey,
} from "./market";
import { getSystemTimeZone } from "./xirr";

export const CSV_HEADERS: readonly string[] = [
  "id",
  "交易",
  "交易稅",
  "帳戶ID",
  "市場",
  "手續費",
  "支出",
  "收入",
  "日期",
  "現金股利",
  "筆記",
  "紀錄時間",
  "股名",
  "股票股利",
  "股號",
  "買進價格",
  "買進股數",
  "賣出價格",
  "賣出股數",
  "配發股數",
  "除息股數",
  "除權股數",
  "股息收入",
  "補充保費",
  "減資比例",
  "減資前股數",
  "減資後股數",
  "減資返還現金",
  "拆分比例",
  "拆分前股數",
  "拆分後股數",
  "融資本金",
  "融資年利率",
  "融資批次ID",
  "沖抵融資批次ID",
  "融資還款本金",
  "融資自備款",
  "融資自備款是否覆寫",
  "融資實際利息",
  "融券本金",
  "融券年費率",
  "融券批次ID",
  "沖抵融券批次ID",
  "買券還券股數",
  "融券補償批次ID",
  "融券補償金",
];

const REQUIRED_HEADERS: readonly string[] = [
  "交易",
  "交易稅",
  "帳戶ID",
  "手續費",
  "支出",
  "收入",
  "日期",
  "現金股利",
  "紀錄時間",
  "股名",
  "股票股利",
  "股號",
  "買進價格",
  "買進股數",
  "賣出價格",
  "賣出股數",
  "配發股數",
  "除息股數",
  "除權股數",
  "股息收入",
  "減資比例",
  "減資前股數",
  "減資後股數",
  "減資返還現金",
  "拆分比例",
  "拆分前股數",
  "拆分後股數",
];

const GROUPED_NUMBER_REGEX = /^[+-]?[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?$/;

function formatCsvDate(epochMillis: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epochMillis));
  let y = "1970";
  let m = "01";
  let d = "01";
  for (const p of parts) {
    if (p.type === "year") y = p.value;
    else if (p.type === "month") m = p.value;
    else if (p.type === "day") d = p.value;
  }
  return `${y}${m}${d}`;
}

function formatCsvRecordTime(epochMillis: number, timeZone: string): string {
  const d = new Date(epochMillis);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  let y = "1970";
  let m = "01";
  let day = "01";
  let hh = "00";
  let mm = "00";
  let ss = "00";
  for (const p of parts) {
    if (p.type === "year") y = p.value;
    else if (p.type === "month") m = p.value;
    else if (p.type === "day") day = p.value;
    else if (p.type === "hour") hh = String(Number(p.value) % 24).padStart(2, "0");
    else if (p.type === "minute") mm = p.value;
    else if (p.type === "second") ss = p.value;
  }
  const ms = String(((epochMillis % 1000) + 1000) % 1000).padStart(3, "0");
  return `${y}${m}${day} ${hh}:${mm}:${ss}.${ms}`;
}

function quoteCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportTransactionsToCsvString(
  items: readonly { transaction: StockTransaction; stock: Stock }[],
  timeZone: string = getSystemTimeZone()
): string {
  const lines: string[] = [CSV_HEADERS.join(",")];
  for (const { transaction: tx, stock } of items) {
    const market = inferMarketFromCode(stock.code);
    const record: Record<string, string> = {
      id: String(tx.id),
      交易: tx.type,
      交易稅: formatMarketPlainAmount(tx.tax, market),
      帳戶ID: String(tx.accountId),
      市場: market,
      手續費: formatMarketPlainAmount(tx.fee, market),
      支出: formatMarketPlainAmount(tx.expense, market),
      收入: formatMarketPlainAmount(tx.income, market),
      日期: formatCsvDate(tx.date, timeZone),
      現金股利: String(tx.cashDividend),
      筆記: tx.note || "",
      紀錄時間: formatCsvRecordTime(tx.recordTime, timeZone),
      股名: stock.name,
      股票股利: String(tx.stockDividend),
      股號: stock.code,
      買進價格: String(tx.buyPrice),
      買進股數: formatShareInputValue(tx.buyShares),
      賣出價格: String(tx.sellPrice),
      賣出股數: formatShareInputValue(tx.sellShares),
      配發股數: formatShareInputValue(tx.dividendShares),
      除息股數: formatShareInputValue(tx.exDividendShares),
      除權股數: formatShareInputValue(tx.exRightsShares),
      股息收入: formatMarketPlainAmount(tx.dividendIncome, market),
      補充保費: formatMarketPlainAmount(tx.supplementaryHealthInsurancePremium, market),
      減資比例: String(tx.capitalReductionRatio),
      減資前股數: formatShareInputValue(tx.sharesBeforeReduction),
      減資後股數: formatShareInputValue(tx.sharesAfterReduction),
      減資返還現金: String(tx.cashReturned),
      拆分比例: String(tx.stockSplitRatio),
      拆分前股數: formatShareInputValue(tx.sharesBeforeSplit),
      拆分後股數: formatShareInputValue(tx.sharesAfterSplit),
      融資本金: formatMarketPlainAmount(tx.marginPrincipal, market),
      融資年利率: String(tx.marginAnnualRate),
      融資批次ID: tx.marginLotId,
      沖抵融資批次ID: tx.marginRepaymentLotId,
      融資還款本金: formatMarketPlainAmount(tx.marginRepayment, market),
      融資自備款: tx.marginSelfFundedOverridden
        ? formatMarketPlainAmount(tx.marginSelfFunded, market)
        : "",
      融資自備款是否覆寫: String(tx.marginSelfFundedOverridden),
      融資實際利息: formatMarketPlainAmount(tx.marginActualInterest, market),
      融券本金: formatMarketPlainAmount(tx.shortBorrowPrincipal, market),
      融券年費率: String(tx.shortBorrowAnnualRate),
      融券批次ID: tx.shortLotId,
      沖抵融券批次ID: tx.shortCoverLotId,
      買券還券股數: formatShareInputValue(tx.shortCoverShares),
      融券補償批次ID: tx.shortCompensationLotId,
      融券補償金: formatMarketPlainAmount(tx.shortCompensation, market),
    };
    lines.push(CSV_HEADERS.map((h) => quoteCsvField(record[h] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function exportTransactionsToCsv(
  items: readonly { transaction: StockTransaction; stock: Stock }[],
  timeZone: string = getSystemTimeZone()
): Uint8Array {
  const csvBody = exportTransactionsToCsvString(items, timeZone);
  const encoded = new TextEncoder().encode(csvBody);
  const withBom = new Uint8Array(3 + encoded.length);
  withBom[0] = 0xef;
  withBom[1] = 0xbb;
  withBom[2] = 0xbf;
  withBom.set(encoded, 3);
  return withBom;
}

export function decodeCsvBytes(bytes: Uint8Array): string {
  const hasPrefix = (...prefix: number[]): boolean =>
    bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);

  let bomEncoding: string | null = null;
  if (hasPrefix(0xef, 0xbb, 0xbf)) bomEncoding = "utf-8";
  else if (hasPrefix(0xff, 0xfe)) bomEncoding = "utf-16le";
  else if (hasPrefix(0xfe, 0xff)) bomEncoding = "utf-16be";

  const decodeWith = (encoding: string): string => {
    const decoder = new TextDecoder(encoding, { fatal: true });
    return decoder.decode(bytes).replace(/^\uFEFF/, "");
  };

  try {
    if (bomEncoding !== null) {
      return decodeWith(bomEncoding);
    }
    try {
      return decodeWith("utf-8");
    } catch {
      return decodeWith("big5");
    }
  } catch {
    throw new Error("CSV 編碼無法辨識，請另存為 CSV UTF-8（逗號分隔）後再匯入");
  }
}

export function splitCsvRecords(csv: string): string[] {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;
  let index = 0;
  let fieldNumber = 1;
  let quoteRowNumber = 1;
  let quoteFieldNumber = 1;

  const pushRecord = (): void => {
    records.push(current);
    current = "";
    fieldNumber = 1;
  };

  while (index < csv.length) {
    const ch = csv[index];
    if (ch === '"') {
      current += ch;
      if (inQuotes && index + 1 < csv.length && csv[index + 1] === '"') {
        current += csv[index + 1];
        index += 2;
        continue;
      }
      if (!inQuotes) {
        quoteRowNumber = records.length + 1;
        quoteFieldNumber = fieldNumber;
      }
      inQuotes = !inQuotes;
    } else if (!inQuotes && ch === ",") {
      current += ch;
      fieldNumber++;
    } else if (!inQuotes && ch === "\r") {
      pushRecord();
      if (index + 1 < csv.length && csv[index + 1] === "\n") {
        index++;
      }
    } else if (!inQuotes && ch === "\n") {
      pushRecord();
    } else {
      current += ch;
    }
    index++;
  }

  if (inQuotes) {
    throw new Error(
      `CSV 第 ${quoteRowNumber} 列第 ${quoteFieldNumber} 欄的引號未閉合，請在欄位結尾補上雙引號；欄位內的雙引號須連寫兩次（""）`
    );
  }
  if (current.length > 0) {
    pushRecord();
  }
  return records;
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      current += ch;
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += line[i + 1];
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
    i++;
  }
  fields.push(current);
  return fields.map((raw) => {
    const trimmed = raw.trim();
    const unquoted =
      trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
        ? trimmed.slice(1, -1)
        : trimmed;
    return unquoted.replace(/""/g, '"');
  });
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

function localDateTimeToMillis(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number
): number {
  return new Date(year, month - 1, day, hour, minute, second, ms).getTime();
}

function parseDatePart(value: string): { year: number; month: number; day: number } | null {
  let match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) {
    match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value);
  }
  if (!match) {
    match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  }
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) return null;
  return { year, month, day };
}

export function parseCsvDate(value: string): number {
  const parsed = parseDatePart(value);
  if (!parsed) {
    throw new Error("日期格式錯誤，請使用 yyyyMMdd、yyyy/M/d 或 yyyy-M-d");
  }
  return localDateTimeToMillis(parsed.year, parsed.month, parsed.day, 0, 0, 0, 0);
}

export function parseCsvRecordTime(value: string): number {
  const spaceIdx = value.indexOf(" ");
  if (spaceIdx > 0) {
    const datePart = parseDatePart(value.slice(0, spaceIdx));
    const timeStr = value.slice(spaceIdx + 1);
    const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?$/.exec(timeStr);
    if (datePart && timeMatch) {
      const hour = Number(timeMatch[1]);
      const minute = Number(timeMatch[2]);
      const second = timeMatch[3] ? Number(timeMatch[3]) : 0;
      const ms = timeMatch[4] ? Number(timeMatch[4]) : 0;
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59) {
        return localDateTimeToMillis(
          datePart.year,
          datePart.month,
          datePart.day,
          hour,
          minute,
          second,
          ms
        );
      }
    }
  }
  throw new Error(
    "紀錄時間格式錯誤，請使用日期加 24 小時制時間，例如 20261105 09:08:07.123、2026/11/5 09:08:07 或 2026-11-5 09:08；日期與時間之間須有空格"
  );
}

function getOptionalValue(
  values: readonly string[],
  headerMap: Map<string, number>,
  header: string
): string {
  const idx = headerMap.get(header);
  return idx !== undefined && idx < values.length ? values[idx] : "";
}

function parseOptionalDouble(
  values: readonly string[],
  headerMap: Map<string, number>,
  header: string
): number {
  const raw = getOptionalValue(values, headerMap, header);
  if (!raw.trim()) return 0.0;
  const normalized = GROUPED_NUMBER_REGEX.test(raw) ? raw.replace(/,/g, "") : raw;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${header} 不是有效數字`);
  }
  return parsed;
}

function parseOptionalInt(
  values: readonly string[],
  headerMap: Map<string, number>,
  header: string,
  defaultValue: number
): number {
  const raw = getOptionalValue(values, headerMap, header);
  if (!raw.trim()) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${header} 不是有效整數`);
  }
  return parsed;
}

export function importTransactionsFromCsv(
  input: Uint8Array | string,
  validateMarket: boolean = true
): CsvTransaction[] {
  const csvText = typeof input === "string" ? input.replace(/^\uFEFF/, "") : decodeCsvBytes(input);
  const records = splitCsvRecords(csvText);
  if (records.length === 0) return [];

  const headerValues = parseCsvLine(records[0]).map((val, idx) =>
    idx === 0 ? val.replace(/^\uFEFF/, "") : val
  );
  const headerMap = new Map<string, number>();
  headerValues.forEach((h, idx) => headerMap.set(h, idx));

  const missing = REQUIRED_HEADERS.filter((h) => !headerMap.has(h));
  if (missing.length > 0) {
    throw new Error(`CSV 缺少必要欄位：${missing.join("、")}`);
  }

  const imported: CsvTransaction[] = [];
  for (let i = 1; i < records.length; i++) {
    const line = records[i];
    const lineNumber = i + 1;
    if (!line.trim()) continue;

    let parsedValues: string[] | null = null;
    try {
      parsedValues = parseCsvLine(line);
      if (parsedValues.length < headerValues.length) {
        const missingCols = headerValues.slice(parsedValues.length).join("、");
        throw new Error(
          `欄位數不足：表頭有 ${headerValues.length} 欄，本列只有 ${parsedValues.length} 欄；依表頭順序未讀到的欄位：${missingCols}。請檢查是否漏掉逗號分隔符，空白欄位也須保留分隔符`
        );
      }

      const type = parsedValues[headerMap.get("交易")!] as TransactionType;
      const stockCode = canonicalStockCode(parsedValues[headerMap.get("股號")!]);
      if (!stockCode) throw new Error("股號不可空白");
      const accountId = parseOptionalInt(parsedValues, headerMap, "帳戶ID", 1);
      if (accountId <= 0) throw new Error("帳戶ID 必須大於 0");

      const inferredMarket = inferMarketFromCode(stockCode);
      const rawMarket = getOptionalValue(parsedValues, headerMap, "市場");
      let market: StockMarket = inferredMarket;
      if (rawMarket.trim()) {
        const upper = rawMarket.trim().toUpperCase();
        if (upper !== StockMarket.TW && upper !== StockMarket.US) {
          throw new Error("市場必須是 TW 或 US");
        }
        if (validateMarket && upper !== inferredMarket) {
          throw new Error(`市場 ${upper} 與股號 ${stockCode} 推斷的 ${inferredMarket} 不一致`);
        }
        market = upper as StockMarket;
      }

      const overrideRaw = getOptionalValue(parsedValues, headerMap, "融資自備款是否覆寫");
      const marginSelfFundedOverridden =
        overrideRaw.toLowerCase() === "true" || overrideRaw === "1";

      const transaction: StockTransaction = {
        id: 0,
        stockCode,
        market,
        accountId,
        date: parseCsvDate(parsedValues[headerMap.get("日期")!]),
        recordTime: parseCsvRecordTime(parsedValues[headerMap.get("紀錄時間")!]),
        type,
        buyPrice: parseOptionalDouble(parsedValues, headerMap, "買進價格"),
        buyShares: parseOptionalDouble(parsedValues, headerMap, "買進股數"),
        sellPrice: parseOptionalDouble(parsedValues, headerMap, "賣出價格"),
        sellShares: parseOptionalDouble(parsedValues, headerMap, "賣出股數"),
        fee: parseOptionalDouble(parsedValues, headerMap, "手續費"),
        tax: parseOptionalDouble(parsedValues, headerMap, "交易稅"),
        income: parseOptionalDouble(parsedValues, headerMap, "收入"),
        expense: parseOptionalDouble(parsedValues, headerMap, "支出"),
        cashDividend: parseOptionalDouble(parsedValues, headerMap, "現金股利"),
        exDividendShares: parseOptionalDouble(parsedValues, headerMap, "除息股數"),
        dividendIncome: parseOptionalDouble(parsedValues, headerMap, "股息收入"),
        supplementaryHealthInsurancePremium: parseOptionalDouble(
          parsedValues,
          headerMap,
          "補充保費"
        ),
        stockDividend: parseOptionalDouble(parsedValues, headerMap, "股票股利"),
        dividendShares: parseOptionalDouble(parsedValues, headerMap, "配發股數"),
        exRightsShares: parseOptionalDouble(parsedValues, headerMap, "除權股數"),
        note: getOptionalValue(parsedValues, headerMap, "筆記"),
        capitalReductionRatio: parseOptionalDouble(parsedValues, headerMap, "減資比例"),
        sharesBeforeReduction: parseOptionalDouble(parsedValues, headerMap, "減資前股數"),
        sharesAfterReduction: parseOptionalDouble(parsedValues, headerMap, "減資後股數"),
        cashReturned: parseOptionalDouble(parsedValues, headerMap, "減資返還現金"),
        stockSplitRatio: parseOptionalDouble(parsedValues, headerMap, "拆分比例"),
        sharesBeforeSplit: parseOptionalDouble(parsedValues, headerMap, "拆分前股數"),
        sharesAfterSplit: parseOptionalDouble(parsedValues, headerMap, "拆分後股數"),
        marginPrincipal: parseOptionalDouble(parsedValues, headerMap, "融資本金"),
        marginAnnualRate: parseOptionalDouble(parsedValues, headerMap, "融資年利率"),
        marginLotId: getOptionalValue(parsedValues, headerMap, "融資批次ID"),
        marginRepaymentLotId: getOptionalValue(parsedValues, headerMap, "沖抵融資批次ID"),
        marginRepayment: parseOptionalDouble(parsedValues, headerMap, "融資還款本金"),
        marginSelfFunded: parseOptionalDouble(parsedValues, headerMap, "融資自備款"),
        marginSelfFundedOverridden,
        marginActualInterest: parseOptionalDouble(parsedValues, headerMap, "融資實際利息"),
        shortBorrowPrincipal: parseOptionalDouble(parsedValues, headerMap, "融券本金"),
        shortBorrowAnnualRate: parseOptionalDouble(parsedValues, headerMap, "融券年費率"),
        shortLotId: getOptionalValue(parsedValues, headerMap, "融券批次ID"),
        shortCoverLotId: getOptionalValue(parsedValues, headerMap, "沖抵融券批次ID"),
        shortCoverShares: parseOptionalDouble(parsedValues, headerMap, "買券還券股數"),
        shortCompensationLotId: getOptionalValue(parsedValues, headerMap, "融券補償批次ID"),
        shortCompensation: parseOptionalDouble(parsedValues, headerMap, "融券補償金"),
      };

      imported.push({
        stockName: parsedValues[headerMap.get("股名")!].trim(),
        stockCode,
        market,
        transaction,
        sourceRowNumber: lineNumber,
        sourceId: getOptionalValue(parsedValues, headerMap, "id"),
      });
    } catch (err) {
      const ctxParts: string[] = [];
      if (parsedValues) {
        const idVal = getOptionalValue(parsedValues, headerMap, "id");
        const codeVal = getOptionalValue(parsedValues, headerMap, "股號").trim();
        const typeVal = getOptionalValue(parsedValues, headerMap, "交易").trim();
        if (idVal.trim()) ctxParts.push(`id=${idVal}`);
        if (codeVal) ctxParts.push(`股號=${codeVal}`);
        if (typeVal) ctxParts.push(`交易=${typeVal}`);
      }
      const rowContext = ctxParts.length > 0 ? `（${ctxParts.join("，")}）` : "";
      const msg = err instanceof Error ? err.message : String(err);
      const reason = msg ? `：${msg}` : "";
      throw new Error(`CSV 第 ${lineNumber} 列格式錯誤${rowContext}${reason}`);
    }
  }

  return imported;
}

function transactionIdentityString(
  tx: StockTransaction,
  marketAliases: Record<string, string>
): string {
  const key = stockCacheKey(tx.market, tx.stockCode);
  const resolvedMarket = marketAliases[key] ?? normalizeMarket(tx.market);
  return JSON.stringify({
    ...tx,
    id: 0,
    stockCode: canonicalStockCode(tx.stockCode),
    market: resolvedMarket,
  });
}

export function buildMarketRepairAliases(
  importedStockKeys: readonly StockKey[],
  existingStocksByCode: Record<string, readonly Stock[]>
): Record<string, StockMarket> {
  const aliases: Record<string, StockMarket> = {};
  for (const targetKey of importedStockKeys) {
    const code = canonicalStockCode(targetKey.code);
    const canonicalMarket = inferMarketFromCode(code);
    if (normalizeMarket(targetKey.market) !== canonicalMarket) continue;
    const existing = existingStocksByCode[code] ?? [];
    for (const legacyStock of existing) {
      if (normalizeMarket(legacyStock.market) !== canonicalMarket) {
        aliases[stockCacheKey(legacyStock.market, code)] = canonicalMarket;
      }
    }
  }
  return aliases;
}

export function canonicalizeExistingTransactions(
  existingTransactions: readonly StockTransaction[],
  marketAliases: Record<string, StockMarket | string>
): StockTransaction[] {
  return existingTransactions.map((tx) => {
    const targetMarket = marketAliases[stockCacheKey(tx.market, tx.stockCode)];
    return targetMarket ? { ...tx, market: normalizeMarket(targetMarket) } : tx;
  });
}

export function deduplicateCsvTransactions(
  importedTransactions: readonly CsvTransaction[],
  existingTransactions: readonly StockTransaction[],
  marketAliases: Record<string, string> = {}
): CsvTransaction[] {
  const seen = new Set<string>();
  for (const existing of existingTransactions) {
    seen.add(transactionIdentityString(existing, marketAliases));
  }
  const result: CsvTransaction[] = [];
  for (const item of importedTransactions) {
    const idKey = transactionIdentityString(item.transaction, marketAliases);
    if (!seen.has(idKey)) {
      seen.add(idKey);
      result.push(item);
    }
  }
  return result;
}

export function requiredExistingTransactionKeysForImport(
  importedStockKeys: readonly StockKey[],
  existingStocksByCode: Record<string, readonly Stock[]>
): StockKey[] {
  const aliases = buildMarketRepairAliases(importedStockKeys, existingStocksByCode);
  const byCacheKey = new Map<string, StockKey>();
  for (const k of importedStockKeys) {
    const norm: StockKey = {
      market: normalizeMarket(k.market),
      code: canonicalStockCode(k.code),
    };
    byCacheKey.set(stockCacheKey(norm.market, norm.code), norm);
  }
  for (const legacyCacheKey of Object.keys(aliases)) {
    const colonIdx = legacyCacheKey.indexOf(":");
    if (colonIdx > 0) {
      const market = normalizeMarket(legacyCacheKey.slice(0, colonIdx));
      const code = canonicalStockCode(legacyCacheKey.slice(colonIdx + 1));
      byCacheKey.set(legacyCacheKey, { market, code });
    }
  }
  return Array.from(byCacheKey.values());
}

export function describeCsvImportRow(row: CsvTransaction): string {
  const segments: string[] = [];
  if (row.sourceRowNumber != null) {
    segments.push(`CSV 第 ${row.sourceRowNumber} 列`);
  }
  if (row.sourceId?.trim()) {
    segments.push(`id=${row.sourceId.trim()}`);
  }
  if (row.stockCode.trim()) {
    segments.push(`股號=${row.stockCode.trim()}`);
  }
  if (row.transaction.type.trim()) {
    segments.push(`交易=${row.transaction.type.trim()}`);
  }
  if (row.transaction.accountId > 0) {
    segments.push(`帳戶=${row.transaction.accountId}`);
  }
  return segments.length > 0 ? `（${segments.join("，")}）` : "CSV 資料";
}

export function describeCsvImportRows(rows: readonly CsvTransaction[]): string {
  if (rows.length === 0) return "";
  const seen = new Set<string>();
  const unique: CsvTransaction[] = [];
  for (const r of rows) {
    const key = `${r.sourceRowNumber ?? ""}:${r.sourceId}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }
  const shown = unique.slice(0, 3).map(describeCsvImportRow).join("；");
  const remaining = unique.length - 3;
  return remaining > 0
    ? `相關資料：${shown}；另有 ${remaining} 筆相關列`
    : `相關資料：${shown}`;
}
