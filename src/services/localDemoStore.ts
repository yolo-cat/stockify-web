import {
  DEFAULT_USER_SETTINGS,
  StockExchange,
  StockMarket,
  TransactionType,
  type Account,
  type AssetBalances,
  type BankDeposit,
  type HoldingsOrderData,
  type Loan,
  type Stock,
  type StockTransaction,
  type UserSettings,
} from "@/types";
import type {
  RealtimeStockInfo,
  StockHistoryPoint,
  TaiwanWeightedIndexInfo,
  UsdTwdExchangeRate,
  YahooDividendSummary,
} from "@/types/market";

export const DEMO_USER_ID = "demo-user";
const DEMO_STORAGE_KEY = "stockify_demo_state_v1";

export interface DemoStoreState {
  accounts: Account[];
  transactions: StockTransaction[];
  bankDeposits: BankDeposit[];
  loans: Loan[];
  settings: UserSettings;
  holdingsOrder: HoldingsOrderData;
  stocks: Stock[];
  quotes: Record<string, RealtimeStockInfo>;
  history: Record<string, StockHistoryPoint[]>;
}

function createEmptyTx(
  partial: Partial<StockTransaction> &
    Pick<
      StockTransaction,
      "id" | "stockCode" | "market" | "accountId" | "date" | "recordTime" | "type"
    >,
): StockTransaction {
  return {
    buyPrice: 0,
    buyShares: 0,
    sellPrice: 0,
    sellShares: 0,
    fee: 0,
    tax: 0,
    income: 0,
    expense: 0,
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
    ...partial,
  };
}

function buildSyntheticHistory(
  basePrice: number,
  endPrice: number,
  days = 260,
): StockHistoryPoint[] {
  const points: StockHistoryPoint[] = [];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  let stepIndex = 0;
  for (let i = days; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86_400_000);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    const progress = (days - i) / days;
    const wave = Math.sin(stepIndex * 0.18) * 0.025 + Math.cos(stepIndex * 0.07) * 0.015;
    const interpolated = basePrice + (endPrice - basePrice) * progress;
    const price = Number((interpolated * (1 + wave)).toFixed(2));
    const iso = d.toISOString().slice(0, 10);
    points.push({ date: iso, price: Math.max(1, price) });
    stepIndex++;
  }
  if (points.length > 0) {
    points[points.length - 1] = {
      ...points[points.length - 1],
      price: endPrice,
    };
  }
  return points;
}

