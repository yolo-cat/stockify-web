import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  aggregateHoldingsUiState,
  buildAssetOverviewUiState,
  calculateHoldingInfo,
  canDeleteTransaction,
  canonicalStockCode,
  HoldingCalculationCache,
  normalizeMarket,
  resolveAccountFeeSettings,
  resolveActiveAccountId,
  sortHoldings,
  stockCacheKey,
  validateEditTransactionScopes,
  validateTransactionSequence,
} from "@/domain";
import {
  bootstrapDefaultAccountIfEmpty,
  consumeCertificateToastMessage,
  consumeFallbackToastMessage,
  deleteAccount,
  deleteAllTransactions,
  deleteAllUserData,
  deleteBankDeposit,
  deleteLoan,
  deleteTransaction,
  fetchAssetBalances,
  fetchHoldingsOrder,
  fetchStocks,
  fetchTaiwanHolidayCalendar,
  fetchTransactions,
  fetchUsdTwdExchangeRate,
  fetchUserSettings,
  insertTransaction,
  insertTransactionsBatch,
  invokeMarketIndex,
  invokeMarketQuotes,
  invokeStockListSync,
  loadBundledStocks,
  RealtimePollingController,
  replaceAllTransactions,
  replaceAssetBalances,
  shouldSyncStockList,
  updateTransaction,
  upsertAccount,
  upsertBankDeposit,
  upsertHoldingsOrder,
  upsertLoan,
  upsertUserSettings,
} from "@/services";
import {
  DEFAULT_USER_SETTINGS,
  StockExchange,
  StockMarket,
  type Account,
  type AccountFeeSettings,
  type AssetBalances,
  type BankDeposit,
  type HoldingInfo,
  type HoldingsOrderData,
  type Loan,
  type MarketQuoteTarget,
  type Stock,
  type StockTransaction,
  type TransactionWithStock,
  type UserSettings,
} from "@/types";
import type {
  RealtimeStockInfo,
  TaiwanHolidayCalendarSnapshot,
} from "@/types/market";
import { useAuth } from "./useAuth";

export const PORTFOLIO_QUERY_KEYS = {
  accounts: (userId: string) => ["portfolio", "accounts", userId] as const,
  transactions: (userId: string) =>
    ["portfolio", "transactions", userId] as const,
  assetBalances: (userId: string) =>
    ["portfolio", "assetBalances", userId] as const,
  settings: (userId: string) => ["portfolio", "settings", userId] as const,
  holdingsOrder: (userId: string) =>
    ["portfolio", "holdingsOrder", userId] as const,
  stocks: () => ["portfolio", "stocks"] as const,
  quotes: (userId: string) => ["portfolio", "quotes", userId] as const,
  taiwanIndex: () => ["market", "taiwanIndex"] as const,
  exchangeRate: () => ["market", "exchangeRate"] as const,
  holidayCalendar: (year: number) => ["market", "holidayCalendar", year] as const,
};

