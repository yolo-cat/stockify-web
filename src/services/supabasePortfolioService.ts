import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  CalculationRoundingMode,
  DEFAULT_USER_SETTINGS,
  HomeDisplayMode,
  HomeHoldingsSortMode,
  ReturnRateMode,
  StockDataSource,
  StockExchange,
  StockMarket,
  TextSizeMode,
  ThemeMode,
  TransactionType,
  UsStockDataSource,
  type Account,
  type AssetBalances,
  type BankDeposit,
  type HoldingsOrderData,
  type Loan,
  type Stock,
  type StockTransaction,
  type UserSettings,
} from "@/types";
import type { DividendInfoCacheEntry, StockHistoryPrice } from "@/types/market";
import {
  DEMO_USER_ID,
  loadDemoState,
  saveDemoState,
  updateDemoAssetBalances,
} from "./localDemoStore";

type AccountRow = Database["public"]["Tables"]["accounts"]["Row"];
type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];
type BankDepositRow = Database["public"]["Tables"]["bank_deposits"]["Row"];
type LoanRow = Database["public"]["Tables"]["loans"]["Row"];
type UserSettingsRow = Database["public"]["Tables"]["user_settings"]["Row"];
type HoldingsOrderRow = Database["public"]["Tables"]["holdings_order"]["Row"];
type StockRow = Database["public"]["Tables"]["stocks"]["Row"];
type StockHistoryRow = Database["public"]["Tables"]["stock_history_prices"]["Row"];

function requireUserId(userId: string | null | undefined): string {
  const trimmed = userId?.trim();
  if (!trimmed) {
    throw new Error("Authenticated user_id is required.");
  }
  return trimmed;
}

function isDemoModeActive(userId: string): boolean {
  return !isSupabaseConfigured && userId === DEMO_USER_ID;
}

export function mapAccountFromRow(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    feeDiscount: row.fee_discount,
    minFeeRegular: row.min_fee_regular,
    minFeeOddLot: row.min_fee_odd_lot,
  };
}

export function mapAccountToInsert(
  userId: string,
  account: Account,
): Database["public"]["Tables"]["accounts"]["Insert"] {
  return {
    user_id: userId,
    id: account.id,
    name: account.name,
    fee_discount: account.feeDiscount,
    min_fee_regular: account.minFeeRegular,
    min_fee_odd_lot: account.minFeeOddLot,
  };
}

export function mapTransactionFromRow(row: TransactionRow): StockTransaction {
  return {
    id: row.id,
    stockCode: row.stock_code,
    market: row.market === StockMarket.US ? StockMarket.US : StockMarket.TW,
    accountId: row.account_id,
    date: row.date,
    recordTime: row.record_time,
    type: row.type as TransactionType,
    buyPrice: row.buy_price,
    buyShares: row.buy_shares,
    sellPrice: row.sell_price,
    sellShares: row.sell_shares,
    fee: row.fee,
    tax: row.tax,
    income: row.income,
    expense: row.expense,
    cashDividend: row.cash_dividend,
    exDividendShares: row.ex_dividend_shares,
    dividendIncome: row.dividend_income,
    supplementaryHealthInsurancePremium: row.supplementary_nhi_fee,
    stockDividend: row.stock_dividend,
    dividendShares: row.dividend_shares,
    exRightsShares: row.ex_rights_shares,
    note: row.note,
    capitalReductionRatio: row.capital_reduction_ratio,
    sharesBeforeReduction: row.shares_before_reduction,
    sharesAfterReduction: row.shares_after_reduction,
    cashReturned: row.cash_returned,
    stockSplitRatio: row.stock_split_ratio,
    sharesBeforeSplit: row.shares_before_split,
    sharesAfterSplit: row.shares_after_split,
    marginPrincipal: row.margin_principal,
    marginAnnualRate: row.margin_annual_rate,
    marginLotId: row.margin_lot_id,
    marginRepaymentLotId: row.margin_repayment_lot_id,
    marginRepayment: row.margin_repayment,
    marginSelfFunded: row.margin_self_funded,
    marginSelfFundedOverridden: row.margin_self_funded_overridden,
    marginActualInterest: row.margin_actual_interest,
    shortBorrowPrincipal: row.short_borrow_principal,
    shortBorrowAnnualRate: row.short_borrow_annual_rate,
    shortLotId: row.short_lot_id,
    shortCoverLotId: row.short_cover_lot_id,
    shortCoverShares: row.short_cover_shares,
    shortCompensationLotId: row.short_compensation_lot_id,
    shortCompensation: row.short_compensation,
  };
}