export function createInitialDemoState(): DemoStoreState {
  const day = 86_400_000;
  const baseDate = Date.UTC(2025, 2, 3); // 2025-03-03

  const accounts: Account[] = [
    {
      id: 1,
      name: "預設帳戶",
      feeDiscount: 0.28,
      minFeeRegular: 1,
      minFeeOddLot: 1,
    },
    {
      id: 2,
      name: "美股複委託",
      feeDiscount: 1.0,
      minFeeRegular: 15,
      minFeeOddLot: 15,
    },
  ];

  const stocks: Stock[] = [
    {
      market: StockMarket.TW,
      code: "2330",
      name: "台積電",
      exchange: StockExchange.LISTED,
      industry: "半導體業",
      stockType: "股票",
    },
    {
      market: StockMarket.TW,
      code: "0050",
      name: "元大台灣50",
      exchange: StockExchange.LISTED,
      industry: "ETF",
      stockType: "ETF",
    },
    {
      market: StockMarket.TW,
      code: "2317",
      name: "鴻海",
      exchange: StockExchange.LISTED,
      industry: "其他電子業",
      stockType: "股票",
    },
    {
      market: StockMarket.US,
      code: "AAPL",
      name: "Apple Inc.",
      exchange: StockExchange.UNKNOWN,
      industry: "Technology",
      stockType: "",
    },
    {
      market: StockMarket.US,
      code: "VOO",
      name: "Vanguard S&P 500 ETF",
      exchange: StockExchange.UNKNOWN,
      industry: "ETF",
      stockType: "ETF",
    },
    {
      market: StockMarket.US,
      code: "BRK.B",
      name: "Berkshire Hathaway Inc.",
      exchange: StockExchange.UNKNOWN,
      industry: "Financials",
      stockType: "",
    },
  ];

  const transactions: StockTransaction[] = [
    createEmptyTx({
      id: 1,
      stockCode: "2330",
      market: StockMarket.TW,
      accountId: 1,
      date: baseDate,
      recordTime: baseDate + 1000,
      type: TransactionType.BUY,
      buyPrice: 920,
      buyShares: 6000,
      fee: 2201,
      expense: 5522201,
      note: "核心持股買進",
    }),
    createEmptyTx({
      id: 2,
      stockCode: "2330",
      market: StockMarket.TW,
      accountId: 1,
      date: baseDate + 45 * day,
      recordTime: baseDate + 45 * day + 1000,
      type: TransactionType.CASH_DIVIDEND,
      cashDividend: 4.5,
      exDividendShares: 6000,
      fee: 10,
      supplementaryHealthInsurancePremium: 570,
      dividendIncome: 26420,
      income: 26420,
      note: "季配息（含二代健保）",
    }),
    createEmptyTx({
      id: 3,
      stockCode: "0050",
      market: StockMarket.TW,
      accountId: 1,
      date: baseDate + 10 * day,
      recordTime: baseDate + 10 * day + 1000,
      type: TransactionType.BUY,
      buyPrice: 185,
      buyShares: 2000,
      fee: 148,
      expense: 370148,
      note: "市值型 ETF",
    }),
    createEmptyTx({
      id: 4,
      stockCode: "0050",
      market: StockMarket.TW,
      accountId: 1,
      date: baseDate + 70 * day,
      recordTime: baseDate + 70 * day + 1000,
      type: TransactionType.STOCK_SPLIT,
      stockSplitRatio: 4,
      sharesBeforeSplit: 2000,
      sharesAfterSplit: 8000,
      note: "1 拆 4 分割示範",
    }),
    createEmptyTx({
      id: 5,
      stockCode: "2317",
      market: StockMarket.TW,
      accountId: 1,
      date: baseDate + 20 * day,
      recordTime: baseDate + 20 * day + 1000,
      type: TransactionType.MARGIN_BUY,
      buyPrice: 160,
      buyShares: 2000,
      fee: 128,
      expense: 128128,
      marginPrincipal: 192000,
      marginAnnualRate: 6.45,
      marginLotId: "M-2317-01",
      marginSelfFunded: 128128,
      marginSelfFundedOverridden: false,
      note: "融資買進示範",
    }),
    createEmptyTx({
      id: 6,
      stockCode: "2317",
      market: StockMarket.TW,
      accountId: 1,
      date: baseDate + 50 * day,
      recordTime: baseDate + 50 * day + 1000,
      type: TransactionType.MARGIN_REPAYMENT,
      marginRepaymentLotId: "M-2317-01",
      marginRepayment: 96000,
      marginActualInterest: 1018,
      expense: 97018,
      note: "部分償還融資",
    }),
    createEmptyTx({
      id: 7,
      stockCode: "2317",
      market: StockMarket.TW,
      accountId: 1,
      date: baseDate + 60 * day,
      recordTime: baseDate + 60 * day + 1000,
      type: TransactionType.SHORT_SELL,
      sellPrice: 175,
      sellShares: 1000,
      fee: 70,
      tax: 525,
      income: 174405,
      shortBorrowPrincipal: 175000,
      shortBorrowAnnualRate: 3.5,
      shortLotId: "S-2317-01",
      note: "融券賣出避險",
    }),
    createEmptyTx({
      id: 8,
      stockCode: "2317",
      market: StockMarket.TW,
      accountId: 1,
      date: baseDate + 80 * day,
      recordTime: baseDate + 80 * day + 1000,
      type: TransactionType.SHORT_COVER,
      buyPrice: 168,
      buyShares: 500,
      fee: 34,
      expense: 84034,
      shortCoverLotId: "S-2317-01",
      shortCoverShares: 500,
      note: "買券還券半數",
    }),
    createEmptyTx({
      id: 9,
      stockCode: "AAPL",
      market: StockMarket.US,
      accountId: 2,
      date: baseDate + 15 * day,
      recordTime: baseDate + 15 * day + 1000,
      type: TransactionType.BUY,
      buyPrice: 215.5,
      buyShares: 25,
      fee: 15,
      expense: 5402.5,
      note: "Apple long-term",
    }),
    createEmptyTx({
      id: 10,
      stockCode: "VOO",
      market: StockMarket.US,
      accountId: 2,
      date: baseDate + 25 * day,
      recordTime: baseDate + 25 * day + 1000,
      type: TransactionType.BUY,
      buyPrice: 510.2,
      buyShares: 12,
      fee: 15,
      expense: 6137.4,
      note: "S&P 500 core",
    }),
    createEmptyTx({
      id: 11,
      stockCode: "BRK.B",
      market: StockMarket.US,
      accountId: 2,
      date: baseDate + 35 * day,
      recordTime: baseDate + 35 * day + 1000,
      type: TransactionType.BUY,
      buyPrice: 465.0,
      buyShares: 8,
      fee: 15,
      expense: 3735,
      note: "Berkshire dotted ticker",
    }),
  ];

  const bankDeposits: BankDeposit[] = [
    { id: 1, name: "玉山銀行活存", amount: 450000 },
    { id: 2, name: "台新 Richart", amount: 280000 },
  ];

  const loans: Loan[] = [
    { id: 1, name: "房屋貸款", amount: 3200000 },
  ];

  const now = Date.now();
  const quotes: Record<string, RealtimeStockInfo> = {
    "TW:2330": {
      currentPrice: 1045,
      change: 15,
      changePercent: 1.46,
      lastUpdated: now,
      limitState: "NONE",
    },
    "TW:0050": {
      currentPrice: 51.8,
      change: 0.65,
      changePercent: 1.27,
      lastUpdated: now,
      limitState: "NONE",
    },
    "TW:2317": {
      currentPrice: 172.5,
      change: -2.0,
      changePercent: -1.15,
      lastUpdated: now,
      limitState: "NONE",
    },
    "US:AAPL": {
      currentPrice: 232.4,
      change: 2.15,
      changePercent: 0.93,
      lastUpdated: now,
      limitState: "NONE",
    },
    "US:VOO": {
      currentPrice: 548.6,
      change: 3.4,
      changePercent: 0.62,
      lastUpdated: now,
      limitState: "NONE",
    },
    "US:BRK.B": {
      currentPrice: 489.2,
      change: -1.8,
      changePercent: -0.37,
      lastUpdated: now,
      limitState: "NONE",
    },
  };

  const history: Record<string, StockHistoryPoint[]> = {
    "TW:2330": buildSyntheticHistory(890, 1045),
    "TW:0050": buildSyntheticHistory(44, 51.8),
    "TW:2317": buildSyntheticHistory(155, 172.5),
    "US:AAPL": buildSyntheticHistory(205, 232.4),
    "US:VOO": buildSyntheticHistory(495, 548.6),
    "US:BRK.B": buildSyntheticHistory(440, 489.2),
  };

  return {
    accounts,
    transactions,
    bankDeposits,
    loans,
    settings: {
      ...DEFAULT_USER_SETTINGS,
      marginFeatureEnabled: true,
      usdToTwdRate: 32.15,
    },
    holdingsOrder: {
      order: ["TW:2330", "TW:0050", "TW:2317", "US:AAPL", "US:VOO", "US:BRK.B"],
      realizedOrder: [],
    },
    stocks,
    quotes,
    history,
  };
}

