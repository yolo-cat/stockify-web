import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../SettingsPage";
import {
  DEFAULT_USER_SETTINGS,
  StockMarket,
  ThemeMode,
  type Account,
} from "@/types";

const mockUpdateSettings = vi.fn().mockResolvedValue(DEFAULT_USER_SETTINGS);
const mockSyncStockList = vi.fn().mockResolvedValue({ syncedCount: 100 });
const mockClearAllTransactions = vi.fn().mockResolvedValue(undefined);
const mockClearAllUserData = vi.fn().mockResolvedValue(undefined);

const sampleAccounts: Account[] = [
  { id: 1, name: "主帳戶", feeDiscount: null, minFeeRegular: null, minFeeOddLot: null },
];

vi.mock("@/hooks/usePortfolioData", () => ({
  PORTFOLIO_QUERY_KEYS: {
    quotes: (userId: string) => ["portfolio", "quotes", userId] as const,
  },
  usePortfolioData: () => ({
    userId: "demo-user",
    accounts: sampleAccounts,
    transactionsWithStock: [],
    settings: DEFAULT_USER_SETTINGS,
    holdingsOrder: { order: [], realizedOrder: [] },
    updateSettings: mockUpdateSettings,
    updateHoldingsOrder: vi.fn(),
    syncStockList: mockSyncStockList,
    importTransactions: vi.fn(),
    saveAccount: vi.fn(),
    removeAccount: vi.fn(),
    clearAllTransactions: mockClearAllTransactions,
    clearAllUserData: mockClearAllUserData,
  }),
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders settings controls, version footer, and updates theme", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <SettingsPage />
      </QueryClientProvider>,
    );

    expect(screen.getByText("目前版本 v0.1.0")).toBeInTheDocument();
    const themeSelect = screen.getByLabelText("主題外觀");
    fireEvent.change(themeSelect, { target: { value: ThemeMode.AMOLED } });
    expect(mockUpdateSettings).toHaveBeenCalledWith({ theme: ThemeMode.AMOLED });
    expect(document.documentElement.classList.contains("amoled")).toBe(true);
  });

  it("triggers manual TW stock list sync and delete confirmation dialog", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <SettingsPage />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "同步台股清單" }));
    expect(mockSyncStockList).toHaveBeenCalledWith(StockMarket.TW);

    fireEvent.click(screen.getByRole("button", { name: "刪除全部交易資料" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("確認刪除全部交易資料");
  });
});