export function mapTransactionToInsert(
  userId: string,
  tx: Omit<StockTransaction, "id"> & { id?: number },
): Database["public"]["Tables"]["transactions"]["Insert"] {
  return {
    ...(tx.id && tx.id > 0 ? { id: tx.id } : {}),
    user_id: userId,
    stock_code: tx.stockCode,
    market: tx.market,
    account_id: tx.accountId,
    date: tx.date,
    record_time: tx.recordTime,
    type: tx.type,
    buy_price: tx.buyPrice,
    buy_shares: tx.buyShares,
    sell_price: tx.sellPrice,
    sell_shares: tx.sellShares,
    fee: tx.fee,
    tax: tx.tax,
    income: tx.income,
    expense: tx.expense,
    cash_dividend: tx.cashDividend,
    ex_dividend_shares: tx.exDividendShares,
    dividend_income: tx.dividendIncome,
    supplementary_nhi_fee: tx.supplementaryHealthInsurancePremium,
    stock_dividend: tx.stockDividend,
    dividend_shares: tx.dividendShares,
    ex_rights_shares: tx.exRightsShares,
    note: tx.note,
    capital_reduction_ratio: tx.capitalReductionRatio,
    shares_before_reduction: tx.sharesBeforeReduction,
    shares_after_reduction: tx.sharesAfterReduction,
    cash_returned: tx.cashReturned,
    stock_split_ratio: tx.stockSplitRatio,
    shares_before_split: tx.sharesBeforeSplit,
    shares_after_split: tx.sharesAfterSplit,
    margin_principal: tx.marginPrincipal,
    margin_annual_rate: tx.marginAnnualRate,
    margin_lot_id: tx.marginLotId,
    margin_repayment_lot_id: tx.marginRepaymentLotId,
    margin_repayment: tx.marginRepayment,
    margin_self_funded: tx.marginSelfFunded,
    margin_self_funded_overridden: tx.marginSelfFundedOverridden,
    margin_actual_interest: tx.marginActualInterest,
    short_borrow_principal: tx.shortBorrowPrincipal,
    short_borrow_annual_rate: tx.shortBorrowAnnualRate,
    short_lot_id: tx.shortLotId,
    short_cover_lot_id: tx.shortCoverLotId,
    short_cover_shares: tx.shortCoverShares,
    short_compensation_lot_id: tx.shortCompensationLotId,
    short_compensation: tx.shortCompensation,
  };
}