export function loadDemoState(): DemoStoreState {
  if (typeof window === "undefined") {
    return createInitialDemoState();
  }
  try {
    const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) {
      const initial = createInitialDemoState();
      window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(raw) as Partial<DemoStoreState>;
    const fallback = createInitialDemoState();
    return {
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : fallback.accounts,
      transactions: Array.isArray(parsed.transactions)
        ? parsed.transactions
        : fallback.transactions,
      bankDeposits: Array.isArray(parsed.bankDeposits)
        ? parsed.bankDeposits
        : fallback.bankDeposits,
      loans: Array.isArray(parsed.loans) ? parsed.loans : fallback.loans,
      settings: parsed.settings
        ? { ...DEFAULT_USER_SETTINGS, ...parsed.settings }
        : fallback.settings,
      holdingsOrder: parsed.holdingsOrder ?? fallback.holdingsOrder,
      stocks: Array.isArray(parsed.stocks) ? parsed.stocks : fallback.stocks,
      quotes: parsed.quotes ?? fallback.quotes,
      history: parsed.history ?? fallback.history,
    };
  } catch {
    return createInitialDemoState();
  }
}

export function saveDemoState(state: DemoStoreState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors in demo mode
  }
}

export function resetDemoState(): DemoStoreState {
  const initial = createInitialDemoState();
  saveDemoState(initial);
  return initial;
}

export function getDemoTaiwanIndex(): TaiwanWeightedIndexInfo {
  return {
    name: "發行量加權股價指數",
    current: 23456.78,
    previousClose: 23310.25,
    open: 23350.0,
    high: 23510.4,
    low: 23295.1,
    updatedAtMillis: Date.now(),
    change: 146.53,
    changePercent: 0.63,
  };
}

export function getDemoExchangeRate(): UsdTwdExchangeRate {
  return {
    rate: 32.15,
    updatedAtMillis: Date.now(),
    source: "demo-preview",
  };
}

export function getDemoDividendInfo(
  stockCodes: string[],
): Record<string, YahooDividendSummary | null> {
  const results: Record<string, YahooDividendSummary | null> = {};
  for (const code of stockCodes) {
    const normalized = code.trim().toUpperCase();
    if (normalized === "2330") {
      results[normalized] = {
        cashDividend: { amount: 4.5, date: "2025-06-12" },
        stockDividend: null,
      };
    } else if (normalized === "0050") {
      results[normalized] = {
        cashDividend: { amount: 2.7, date: "2025-07-21" },
        stockDividend: null,
      };
    } else if (normalized === "2317") {
      results[normalized] = {
        cashDividend: { amount: 5.8, date: "2025-07-02" },
        stockDividend: null,
      };
    } else {
      results[normalized] = { cashDividend: null, stockDividend: null };
    }
  }
  return results;
}

export function updateDemoAssetBalances(balances: AssetBalances): AssetBalances {
  const state = loadDemoState();
  state.bankDeposits = balances.bankDeposits;
  state.loans = balances.loans;
  saveDemoState(state);
  return {
    bankDeposits: state.bankDeposits,
    loans: state.loans,
  };
}
