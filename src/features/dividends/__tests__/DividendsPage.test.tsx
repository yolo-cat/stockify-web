import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DividendsPage } from "../DividendsPage";
import {
  DEFAULT_USER_SETTINGS,
  StockExchange,
  StockMarket,
  TransactionType,
  type Stock,
  type StockTransaction,
} from "@/types";

const mockUpdateSettings = vi.fn().mockResolvedValue(DEFAULT_USER_SETTINGS);
const mockInvokeDividendInfo = vi.fn().mockResolvedValue({
  results: {
    "2330": {
      cashDividend: { amount: 4.5, date: "2025-06-12" },
      stockDividend: null,
    },
  },
});

vi.mock("@/services", async () => {
  const actual = await vi.importActual<typeof import("@/services")>("@/services");
  return {
    ...actual,
    invokeDividendInfo: (...args: Parameters<typeof actual.invokeDividendInfo>) =>
      mockInvokeDividendInfo(...args),
  };
});

const sampleStocks: Stock[] = [
  {
    code: "2330",
    name: "台積電",
    market: StockMarket.TW,
    exchange: StockExchange.LISTED,
    industry: "",
    stockType: "",
  },
];

const sampleTxs: StockTransaction[] = [
  {
    id: 1,
    stockCode: "2330",
    market: StockMarket.TW,
    accountId: 1,
    date: new Date(2025, 0, 15).getTime(),
    recordTime: 1000,
    type: TransactionType.BUY,
    buyPrice: 1000,
    buyShares: 1000,
    sellPrice: 0,
    sellShares: 0,
    fee: 0,
    tax: 0,
    income: 0,
    expense: 1000000,
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
  },
];

vi.mock("@/hooks/usePortfolioData", () => ({
  usePortfolioData: () => ({
    isLoading: false,
    activeAccountId: 0,
    transactions: sampleTxs,
    scopedTransactions: sampleTxs,
    stockMap: new Map(sampleStocks.map((s) => [`${s.market}:${s.code}`, s])),
    settings: DEFAULT_USER_SETTINGS,
    updateSettings: mockUpdateSettings,
  }),
}));

describe("DividendsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders TW holdings dividend list and refreshes via invokeDividendInfo", async () => {
    render(<DividendsPage />);
    expect(screen.getByText("2330")).toBeInTheDocument();
    expect(screen.getByText("台積電")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "全部更新" }));
    await waitFor(() => {
      expect(mockInvokeDividendInfo).toHaveBeenCalledWith(["2330"]);
      expect(mockUpdateSettings).toHaveBeenCalled();
    });
  });
});