export function mapUserSettingsFromRow(row: UserSettingsRow): UserSettings {
  return {
    refreshInterval: row.refresh_interval,
    feeDiscount: row.fee_discount,
    minFeeRegular: row.min_fee_regular,
    minFeeOddLot: row.min_fee_odd_lot,
    dividendFee: row.dividend_fee,
    preDeductSellFees: row.pre_deduct_sell_fees,
    partialSalesAsRealized: row.partial_sales_as_realized,
    excludeDividendIncomeFromReturns: row.exclude_dividend_income_from_returns,
    returnRateMode: row.return_rate_mode as ReturnRateMode,
    calculationRoundingMode:
      row.calculation_rounding_mode as CalculationRoundingMode,
    theme: row.theme as ThemeMode,
    textSizeMode: row.text_size_mode as TextSizeMode,
    stockDataSource: row.stock_data_source as StockDataSource,
    usStockDataSource: row.us_stock_data_source as UsStockDataSource,
    notifyFallbackRepeatedly: row.notify_fallback_repeatedly,
    taxRateNormalListedStock: row.tax_rate_normal_listed_stock,
    taxRateDomesticStockEtf: row.tax_rate_domestic_stock_etf,
    taxRateBondEtf: row.tax_rate_bond_etf,
    taxRateDayTrading: row.tax_rate_day_trading,
    usdToTwdRate: row.usd_to_twd_rate,
    homeDisplayMode: row.home_display_mode as HomeDisplayMode,
    homeHoldingsSortMode: row.home_holdings_sort_mode as HomeHoldingsSortMode,
    homeHoldingsSortColumn: row.home_holdings_sort_column,
    homeHoldingsSortAscending: row.home_holdings_sort_ascending,
    activeAccountId: row.active_account_id,
    showTaiwanWeightedIndex: row.show_taiwan_weighted_index,
    showTaiwanPortfolioChart: row.show_taiwan_portfolio_chart,
    homeHistoryChartExpanded: row.home_history_chart_expanded,
    detailHistoryChartExpanded: row.detail_history_chart_expanded,
    marginFeatureEnabled: row.margin_feature_enabled,
    marginDayCount: row.margin_day_count === 360 ? 360 : 365,
    defaultMarginAnnualRate: row.default_margin_annual_rate,
    defaultShortBorrowAnnualRate: row.default_short_borrow_annual_rate,
    lastUpdateHighlightsVersion: row.last_update_highlights_version,
    dividendInfoCache:
      (row.dividend_info_cache as unknown as Record<
        string,
        DividendInfoCacheEntry
      >) ?? {},
  };
}

export function mapUserSettingsToInsert(
  userId: string,
  settings: UserSettings,
): Database["public"]["Tables"]["user_settings"]["Insert"] {
  return {
    user_id: userId,
    refresh_interval: settings.refreshInterval,
    fee_discount: settings.feeDiscount,
    min_fee_regular: settings.minFeeRegular,
    min_fee_odd_lot: settings.minFeeOddLot,
    dividend_fee: settings.dividendFee,
    pre_deduct_sell_fees: settings.preDeductSellFees,
    partial_sales_as_realized: settings.partialSalesAsRealized,
    exclude_dividend_income_from_returns:
      settings.excludeDividendIncomeFromReturns,
    return_rate_mode: settings.returnRateMode,
    calculation_rounding_mode: settings.calculationRoundingMode,
    theme: settings.theme,
    text_size_mode: settings.textSizeMode,
    stock_data_source: settings.stockDataSource,
    us_stock_data_source: settings.usStockDataSource,
    notify_fallback_repeatedly: settings.notifyFallbackRepeatedly,
    tax_rate_normal_listed_stock: settings.taxRateNormalListedStock,
    tax_rate_domestic_stock_etf: settings.taxRateDomesticStockEtf,
    tax_rate_bond_etf: settings.taxRateBondEtf,
    tax_rate_day_trading: settings.taxRateDayTrading,
    usd_to_twd_rate: settings.usdToTwdRate,
    home_display_mode: settings.homeDisplayMode,
    home_holdings_sort_mode: settings.homeHoldingsSortMode,
    home_holdings_sort_column: settings.homeHoldingsSortColumn,
    home_holdings_sort_ascending: settings.homeHoldingsSortAscending,
    active_account_id: settings.activeAccountId,
    show_taiwan_weighted_index: settings.showTaiwanWeightedIndex,
    show_taiwan_portfolio_chart: settings.showTaiwanPortfolioChart,
    home_history_chart_expanded: settings.homeHistoryChartExpanded,
    detail_history_chart_expanded: settings.detailHistoryChartExpanded,
    margin_feature_enabled: settings.marginFeatureEnabled,
    margin_day_count: settings.marginDayCount,
    default_margin_annual_rate: settings.defaultMarginAnnualRate,
    default_short_borrow_annual_rate: settings.defaultShortBorrowAnnualRate,
    last_update_highlights_version: settings.lastUpdateHighlightsVersion,
    dividend_info_cache:
      settings.dividendInfoCache as unknown as Database["public"]["Tables"]["user_settings"]["Insert"]["dividend_info_cache"],
  };
}

