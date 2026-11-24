import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddTransactionPage } from "../AddTransactionPage";
import { TransactionDetailPage } from "../TransactionDetailPage";
import { TransactionsPage } from "../TransactionsPage";
import {
  DEFAULT_USER_SETTINGS,
  StockExchange,
  StockMarket,
  TransactionType,
  type Account,
  type Stock,
  type StockTransaction,
} from "@/types";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockAddTransaction = vi.fn().mockResolvedValue({ id: 999 });
const mockEditTransaction = vi.fn().mockResolvedValue({ id: 1 });
const mockRemoveTransaction = vi.fn().mockResolvedValue(undefined);
const mockUpdateSettings = vi.fn().mockResolvedValue(DEFAULT_USER_SETTINGS);

const baseTx = (
  overrides: Partial<StockTransaction> &
    Pick<StockTransaction, "id" | "stockCode" | "market" | "date" | "type">,
): StockTransaction => ({
  accountId: 1,
  recordTime: overrides.date,
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
  ...overrides,
});

const sampleAccounts: Account[] = [
  { id: 1, name: "主帳戶", feeDiscount: null, minFeeRegular: null, minFeeOddLot: null },
];

const sampleStocks: Stock[] = [
  {
    code: "2330",
    name: "台積電",
    market: StockMarket.TW,
    exchange: StockExchange.LISTED,
    industry: "半導體",
    stockType: "股票",
  },
  {
    code: "AAPL",
    name: "Apple Inc.",
    market: StockMarket.US,
    exchange: StockExchange.UNKNOWN,
    industry: "Tech",
    stockType: "",
  },
];

const marginOpenTx = baseTx({
  id: 10,
  stockCode: "2330",
  market: StockMarket.TW,
  date: new Date(2025, 0, 10).getTime(),
  type: TransactionType.MARGIN_BUY,
  buyPrice: 1000,
  buyShares: 1000,
  expense: 1001425,
  marginPrincipal: 600000,
  marginAnnualRate: 6.45,
  marginLotId: "M-20250110-1",
  note: "融資開倉",
});

const marginRepayTx = baseTx({
  id: 11,
  stockCode: "2330",
  market: StockMarket.TW,
  date: new Date(2025, 0, 20).getTime(),
  type: TransactionType.MARGIN_REPAYMENT,
  marginRepaymentLotId: "M-20250110-1",
  marginRepayment: 200000,
  marginActualInterest: 1200,
  expense: 201200,
  note: "部分還款",
});

const usBuyTx = baseTx({
  id: 12,
  stockCode: "AAPL",
  market: StockMarket.US,
  date: new Date(2025, 0, 20).getTime(),
  type: TransactionType.BUY,
  buyPrice: 200,
  buyShares: 5,
  expense: 1000,
  note: "蘋果買進",
});

const sampleTxs = [marginOpenTx, marginRepayTx, usBuyTx];
const sampleTxsWithStock = sampleTxs.map((tx) => ({
  transaction: tx,
  stock:
    sampleStocks.find((s) => s.code === tx.stockCode) ?? {
      code: tx.stockCode,
      name: tx.stockCode,
      market: tx.market,
      exchange: StockExchange.UNKNOWN,
      industry: "",
      stockType: "",
    },
}));

vi.mock("@/hooks/usePortfolioData", () => ({
  usePortfolioData: () => ({
    isLoading: false,
    accounts: sampleAccounts,
    activeAccountId: 0,
    transactions: sampleTxs,
    transactionsWithStock: sampleTxsWithStock,
    stocks: sampleStocks,
    stockMap: new Map(sampleStocks.map((s) => [`${s.market}:${s.code}`, s])),
    settings: { ...DEFAULT_USER_SETTINGS, marginFeatureEnabled: true },
    addTransaction: mockAddTransaction,
    editTransaction: mockEditTransaction,
    removeTransaction: mockRemoveTransaction,
    updateSettings: mockUpdateSettings,
  }),
}));

function renderWithRouter(initialEntry: string, element: React.ReactNode, path: string) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Transactions feature pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("filters transactions with multi-term whitespace search and updates resultCount", () => {
    renderWithRouter("/transactions", <TransactionsPage />, "/transactions");
    expect(screen.getByTestId("transactions-count")).toHaveTextContent("共 3 筆交易");

    const searchInput = screen.getByLabelText("搜尋交易紀錄");
    fireEvent.change(searchInput, { target: { value: "2330 還款" } });

    expect(screen.getByTestId("transactions-count")).toHaveTextContent("符合 1 筆 / 共 3 筆");
    expect(screen.getByText(/部分還款/)).toBeInTheDocument();
  });

  it("disables Edit and Delete buttons on TransactionDetailPage when referenced by repayment", () => {
    renderWithRouter(
      "/transactions/10",
      <TransactionDetailPage />,
      "/transactions/:transactionId",
    );
    expect(screen.getByTestId("transaction-detail-ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "編輯" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "刪除" })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("無法編輯或刪除");
  });

  it("shows Missing view on TransactionDetailPage for unknown id", () => {
    renderWithRouter(
      "/transactions/99999",
      <TransactionDetailPage />,
      "/transactions/:transactionId",
    );
    expect(screen.getByTestId("transaction-detail-missing")).toBeInTheDocument();
  });

  it("renders AddTransactionPage with TW financing types, share stepper, and self-funded override", () => {
    renderWithRouter(
      "/transactions/new?stockCode=2330&market=TW",
      <AddTransactionPage />,
      "/transactions/new",
    );
    expect(screen.getByRole("button", { name: "還融資" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "融資買進" })).toBeInTheDocument();

    // Share stepper +1000 for TW
    fireEvent.click(screen.getByRole("button", { name: "買進股數 增加 1000" }));
    expect(screen.getByLabelText("買進股數")).toHaveValue(1000);

    // Select 融資買進 and test manual 0 override vs clear
    fireEvent.click(screen.getByRole("button", { name: "融資買進" }));
    fireEvent.change(screen.getByLabelText("買進價格"), { target: { value: "100" } });
    const selfFundedInput = screen.getByLabelText(/融資自備款/);
    fireEvent.change(selfFundedInput, { target: { value: "0" } });
    expect(screen.getByText(/手動覆寫/)).toBeInTheDocument();

    fireEvent.change(selfFundedInput, { target: { value: "" } });
    expect(screen.getByText(/自動 = 支出 - 本金/)).toBeInTheDocument();
  });
});
