import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetsPage } from "../AssetsPage";
import { StockMarket, type AssetBalances, type AssetOverviewUiState } from "@/types";

const mockSaveBankDeposit = vi.fn().mockResolvedValue(undefined);
const mockRemoveBankDeposit = vi.fn().mockResolvedValue(undefined);
const mockSaveLoan = vi.fn().mockResolvedValue(undefined);
const mockRemoveLoan = vi.fn().mockResolvedValue(undefined);
const mockReplaceAssetBalances = vi.fn().mockResolvedValue(undefined);

const sampleBalances: AssetBalances = {
  bankDeposits: [{ id: 1, name: "台新活存", amount: 500000 }],
  loans: [{ id: 1, name: "房貸", amount: 200000 }],
};

const sampleOverview: AssetOverviewUiState = {
  taiwanStockValue: 1000000,
  usStockValue: 300000,
  stockValues: [
    {
      stock: {
        code: "2330",
        name: "台積電",
        market: StockMarket.TW,
        exchange: "上市",
        industry: "",
        stockType: "",
      },
      marketValue: 1000000,
    },
  ],
  bankDeposits: sampleBalances.bankDeposits,
  loans: sampleBalances.loans,
  totalBankDeposit: 500000,
  totalLoan: 200000,
  grossAssets: 1800000,
  netAssets: 1600000,
};

vi.mock("@/hooks/usePortfolioData", () => ({
  usePortfolioData: () => ({
    isLoading: false,
    assetBalances: sampleBalances,
    assetOverviewUiState: sampleOverview,
    saveBankDeposit: mockSaveBankDeposit,
    removeBankDeposit: mockRemoveBankDeposit,
    saveLoan: mockSaveLoan,
    removeLoan: mockRemoveLoan,
    replaceAssetBalances: mockReplaceAssetBalances,
  }),
}));

describe("AssetsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("renders gross and net asset summary and toggles chart mode", () => {
    render(<AssetsPage />);
    expect(screen.getByTestId("net-assets-value")).toHaveTextContent("NT$1,600,000");

    const itemTab = screen.getByRole("tab", { name: "個別標的" });
    fireEvent.click(itemTab);
    expect(itemTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("2330 台積電")).toBeInTheDocument();
  });

  it("validates blank name in deposit dialog and keeps dialog open on error", () => {
    render(<AssetsPage />);
    fireEvent.click(screen.getByRole("button", { name: "新增存款" }));
    fireEvent.change(screen.getByLabelText("名稱"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    expect(screen.getByRole("alert")).toHaveTextContent("名稱不可為空白");
    expect(mockSaveBankDeposit).not.toHaveBeenCalled();
  });
});