export function mapStockFromRow(row: StockRow): Stock {
  return {
    market: row.market === StockMarket.US ? StockMarket.US : StockMarket.TW,
    code: row.code,
    name: row.name,
    exchange: (row.exchange as StockExchange) ?? StockExchange.UNKNOWN,
    industry: row.industry,
    stockType: row.stock_type,
  };
}

export function mapStockHistoryFromRow(row: StockHistoryRow): StockHistoryPrice {
  return {
    market: row.market === StockMarket.US ? StockMarket.US : StockMarket.TW,
    stockCode: row.stock_code,
    date: row.date,
    price: row.price,
  };
}

// =============================================================================
// Accounts
// =============================================================================

export async function fetchAccounts(userId: string): Promise<Account[]> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    return loadDemoState().accounts;
  }

  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("user_id", uid)
    .order("id", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapAccountFromRow);
}

export async function bootstrapDefaultAccountIfEmpty(
  userId: string,
): Promise<Account[]> {
  const uid = requireUserId(userId);
  const existing = await fetchAccounts(uid);
  if (existing.length > 0) return existing;

  const defaultAccount: Account = {
    id: 1,
    name: "預設帳戶",
    feeDiscount: null,
    minFeeRegular: null,
    minFeeOddLot: null,
  };

  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    state.accounts = [defaultAccount];
    saveDemoState(state);
    return state.accounts;
  }

  const { data, error } = await supabase
    .from("accounts")
    .upsert(mapAccountToInsert(uid, defaultAccount), {
      onConflict: "user_id,id",
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return [mapAccountFromRow(data)];
}

export async function upsertAccount(
  userId: string,
  account: Account,
): Promise<Account> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    const idx = state.accounts.findIndex((a) => a.id === account.id);
    if (idx >= 0) {
      state.accounts[idx] = account;
    } else {
      state.accounts.push(account);
      state.accounts.sort((a, b) => a.id - b.id);
    }
    saveDemoState(state);
    return account;
  }

  const { data, error } = await supabase
    .from("accounts")
    .upsert(mapAccountToInsert(uid, account), {
      onConflict: "user_id,id",
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapAccountFromRow(data);
}

export async function deleteAccount(
  userId: string,
  accountId: number,
): Promise<void> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    state.accounts = state.accounts.filter((a) => a.id !== accountId);
    saveDemoState(state);
    return;
  }

  const { error } = await supabase
    .from("accounts")
    .delete()
    .eq("user_id", uid)
    .eq("id", accountId);

  if (error) throw new Error(error.message);
}

// =============================================================================
// Transactions
// =============================================================================

export async function fetchTransactions(
  userId: string,
): Promise<StockTransaction[]> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    return loadDemoState().transactions;
  }

  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", uid)
    .order("date", { ascending: true })
    .order("record_time", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapTransactionFromRow);
}

export async function insertTransaction(
  userId: string,
  tx: Omit<StockTransaction, "id"> & { id?: number },
): Promise<StockTransaction> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    const nextId =
      tx.id && tx.id > 0
        ? tx.id
        : state.transactions.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    const created: StockTransaction = { ...tx, id: nextId };
    state.transactions.push(created);
    saveDemoState(state);
    return created;
  }

  const { data, error } = await supabase
    .from("transactions")
    .insert(mapTransactionToInsert(uid, tx))
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapTransactionFromRow(data);
}