export function usePortfolioData() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const calcCacheRef = useRef(new HoldingCalculationCache());
  const pollingRef = useRef<RealtimePollingController | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: PORTFOLIO_QUERY_KEYS.accounts(userId),
    queryFn: () => bootstrapDefaultAccountIfEmpty(userId),
    enabled: Boolean(userId),
  });

  const transactionsQuery = useQuery({
    queryKey: PORTFOLIO_QUERY_KEYS.transactions(userId),
    queryFn: () => fetchTransactions(userId),
    enabled: Boolean(userId),
  });

  const assetBalancesQuery = useQuery({
    queryKey: PORTFOLIO_QUERY_KEYS.assetBalances(userId),
    queryFn: () => fetchAssetBalances(userId),
    enabled: Boolean(userId),
  });

  const settingsQuery = useQuery({
    queryKey: PORTFOLIO_QUERY_KEYS.settings(userId),
    queryFn: () => fetchUserSettings(userId),
    enabled: Boolean(userId),
  });

  const holdingsOrderQuery = useQuery({
    queryKey: PORTFOLIO_QUERY_KEYS.holdingsOrder(userId),
    queryFn: () => fetchHoldingsOrder(userId),
    enabled: Boolean(userId),
  });

  const stocksQuery = useQuery({
    queryKey: PORTFOLIO_QUERY_KEYS.stocks(),
    queryFn: async () => {
      const dbStocks = await fetchStocks();
      if (dbStocks.length > 0) return dbStocks;
      return loadBundledStocks();
    },
    staleTime: 60 * 60 * 1000,
    enabled: Boolean(userId),
  });

  const currentYear = new Date().getFullYear();
  const holidayCalendarQuery = useQuery({
    queryKey: PORTFOLIO_QUERY_KEYS.holidayCalendar(currentYear),
    queryFn: () => fetchTaiwanHolidayCalendar(currentYear),
    staleTime: 24 * 60 * 60 * 1000,
    enabled: Boolean(userId),
  });

  const exchangeRateQuery = useQuery({
    queryKey: PORTFOLIO_QUERY_KEYS.exchangeRate(),
    queryFn: () => fetchUsdTwdExchangeRate(false),
    staleTime: 24 * 60 * 60 * 1000,
    enabled: Boolean(userId),
  });

  const settings = settingsQuery.data ?? DEFAULT_USER_SETTINGS;

  const taiwanIndexQuery = useQuery({
    queryKey: PORTFOLIO_QUERY_KEYS.taiwanIndex(),
    queryFn: async () => {
      const res = await invokeMarketIndex({
        preferredSource: settings.stockDataSource,
      });
      return res.index;
    },
    enabled: Boolean(userId) && settings.showTaiwanWeightedIndex,
    staleTime: 60 * 1000,
  });

  const quotesQuery = useQuery<Record<string, RealtimeStockInfo>>({
    queryKey: PORTFOLIO_QUERY_KEYS.quotes(userId),
    queryFn: () =>
      queryClient.getQueryData<Record<string, RealtimeStockInfo>>(
        PORTFOLIO_QUERY_KEYS.quotes(userId),
      ) ?? {},
    initialData: {},
    enabled: Boolean(userId),
    staleTime: Infinity,
  });

  const accounts = accountsQuery.data ?? [];
  const transactions = transactionsQuery.data ?? [];
  const assetBalances: AssetBalances = assetBalancesQuery.data ?? {
    bankDeposits: [],
    loans: [],
  };
  const holdingsOrder: HoldingsOrderData = holdingsOrderQuery.data ?? {
    order: [],
    realizedOrder: [],
  };
  const stocks = stocksQuery.data ?? [];
  const quotes = quotesQuery.data ?? {};

  const stockMap = useMemo(() => {
    const map = new Map<string, Stock>();
    for (const stock of stocks) {
      map.set(stockCacheKey(stock.market, stock.code), stock);
    }
    return map;
  }, [stocks]);

  const quoteTargets = useMemo<MarketQuoteTarget[]>(() => {
    const seen = new Map<string, MarketQuoteTarget>();
    for (const tx of transactions) {
      const market = normalizeMarket(tx.market);
      const code = canonicalStockCode(tx.stockCode);
      if (!code) continue;
      const key = stockCacheKey(market, code);
      if (seen.has(key)) continue;
      const stock = stockMap.get(key);
      seen.set(key, {
        market,
        code,
        exchange: stock?.exchange ?? StockExchange.UNKNOWN,
        stockType: stock?.stockType ?? "",
      });
    }
    return [...seen.values()];
  }, [transactions, stockMap]);

  const fetchLatestQuotes = useCallback(
    async (targetsOverride?: MarketQuoteTarget[]) => {
      const targets = targetsOverride ?? quoteTargets;
      if (!userId || targets.length === 0) return;

      const res = await invokeMarketQuotes({
        stocks: targets,
        preferredTwSource: settings.stockDataSource,
        preferredUsSource: settings.usStockDataSource,
      });

      const fallbackMsg = consumeFallbackToastMessage(
        res.fallbackUsed,
        settings.notifyFallbackRepeatedly,
      );
      if (fallbackMsg) setNoticeMessage(fallbackMsg);

      const certMsg = consumeCertificateToastMessage(res.certificateFailure);
      if (certMsg) setNoticeMessage(certMsg);

      queryClient.setQueryData<Record<string, RealtimeStockInfo>>(
        PORTFOLIO_QUERY_KEYS.quotes(userId),
        (prev) => ({
          ...(prev ?? {}),
          ...res.quotes,
        }),
      );
    },
    [
      userId,
      quoteTargets,
      settings.stockDataSource,
      settings.usStockDataSource,
      settings.notifyFallbackRepeatedly,
      queryClient,
    ],
  );

  // Realtime market-hours-aware polling
  useEffect(() => {
    if (!userId || quoteTargets.length === 0) return;

    const controller = new RealtimePollingController({
      getIntervalSeconds: () => settings.refreshInterval,
      getHolidaySnapshot: (): TaiwanHolidayCalendarSnapshot | null =>
        holidayCalendarQuery.data ?? null,
      onPoll: async () => {
        await fetchLatestQuotes();
      },
    });

    pollingRef.current = controller;
    controller.start();

    return () => {
      controller.stop();
      if (pollingRef.current === controller) {
        pollingRef.current = null;
      }
    };
  }, [
    userId,
    quoteTargets.length,
    settings.refreshInterval,
    holidayCalendarQuery.data,
    fetchLatestQuotes,
  ]);

  // 7-day stock list sync guard on startup
  useEffect(() => {
    if (!userId) return;
    if (shouldSyncStockList(StockMarket.TW)) {
      void invokeStockListSync(StockMarket.TW).catch(() => undefined);
    }
    if (shouldSyncStockList(StockMarket.US)) {
      void invokeStockListSync(StockMarket.US).catch(() => undefined);
    }
  }, [userId]);

  const activeAccountId = useMemo(
    () => resolveActiveAccountId(settings.activeAccountId, accounts),
    [settings.activeAccountId, accounts],
  );

  const sharedFeeSettings = useMemo<AccountFeeSettings>(
    () => ({
      feeDiscount: settings.feeDiscount,
      minFeeRegular: settings.minFeeRegular,
      minFeeOddLot: settings.minFeeOddLot,
    }),
    [settings.feeDiscount, settings.minFeeRegular, settings.minFeeOddLot],
  );

  const feeSettingsByAccount = useMemo(() => {
    const record: Record<number, AccountFeeSettings> = {};
    for (const acc of accounts) {
      record[acc.id] = resolveAccountFeeSettings(acc, sharedFeeSettings);
    }
    return record;
  }, [accounts, sharedFeeSettings]);

  const scopedTransactions = useMemo(() => {
    if (activeAccountId === 0) return transactions;
    return transactions.filter((tx) => tx.accountId === activeAccountId);
  }, [transactions, activeAccountId]);

  const effectiveUsdToTwdRate = useMemo(() => {
    const liveRate = exchangeRateQuery.data?.rate;
    if (liveRate && Number.isFinite(liveRate) && liveRate > 0) {
      return liveRate;
    }
    return settings.usdToTwdRate > 0 ? settings.usdToTwdRate : 32.0;
  }, [exchangeRateQuery.data?.rate, settings.usdToTwdRate]);

  const holdings = useMemo<HoldingInfo[]>(() => {
    const grouped = new Map<string, StockTransaction[]>();
    for (const tx of scopedTransactions) {
      const market = normalizeMarket(tx.market);
      const code = canonicalStockCode(tx.stockCode);
      if (!code) continue;
      const key = stockCacheKey(market, code);
      const bucket = grouped.get(key) ?? [];
      bucket.push(tx);
      grouped.set(key, bucket);
    }

    const taxRates = {
      normalListedStock: settings.taxRateNormalListedStock,
      domesticStockEtf: settings.taxRateDomesticStockEtf,
      bondEtf: settings.taxRateBondEtf,
      dayTrading: settings.taxRateDayTrading,
    };

    const nowMillis = Date.now();
    const list: HoldingInfo[] = [];

    for (const [key, txs] of grouped.entries()) {
      const first = txs[0];
      const market = normalizeMarket(first.market);
      const code = canonicalStockCode(first.stockCode);
      const stock: Stock = stockMap.get(key) ?? {
        market,
        code,
        name: code,
        exchange: StockExchange.UNKNOWN,
        industry: "",
        stockType: "",
      };
      const quote = quotes[key];

      const info = calcCacheRef.current.getOrCompute(
        {
          stock,
          transactions: txs,
          currentPrice: quote?.currentPrice ?? 0,
          dailyChange: quote?.change ?? 0,
          dailyChangePercentage: quote?.changePercent ?? 0,
          limitState: quote?.limitState ?? "NONE",
          preDeductSellFees: settings.preDeductSellFees,
          feeSettingsByAccount,
          sharedFeeSettings,
          returnRateMode: settings.returnRateMode,
          currentDateMillis: nowMillis,
          marginDayCount: settings.marginDayCount,
          includeProfitLossBreakdown: settings.partialSalesAsRealized,
          excludeDividendIncomeFromReturns:
            settings.excludeDividendIncomeFromReturns,
        },
        (inp) => calculateHoldingInfo(inp, taxRates),
      );
      list.push(info);
    }

    return list;
  }, [
    scopedTransactions,
    stockMap,
    quotes,
    settings,
    feeSettingsByAccount,
    sharedFeeSettings,
  ]);

  const unrealizedHoldings = useMemo(
    () =>
      sortHoldings(
        holdings.filter((h) => !h.isRealizedSlice),
        {
          sortMode: settings.homeHoldingsSortMode,
          sortColumn: settings.homeHoldingsSortColumn,
          ascending: settings.homeHoldingsSortAscending,
          manualOrder: holdingsOrder.order,
          displayMode: settings.homeDisplayMode,
          usdToTwdRate: effectiveUsdToTwdRate,
        },
      ),
    [
      holdings,
      settings.homeHoldingsSortMode,
      settings.homeHoldingsSortColumn,
      settings.homeHoldingsSortAscending,
      settings.homeDisplayMode,
      effectiveUsdToTwdRate,
      holdingsOrder.order,
    ],
  );

  const realizedHoldings = useMemo(
    () =>
      sortHoldings(
        holdings.filter((h) => h.isRealizedSlice),
        {
          sortMode: settings.homeHoldingsSortMode,
          sortColumn: settings.homeHoldingsSortColumn,
          ascending: settings.homeHoldingsSortAscending,
          manualOrder: holdingsOrder.realizedOrder,
          displayMode: settings.homeDisplayMode,
          usdToTwdRate: effectiveUsdToTwdRate,
        },
      ),
    [
      holdings,
      settings.homeHoldingsSortMode,
      settings.homeHoldingsSortColumn,
      settings.homeHoldingsSortAscending,
      settings.homeDisplayMode,
      effectiveUsdToTwdRate,
      holdingsOrder.realizedOrder,
    ],
  );

  const holdingsUiState = useMemo(
    () =>
      aggregateHoldingsUiState(
        holdings,
        settings.homeDisplayMode,
        effectiveUsdToTwdRate,
      ),
    [holdings, settings.homeDisplayMode, effectiveUsdToTwdRate],
  );

  const assetOverviewUiState = useMemo(
    () =>
      buildAssetOverviewUiState({
        taiwanStockValue: holdingsUiState.taiwanMarketValue,
        usStockValue: holdingsUiState.usMarketValue * effectiveUsdToTwdRate,
        stockValues: holdingsUiState.assetStockValues,
        bankDeposits: assetBalances.bankDeposits,
        loans: assetBalances.loans,
      }),
    [holdingsUiState, effectiveUsdToTwdRate, assetBalances],
  );

  const transactionsWithStock = useMemo<TransactionWithStock[]>(
    () =>
      transactions.map((tx) => {
        const market = normalizeMarket(tx.market);
        const code = canonicalStockCode(tx.stockCode);
        const stock: Stock = stockMap.get(stockCacheKey(market, code)) ?? {
          market,
          code,
          name: "Unknown",
          exchange: StockExchange.UNKNOWN,
          industry: "",
          stockType: "",
        };
        return { transaction: tx, stock };
      }),
    [transactions, stockMap],
  );

  // ===========================================================================
  // Mutations
  // ===========================================================================

  const addTransactionMutation = useMutation({
    mutationFn: async (
      tx: Omit<StockTransaction, "id"> & { id?: number },
    ) => {
      const candidate: StockTransaction = {
        ...tx,
        id: tx.id && tx.id > 0 ? tx.id : Date.now(),
      };
      const scopeTxs = transactions.filter(
        (existing) =>
          normalizeMarket(existing.market) === normalizeMarket(candidate.market) &&
          canonicalStockCode(existing.stockCode) ===
            canonicalStockCode(candidate.stockCode) &&
          existing.accountId === candidate.accountId,
      );
      const validation = validateTransactionSequence([...scopeTxs, candidate]);
      if (!validation.valid) {
        throw new Error(validation.error ?? "交易驗證失敗");
      }
      return insertTransaction(userId, tx);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: PORTFOLIO_QUERY_KEYS.transactions(userId),
      });
    },
  });

  const editTransactionMutation = useMutation({
    mutationFn: async ({
      original,
      candidate,
    }: {
      original: StockTransaction;
      candidate: StockTransaction;
    }) => {
      const validation = validateEditTransactionScopes(
        transactions,
        original,
        candidate,
      );
      if (!validation.valid) {
        throw new Error(validation.error ?? "交易驗證失敗");
      }
      const updated = await updateTransaction(userId, candidate);
      if (!updated) {
        throw new Error("這筆交易已不存在，無法更新");
      }
      return updated;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: PORTFOLIO_QUERY_KEYS.transactions(userId),
      });
    },
  });

  const removeTransactionMutation = useMutation({
    mutationFn: async (tx: StockTransaction) => {
      if (!canDeleteTransaction(tx, transactions)) {
        throw new Error("此開倉交易已被還款、還券或補償引用，無法刪除");
      }
      await deleteTransaction(userId, tx.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: PORTFOLIO_QUERY_KEYS.transactions(userId),
      });
    },
  });

  const importTransactionsMutation = useMutation({
    mutationFn: async ({
      imported,
      mode,
    }: {
      imported: Array<Omit<StockTransaction, "id"> & { id?: number }>;
      mode: "replace" | "append";
    }) => {
      const result =
        mode === "replace"
          ? await replaceAllTransactions(userId, imported)
          : await insertTransactionsBatch(userId, imported);

      const importedTargets: MarketQuoteTarget[] = [];
      const seen = new Set<string>();
      for (const tx of result) {
        const market = normalizeMarket(tx.market);
        const code = canonicalStockCode(tx.stockCode);
        const key = stockCacheKey(market, code);
        if (seen.has(key)) continue;
        seen.add(key);
        const stock = stockMap.get(key);
        importedTargets.push({
          market,
          code,
          exchange: stock?.exchange ?? StockExchange.UNKNOWN,
          stockType: stock?.stockType ?? "",
        });
      }
      if (importedTargets.length > 0) {
        await fetchLatestQuotes(importedTargets).catch(() => undefined);
      }
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: PORTFOLIO_QUERY_KEYS.transactions(userId),
      });
    },
  });

  const saveAccountMutation = useMutation({
    mutationFn: (account: Account) => upsertAccount(userId, account),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: PORTFOLIO_QUERY_KEYS.accounts(userId),
      });
    },
  });

  const removeAccountMutation = useMutation({
    mutationFn: (accountId: number) => deleteAccount(userId, accountId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: PORTFOLIO_QUERY_KEYS.accounts(userId),
      });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (partial: Partial<UserSettings>) => {
      const next: UserSettings = { ...settings, ...partial };
      return upsertUserSettings(userId, next);
    },
    onSuccess: (next) => {
      queryClient.setQueryData(PORTFOLIO_QUERY_KEYS.settings(userId), next);
    },
  });

  const updateHoldingsOrderMutation = useMutation({
    mutationFn: (nextOrder: HoldingsOrderData) =>
      upsertHoldingsOrder(userId, nextOrder),
    onSuccess: (next) => {
      queryClient.setQueryData(
        PORTFOLIO_QUERY_KEYS.holdingsOrder(userId),
        next,
      );
    },
  });

  const saveBankDepositMutation = useMutation({
    mutationFn: (deposit: BankDeposit) => upsertBankDeposit(userId, deposit),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: PORTFOLIO_QUERY_KEYS.assetBalances(userId),
      });
    },
  });

  const removeBankDepositMutation = useMutation({
    mutationFn: (id: number) => deleteBankDeposit(userId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: PORTFOLIO_QUERY_KEYS.assetBalances(userId),
      });
    },
  });

  const saveLoanMutation = useMutation({
    mutationFn: (loan: Loan) => upsertLoan(userId, loan),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: PORTFOLIO_QUERY_KEYS.assetBalances(userId),
      });
    },
  });

  const removeLoanMutation = useMutation({
    mutationFn: (id: number) => deleteLoan(userId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: PORTFOLIO_QUERY_KEYS.assetBalances(userId),
      });
    },
  });

  const replaceAssetBalancesMutation = useMutation({
    mutationFn: (balances: AssetBalances) =>
      replaceAssetBalances(userId, balances),
    onSuccess: (next) => {
      queryClient.setQueryData(
        PORTFOLIO_QUERY_KEYS.assetBalances(userId),
        next,
      );
    },
  });

  const clearTransactionsMutation = useMutation({
    mutationFn: () => deleteAllTransactions(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: PORTFOLIO_QUERY_KEYS.transactions(userId),
      });
    },
  });

  const clearAllUserDataMutation = useMutation({
    mutationFn: () => deleteAllUserData(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });

  const refreshQuotes = useCallback(async () => {
    if (pollingRef.current) {
      await pollingRef.current.triggerManualRefresh();
    } else {
      await fetchLatestQuotes();
    }
    if (settings.showTaiwanWeightedIndex) {
      await queryClient.invalidateQueries({
        queryKey: PORTFOLIO_QUERY_KEYS.taiwanIndex(),
      });
    }
  }, [fetchLatestQuotes, settings.showTaiwanWeightedIndex, queryClient]);

  const syncStockList = useCallback(
    async (market: StockMarket) => {
      const res = await invokeStockListSync(market);
      await queryClient.invalidateQueries({
        queryKey: PORTFOLIO_QUERY_KEYS.stocks(),
      });
      return res;
    },
    [queryClient],
  );

  const isLoading =
    accountsQuery.isLoading ||
    transactionsQuery.isLoading ||
    assetBalancesQuery.isLoading ||
    settingsQuery.isLoading ||
    holdingsOrderQuery.isLoading;

  return {
    userId,
    isLoading,
    noticeMessage,
    clearNoticeMessage: () => setNoticeMessage(null),
    accounts,
    activeAccountId,
    transactions,
    scopedTransactions,
    transactionsWithStock,
    assetBalances,
    settings,
    holdingsOrder,
    stocks,
    stockMap,
    quotes,
    taiwanIndex: taiwanIndexQuery.data ?? null,
    exchangeRate: exchangeRateQuery.data ?? null,
    effectiveUsdToTwdRate,
    holidayCalendar: holidayCalendarQuery.data ?? null,
    holdings,
    unrealizedHoldings,
    realizedHoldings,
    holdingsUiState,
    assetOverviewUiState,
    refreshQuotes,
    syncStockList,
    addTransaction: addTransactionMutation.mutateAsync,
    editTransaction: editTransactionMutation.mutateAsync,
    removeTransaction: removeTransactionMutation.mutateAsync,
    importTransactions: importTransactionsMutation.mutateAsync,
    saveAccount: saveAccountMutation.mutateAsync,
    removeAccount: removeAccountMutation.mutateAsync,
    updateSettings: updateSettingsMutation.mutateAsync,
    updateHoldingsOrder: updateHoldingsOrderMutation.mutateAsync,
    saveBankDeposit: saveBankDepositMutation.mutateAsync,
    removeBankDeposit: removeBankDepositMutation.mutateAsync,
    saveLoan: saveLoanMutation.mutateAsync,
    removeLoan: removeLoanMutation.mutateAsync,
    replaceAssetBalances: replaceAssetBalancesMutation.mutateAsync,
    clearAllTransactions: clearTransactionsMutation.mutateAsync,
    clearAllUserData: clearAllUserDataMutation.mutateAsync,
  };
}
