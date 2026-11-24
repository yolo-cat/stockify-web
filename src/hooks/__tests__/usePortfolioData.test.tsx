import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { usePortfolioData } from "@/hooks/usePortfolioData";
import { resetDemoState } from "@/services";
import { StockMarket, TransactionType } from "@/types";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    );
  };
}

describe("usePortfolioData", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetDemoState();
    window.history.pushState({}, "", "/holdings?demo=1");
  });

  it("loads demo portfolio data, computes holdings, and aggregates asset overview", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => usePortfolioData(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.accounts.length).toBe(2);
    expect(result.current.transactions.length).toBeGreaterThanOrEqual(11);
    expect(result.current.holdings.length).toBe(6);
    expect(result.current.unrealizedHoldings.length).toBe(6);
    expect(result.current.holdingsUiState.marketValue).toBeGreaterThan(0);
    expect(result.current.assetOverviewUiState.totalBankDeposit).toBe(730000);
    expect(result.current.assetOverviewUiState.totalLoan).toBe(3200000);

    // Verify usStockValue is converted to TWD and matches sum of US entries in stockValues
    const expectedUsTwd =
      result.current.holdingsUiState.usMarketValue *
      result.current.effectiveUsdToTwdRate;
    const usEntriesSum = result.current.assetOverviewUiState.stockValues
      .filter((s) => s.stock.market === StockMarket.US)
      .reduce((sum, s) => sum + s.marketValue, 0);
    expect(result.current.assetOverviewUiState.usStockValue).toBeCloseTo(
      expectedUsTwd,
      6,
    );
    expect(result.current.assetOverviewUiState.usStockValue).toBeCloseTo(
      usEntriesSum,
      6,
    );
  });

  it("validates before adding transactions and blocks deleting referenced margin/short lots", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => usePortfolioData(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Referenced margin buy lot (id=5, M-2317-01) cannot be deleted
    const marginBuyTx = result.current.transactions.find((t) => t.id === 5);
    expect(marginBuyTx).toBeDefined();
    await expect(
      result.current.removeTransaction(marginBuyTx!),
    ).rejects.toThrow(/無法刪除/);

    // Invalid sell exceeding held shares is rejected before DB write
    await expect(
      result.current.addTransaction({
        stockCode: "2330",
        market: StockMarket.TW,
        accountId: 1,
        date: Date.UTC(2025, 6, 1),
        recordTime: Date.UTC(2025, 6, 1) + 100,
        type: TransactionType.SELL,
        buyPrice: 0,
        buyShares: 0,
        sellPrice: 1050,
        sellShares: 999999,
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
      }),
    ).rejects.toThrow();

    // Updating settings persists in demo mode
    await act(async () => {
      await result.current.updateSettings({ activeAccountId: 1 });
    });
    await waitFor(() => {
      expect(result.current.activeAccountId).toBe(1);
    });
  });
});