export async function updateTransaction(
  userId: string,
  tx: StockTransaction,
): Promise<StockTransaction | null> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    const idx = state.transactions.findIndex((t) => t.id === tx.id);
    if (idx < 0) return null;
    state.transactions[idx] = tx;
    saveDemoState(state);
    return tx;
  }

  const payload = mapTransactionToInsert(uid, tx);
  const { data, error } = await supabase
    .from("transactions")
    .update(payload)
    .eq("user_id", uid)
    .eq("id", tx.id)
    .select("*");

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return null;
  return mapTransactionFromRow(data[0]);
}

export async function deleteTransaction(
  userId: string,
  transactionId: number,
): Promise<void> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    state.transactions = state.transactions.filter((t) => t.id !== transactionId);
    saveDemoState(state);
    return;
  }

  const { error } = await supabase
    .from("transactions")
    .delete()
    .eq("user_id", uid)
    .eq("id", transactionId);

  if (error) throw new Error(error.message);
}

export async function replaceAllTransactions(
  userId: string,
  transactions: Array<Omit<StockTransaction, "id"> & { id?: number }>,
): Promise<StockTransaction[]> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    let nextId = 1;
    state.transactions = transactions.map((t) => ({
      ...t,
      id: t.id && t.id > 0 ? t.id : nextId++,
    }));
    saveDemoState(state);
    return state.transactions;
  }

  const { error: delErr } = await supabase
    .from("transactions")
    .delete()
    .eq("user_id", uid);
  if (delErr) throw new Error(delErr.message);

  if (transactions.length === 0) return [];

  const rows = transactions.map((t) => mapTransactionToInsert(uid, t));
  const { data, error } = await supabase
    .from("transactions")
    .insert(rows)
    .select("*");

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapTransactionFromRow);
}

export async function insertTransactionsBatch(
  userId: string,
  transactions: Array<Omit<StockTransaction, "id"> & { id?: number }>,
): Promise<StockTransaction[]> {
  const uid = requireUserId(userId);
  if (transactions.length === 0) return [];

  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    let nextId =
      state.transactions.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    const inserted = transactions.map((t) => ({
      ...t,
      id: t.id && t.id > 0 ? t.id : nextId++,
    }));
    state.transactions.push(...inserted);
    saveDemoState(state);
    return inserted;
  }

  const rows = transactions.map((t) => mapTransactionToInsert(uid, t));
  const { data, error } = await supabase
    .from("transactions")
    .insert(rows)
    .select("*");

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapTransactionFromRow);
}

// =============================================================================
// Bank Deposits & Loans
// =============================================================================

export async function fetchAssetBalances(
  userId: string,
): Promise<AssetBalances> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    return {
      bankDeposits: state.bankDeposits,
      loans: state.loans,
    };
  }

  const [depositsRes, loansRes] = await Promise.all([
    supabase
      .from("bank_deposits")
      .select("*")
      .eq("user_id", uid)
      .order("id", { ascending: true }),
    supabase
      .from("loans")
      .select("*")
      .eq("user_id", uid)
      .order("id", { ascending: true }),
  ]);

  if (depositsRes.error) throw new Error(depositsRes.error.message);
  if (loansRes.error) throw new Error(loansRes.error.message);

  return {
    bankDeposits: (depositsRes.data ?? []).map((r: BankDepositRow) => ({
      id: r.id,
      name: r.name,
      amount: r.amount,
    })),
    loans: (loansRes.data ?? []).map((r: LoanRow) => ({
      id: r.id,
      name: r.name,
      amount: r.amount,
    })),
  };
}

export async function upsertBankDeposit(
  userId: string,
  deposit: BankDeposit,
): Promise<BankDeposit> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    const idx = state.bankDeposits.findIndex((d) => d.id === deposit.id);
    if (idx >= 0) state.bankDeposits[idx] = deposit;
    else state.bankDeposits.push(deposit);
    saveDemoState(state);
    return deposit;
  }

  const { data, error } = await supabase
    .from("bank_deposits")
    .upsert(
      {
        user_id: uid,
        id: deposit.id,
        name: deposit.name,
        amount: deposit.amount,
      },
      { onConflict: "user_id,id" },
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return { id: data.id, name: data.name, amount: data.amount };
}

