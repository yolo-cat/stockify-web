import { beforeEach, describe, expect, it } from "vitest";
import {
  bootstrapDefaultAccountIfEmpty,
  deleteAllTransactions,
  deleteAllUserData,
  DEMO_USER_ID,
  fetchAccounts,
  fetchAssetBalances,
  fetchTransactions,
  fetchUserSettings,
  insertTransaction,
  mapAccountFromRow,
  mapAccountToInsert,
  mapTransactionFromRow,
  mapTransactionToInsert,
  mapUserSettingsFromRow,
  mapUserSettingsToInsert,
  replaceAssetBalances,
  resetDemoState,
  updateTransaction,
  upsertAccount,
} from "@/services";
import {
  DEFAULT_USER_SETTINGS,
  StockMarket,
  TransactionType,
} from "@/types";

describe("supabasePortfolioService", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetDemoState();
  });

  it("maps account snake_case <-> camelCase accurately", () => {
    const row = {
      user_id: "u1",
      id: 2,
      name: "複委託",
      fee_discount: 0.5,
      min_fee_regular: 20,
      min_fee_odd_lot: 10,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
    };
    const account = mapAccountFromRow(row);
    expect(account).toEqual({
      id: 2,
      name: "複委託",
      feeDiscount: 0.5,
      minFeeRegular: 20,
      minFeeOddLot: 10,
    });
    expect(mapAccountToInsert("u1", account)).toEqual({
      user_id: "u1",
      id: 2,
      name: "複委託",
      fee_discount: 0.5,
      min_fee_regular: 20,
      min_fee_odd_lot: 10,
    });
  });

  it("maps transaction and user_settings snake_case <-> camelCase accurately", () => {
    const txInsert = mapTransactionToInsert("u1", {
      id: 10,
      stockCode: "2330",
      market: StockMarket.TW,
      accountId: 1,
      date: 1700000000000,
      recordTime: 1700000001000,
      type: TransactionType.BUY,
      buyPrice: 900,
      buyShares: 1000,
      sellPrice: 0,
      sellShares: 0,
      fee: 358,
      tax: 0,
      income: 0,
      expense: 900358,
      cashDividend: 0,
      exDividendShares: 0,
      dividendIncome: 0,
      supplementaryHealthInsurancePremium: 0,
      stockDividend: 0,
      dividendShares: 0,
      exRightsShares: 0,
      note: "test",
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
    });

    const roundTripped = mapTransactionFromRow({
      ...txInsert,
      id: 10,
      market: "TW",
      account_id: 1,
      buy_price: 900,
      buy_shares: 1000,
      sell_price: 0,
      sell_shares: 0,
      fee: 358,
      tax: 0,
      income: 0,
      expense: 900358,
      cash_dividend: 0,
      ex_dividend_shares: 0,
      dividend_income: 0,
      supplementary_nhi_fee: 0,
      stock_dividend: 0,
      dividend_shares: 0,
      ex_rights_shares: 0,
      note: "test",
      capital_reduction_ratio: 0,
      shares_before_reduction: 0,
      shares_after_reduction: 0,
      cash_returned: 0,
      stock_split_ratio: 0,
      shares_before_split: 0,
      shares_after_split: 0,
      margin_principal: 0,
      margin_annual_rate: 0,
      margin_lot_id: "",
      margin_repayment_lot_id: "",
      margin_repayment: 0,
      margin_self_funded: 0,
      margin_self_funded_overridden: false,
      margin_actual_interest: 0,
      short_borrow_principal: 0,
      short_borrow_annual_rate: 0,
      short_lot_id: "",
      short_cover_lot_id: "",
      short_cover_shares: 0,
      short_compensation_lot_id: "",
      short_compensation: 0,
      created_at: "",
      updated_at: "",
    });
    expect(roundTripped.stockCode).toBe("2330");
    expect(roundTripped.buyPrice).toBe(900);

    const settingsInsert = mapUserSettingsToInsert("u1", DEFAULT_USER_SETTINGS);
    const settingsOut = mapUserSettingsFromRow({
      ...(settingsInsert as Required<typeof settingsInsert>),
      last_update_highlights_version: null,
      dividend_info_cache: {},
      created_at: "",
      updated_at: "",
    });
    expect(settingsOut.feeDiscount).toBe(DEFAULT_USER_SETTINGS.feeDiscount);
    expect(settingsOut.marginDayCount).toBe(365);
  });

  it("rejects empty userId on user-owned queries", async () => {
    await expect(fetchAccounts("")).rejects.toThrow(/Authenticated user_id/);
  });

  it("supports demo CRUD, atomic asset balance replacement, and deletion semantics", async () => {
    const initialAccounts = await fetchAccounts(DEMO_USER_ID);
    expect(initialAccounts.length).toBe(2);

    await upsertAccount(DEMO_USER_ID, {
      id: 3,
      name: "新帳戶",
      feeDiscount: 0.6,
      minFeeRegular: 1,
      minFeeOddLot: 1,
    });
    expect((await fetchAccounts(DEMO_USER_ID)).length).toBe(3);

    const createdTx = await insertTransaction(DEMO_USER_ID, {
      stockCode: "2330",
      market: StockMarket.TW,
      accountId: 1,
      date: Date.UTC(2025, 4, 1),
      recordTime: Date.UTC(2025, 4, 1) + 100,
      type: TransactionType.BUY,
      buyPrice: 1000,
      buyShares: 100,
      sellPrice: 0,
      sellShares: 0,
      fee: 40,
      tax: 0,
      income: 0,
      expense: 100040,
      cashDividend: 0,
      exDividendShares: 0,
      dividendIncome: 0,
      supplementaryHealthInsurancePremium: 0,
      stockDividend: 0,
      dividendShares: 0,
      exRightsShares: 0,
      note: "demo insert",
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
    });
    expect(createdTx.id).toBeGreaterThan(0);

    const updated = await updateTransaction(DEMO_USER_ID, {
      ...createdTx,
      note: "updated note",
    });
    expect(updated?.note).toBe("updated note");

    await replaceAssetBalances(DEMO_USER_ID, {
      bankDeposits: [{ id: 1, name: "新存款", amount: 123456 }],
      loans: [],
    });
    const balances = await fetchAssetBalances(DEMO_USER_ID);
    expect(balances.bankDeposits).toHaveLength(1);
    expect(balances.loans).toHaveLength(0);

    // deleteAllTransactions preserves accounts
    await deleteAllTransactions(DEMO_USER_ID);
    expect((await fetchTransactions(DEMO_USER_ID)).length).toBe(0);
    expect((await fetchAccounts(DEMO_USER_ID)).length).toBe(3);

    // deleteAllUserData clears accounts & transactions and resets activeAccountId=0
    await deleteAllUserData(DEMO_USER_ID);
    expect((await fetchAccounts(DEMO_USER_ID)).length).toBe(0);
    expect((await fetchUserSettings(DEMO_USER_ID)).activeAccountId).toBe(0);

    // bootstrapDefaultAccountIfEmpty restores 預設帳戶
    const bootstrapped = await bootstrapDefaultAccountIfEmpty(DEMO_USER_ID);
    expect(bootstrapped).toHaveLength(1);
    expect(bootstrapped[0].name).toBe("預設帳戶");
  });
});