export async function deleteBankDeposit(
  userId: string,
  id: number,
): Promise<void> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    state.bankDeposits = state.bankDeposits.filter((d) => d.id !== id);
    saveDemoState(state);
    return;
  }

  const { error } = await supabase
    .from("bank_deposits")
    .delete()
    .eq("user_id", uid)
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function upsertLoan(userId: string, loan: Loan): Promise<Loan> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    const idx = state.loans.findIndex((l) => l.id === loan.id);
    if (idx >= 0) state.loans[idx] = loan;
    else state.loans.push(loan);
    saveDemoState(state);
    return loan;
  }

  const { data, error } = await supabase
    .from("loans")
    .upsert(
      {
        user_id: uid,
        id: loan.id,
        name: loan.name,
        amount: loan.amount,
      },
      { onConflict: "user_id,id" },
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return { id: data.id, name: data.name, amount: data.amount };
}

export async function deleteLoan(userId: string, id: number): Promise<void> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    state.loans = state.loans.filter((l) => l.id !== id);
    saveDemoState(state);
    return;
  }

  const { error } = await supabase
    .from("loans")
    .delete()
    .eq("user_id", uid)
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function replaceAssetBalances(
  userId: string,
  balances: AssetBalances,
): Promise<AssetBalances> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    return updateDemoAssetBalances(balances);
  }

  const previous = await fetchAssetBalances(uid);

  const { error: delDepErr } = await supabase
    .from("bank_deposits")
    .delete()
    .eq("user_id", uid);
  if (delDepErr) throw new Error(delDepErr.message);

  const { error: delLoanErr } = await supabase
    .from("loans")
    .delete()
    .eq("user_id", uid);
  if (delLoanErr) {
    // Attempt rollback of deposits
    if (previous.bankDeposits.length > 0) {
      await supabase.from("bank_deposits").insert(
        previous.bankDeposits.map((d) => ({
          user_id: uid,
          id: d.id,
          name: d.name,
          amount: d.amount,
        })),
      );
    }
    throw new Error(delLoanErr.message);
  }

  if (balances.bankDeposits.length > 0) {
    const { error: insDepErr } = await supabase.from("bank_deposits").insert(
      balances.bankDeposits.map((d) => ({
        user_id: uid,
        id: d.id,
        name: d.name,
        amount: d.amount,
      })),
    );
    if (insDepErr) throw new Error(insDepErr.message);
  }

  if (balances.loans.length > 0) {
    const { error: insLoanErr } = await supabase.from("loans").insert(
      balances.loans.map((l) => ({
        user_id: uid,
        id: l.id,
        name: l.name,
        amount: l.amount,
      })),
    );
    if (insLoanErr) throw new Error(insLoanErr.message);
  }

  return balances;
}

// =============================================================================
// User Settings & Holdings Order
// =============================================================================

export async function fetchUserSettings(userId: string): Promise<UserSettings> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    return loadDemoState().settings;
  }

  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    return upsertUserSettings(uid, DEFAULT_USER_SETTINGS);
  }
  return mapUserSettingsFromRow(data);
}

export async function upsertUserSettings(
  userId: string,
  settings: UserSettings,
): Promise<UserSettings> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    state.settings = settings;
    saveDemoState(state);
    return settings;
  }

  const { data, error } = await supabase
    .from("user_settings")
    .upsert(mapUserSettingsToInsert(uid, settings), {
      onConflict: "user_id",
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapUserSettingsFromRow(data);
}

export async function fetchHoldingsOrder(
  userId: string,
): Promise<HoldingsOrderData> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    return loadDemoState().holdingsOrder;
  }

  const { data, error } = await supabase
    .from("holdings_order")
    .select("*")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    return { order: [], realizedOrder: [] };
  }
  return mapHoldingsOrderFromRow(data);
}

function mapHoldingsOrderFromRow(row: HoldingsOrderRow): HoldingsOrderData {
  return {
    order: Array.isArray(row.unrealized_order)
      ? row.unrealized_order.map(String)
      : [],
    realizedOrder: Array.isArray(row.realized_order)
      ? row.realized_order.map(String)
      : [],
  };
}

export async function upsertHoldingsOrder(
  userId: string,
  holdingsOrder: HoldingsOrderData,
): Promise<HoldingsOrderData> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    state.holdingsOrder = holdingsOrder;
    saveDemoState(state);
    return holdingsOrder;
  }

  const { data, error } = await supabase
    .from("holdings_order")
    .upsert(
      {
        user_id: uid,
        unrealized_order: holdingsOrder.order,
        realized_order: holdingsOrder.realizedOrder,
      },
      { onConflict: "user_id" },
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapHoldingsOrderFromRow(data);
}

// =============================================================================
// Shared Reference: Stocks & Stock History Prices (SELECT only)
// =============================================================================

export async function fetchStocks(): Promise<Stock[]> {
  if (!isSupabaseConfigured) {
    return loadDemoState().stocks;
  }

  const { data, error } = await supabase
    .from("stocks")
    .select("*")
    .order("market", { ascending: true })
    .order("code", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapStockFromRow);
}

export async function fetchStockHistoryPrices(
  market: StockMarket,
  stockCode: string,
  fromDate: string,
  toDate: string,
): Promise<StockHistoryPrice[]> {
  const normalizedCode = stockCode.trim().toUpperCase();
  if (!isSupabaseConfigured) {
    const points = loadDemoState().history[`${market}:${normalizedCode}`] ?? [];
    return points
      .filter((p) => p.date >= fromDate && p.date <= toDate)
      .map((p) => ({
        market,
        stockCode: normalizedCode,
        date: p.date,
        price: p.price,
      }));
  }

  const { data, error } = await supabase
    .from("stock_history_prices")
    .select("*")
    .eq("market", market)
    .eq("stock_code", normalizedCode)
    .gte("date", fromDate)
    .lte("date", toDate)
    .order("date", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapStockHistoryFromRow);
}

// =============================================================================
// Deletion Semantics (Android parity)
// =============================================================================

export async function deleteAllTransactions(userId: string): Promise<void> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    state.transactions = [];
    saveDemoState(state);
    return;
  }

  const { error } = await supabase
    .from("transactions")
    .delete()
    .eq("user_id", uid);

  if (error) throw new Error(error.message);
}

export async function deleteAllUserData(userId: string): Promise<void> {
  const uid = requireUserId(userId);
  if (isDemoModeActive(uid)) {
    const state = loadDemoState();
    state.transactions = [];
    state.accounts = [];
    state.holdingsOrder = { order: [], realizedOrder: [] };
    state.settings = { ...state.settings, activeAccountId: 0 };
    saveDemoState(state);
    return;
  }

  const [txRes, accRes, orderRes] = await Promise.all([
    supabase.from("transactions").delete().eq("user_id", uid),
    supabase.from("accounts").delete().eq("user_id", uid),
    supabase.from("holdings_order").delete().eq("user_id", uid),
  ]);

  if (txRes.error) throw new Error(txRes.error.message);
  if (accRes.error) throw new Error(accRes.error.message);
  if (orderRes.error) throw new Error(orderRes.error.message);

  // Reset activeAccountId to 0 in user_settings while preserving stocks master list
  const { error: settingsErr } = await supabase
    .from("user_settings")
    .update({ active_account_id: 0 })
    .eq("user_id", uid);

  if (settingsErr) throw new Error(settingsErr.message);

  if (typeof window !== "undefined") {
    window.localStorage.removeItem("stockify_quotes_cache_v1");
    window.localStorage.removeItem("stockify_history_cache_v1");
  }
}
