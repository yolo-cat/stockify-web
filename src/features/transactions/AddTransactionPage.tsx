import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Minus,
  Plus,
  Search,
} from "lucide-react";
import {
  applyCurrencyRounding,
  calculateTaiwanFee,
  calculateTaiwanSupplementaryNhiFee,
  calculateTaiwanTax,
  canDeleteTransaction,
  canonicalStockCode,
  formatMarketPlainAmount,
  formatShareInputValue,
  getAvailableMarginLots,
  getAvailableShortLots,
  inferMarketFromCode,
  normalizeMarket,
  resolveAccountFeeSettings,
  stockCacheKey,
} from "@/domain";
import { usePortfolioData } from "@/hooks/usePortfolioData";
import { APP_ROUTES, createTransactionDetailRoute } from "@/lib/routes";
import { invokeDividendInfo } from "@/services";
import {
  ALL_TRANSACTION_TYPES,
  FINANCING_TRANSACTION_TYPES,
  STANDARD_TRANSACTION_TYPES,
  StockMarket,
  TransactionType,
  type Stock,
  type StockTransaction,
} from "@/types";

function todayLocalMidnightMillis(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function toDateInputValue(millis: number): string {
  const d = new Date(millis);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromDateInputValue(value: string): number {
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return todayLocalMidnightMillis();
  }
  return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
}

function parseNum(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : 0;
}

function defaultLotId(prefix: string, dateMillis: number): string {
  const ymd = toDateInputValue(dateMillis).replace(/-/g, "");
  const suffix = String(Date.now()).slice(-4);
  return `${prefix}-${ymd}-${suffix}`;
}

function ShareInputWithStepper({
  id,
  label,
  value,
  onChange,
  market,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  market: StockMarket;
}) {
  const step = market === StockMarket.TW ? 1000 : 1;
  const adjust = (delta: number) => {
    const current = parseNum(value);
    const next = Math.max(0, current + delta);
    const normalized =
      market === StockMarket.TW
        ? Math.round(next)
        : Number(next.toFixed(6));
    onChange(formatShareInputValue(normalized));
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => adjust(-step)}
          aria-label={`${label} 減少 ${step}`}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border px-2.5 text-xs font-medium hover:bg-muted"
        >
          <Minus className="h-3.5 w-3.5" />
          <span className="ml-0.5">{step}</span>
        </button>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={market === StockMarket.TW ? "1" : "any"}
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
        />
        <button
          type="button"
          onClick={() => adjust(step)}
          aria-label={`${label} 增加 ${step}`}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border px-2.5 text-xs font-medium hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="ml-0.5">{step}</span>
        </button>
      </div>
    </div>
  );
}

export function AddTransactionPage() {
  const { transactionId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    isLoading,
    accounts,
    activeAccountId,
    transactions,
    stocks,
    stockMap,
    settings,
    addTransaction,
    editTransaction,
  } = usePortfolioData();

  const isEditing = Boolean(transactionId);
  const numericEditId = isEditing
    ? Number(decodeURIComponent(transactionId ?? ""))
    : 0;

  const existingTx = useMemo(
    () =>
      isEditing
        ? transactions.find((t) => t.id === numericEditId) ?? null
        : null,
    [isEditing, transactions, numericEditId],
  );

  const initializedEditRef = useRef<number | null>(null);

  const initialDateParam = Number(searchParams.get("date"));
  const defaultDate =
    Number.isFinite(initialDateParam) && initialDateParam > 0
      ? initialDateParam
      : todayLocalMidnightMillis();
  const defaultCode = canonicalStockCode(searchParams.get("stockCode") ?? "");
  const defaultMarketParam = searchParams.get("market");
  const defaultMarket: StockMarket = defaultMarketParam
    ? normalizeMarket(defaultMarketParam)
    : defaultCode
      ? inferMarketFromCode(defaultCode)
      : StockMarket.TW;

  const [stockCode, setStockCode] = useState(defaultCode);
  const [stockSearchOpen, setStockSearchOpen] = useState(false);
  const [market, setMarket] = useState<StockMarket>(defaultMarket);
  const [accountId, setAccountId] = useState<number>(
    activeAccountId > 0 ? activeAccountId : accounts[0]?.id ?? 1,
  );
  const [dateMillis, setDateMillis] = useState<number>(defaultDate);
  const [type, setType] = useState<TransactionType>(TransactionType.BUY);
  const [isDayTrading, setIsDayTrading] = useState(false);

  // Numeric form fields stored as strings for clean editing
  const [priceInput, setPriceInput] = useState("");
  const [sharesInput, setSharesInput] = useState("");
  const [feeInput, setFeeInput] = useState("");
  const [feeOverridden, setFeeOverridden] = useState(false);
  const [taxInput, setTaxInput] = useState("");
  const [taxOverridden, setTaxOverridden] = useState(false);
  const [expenseInput, setExpenseInput] = useState("");
  const [expenseOverridden, setExpenseOverridden] = useState(false);
  const [incomeInput, setIncomeInput] = useState("");
  const [incomeOverridden, setIncomeOverridden] = useState(false);

  // Dividend fields
  const [cashDividendInput, setCashDividendInput] = useState("");
  const [stockDividendInput, setStockDividendInput] = useState("");
  const [dividendSharesInput, setDividendSharesInput] = useState("");
  const [dividendSharesOverridden, setDividendSharesOverridden] = useState(false);
  const [nhiFeeInput, setNhiFeeInput] = useState("");
  const [nhiFeeOverridden, setNhiFeeOverridden] = useState(false);
  const [dividendInfoLoading, setDividendInfoLoading] = useState(false);
  const [dividendInfoMsg, setDividendInfoMsg] = useState<string | null>(null);

  // Corporate action fields
  const [ratioInput, setRatioInput] = useState("");
  const [sharesBeforeInput, setSharesBeforeInput] = useState("");
  const [sharesAfterInput, setSharesAfterInput] = useState("");
  const [cashReturnedInput, setCashReturnedInput] = useState("");

  // Margin / Short fields
  const [marginPrincipalInput, setMarginPrincipalInput] = useState("");
  const [marginAnnualRateInput, setMarginAnnualRateInput] = useState(
    String(settings.defaultMarginAnnualRate),
  );
  const [marginLotIdInput, setMarginLotIdInput] = useState("");
  const [marginRepaymentLotId, setMarginRepaymentLotId] = useState("");
  const [marginRepaymentInput, setMarginRepaymentInput] = useState("");
  const [marginSelfFundedInput, setMarginSelfFundedInput] = useState("");
  const [marginSelfFundedOverridden, setMarginSelfFundedOverridden] =
    useState(false);
  const [marginActualInterestInput, setMarginActualInterestInput] =
    useState("");

  const [shortBorrowAnnualRateInput, setShortBorrowAnnualRateInput] = useState(
    String(settings.defaultShortBorrowAnnualRate),
  );
  const [shortLotIdInput, setShortLotIdInput] = useState("");
  const [shortCoverLotId, setShortCoverLotId] = useState("");
  const [shortCompensationLotId, setShortCompensationLotId] = useState("");
  const [shortCompensationInput, setShortCompensationInput] = useState("");

  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync default account when accounts load
  useEffect(() => {
    if (!isEditing && accounts.length > 0) {
      setAccountId((prev) =>
        accounts.some((a) => a.id === prev)
          ? prev
          : activeAccountId > 0
            ? activeAccountId
            : accounts[0].id,
      );
    }
  }, [accounts, activeAccountId, isEditing]);

  // Populate form in Edit mode
  useEffect(() => {
    if (!isEditing || !existingTx || initializedEditRef.current === existingTx.id) {
      return;
    }
    initializedEditRef.current = existingTx.id;
    const txMarket = normalizeMarket(existingTx.market);
    setStockCode(existingTx.stockCode);
    setMarket(txMarket);
    setAccountId(existingTx.accountId);
    setDateMillis(existingTx.date);
    setType(existingTx.type);

    if (
      existingTx.type === TransactionType.BUY ||
      existingTx.type === TransactionType.MARGIN_BUY ||
      existingTx.type === TransactionType.SHORT_COVER
    ) {
      setPriceInput(String(existingTx.buyPrice || ""));
      setSharesInput(
        formatShareInputValue(
          existingTx.type === TransactionType.SHORT_COVER
            ? existingTx.shortCoverShares || existingTx.buyShares
            : existingTx.buyShares,
        ),
      );
    } else if (
      existingTx.type === TransactionType.SELL ||
      existingTx.type === TransactionType.SHORT_SELL
    ) {
      setPriceInput(String(existingTx.sellPrice || ""));
      setSharesInput(formatShareInputValue(existingTx.sellShares));
    } else if (existingTx.type === TransactionType.CASH_DIVIDEND) {
      setSharesInput(formatShareInputValue(existingTx.exDividendShares));
    } else if (existingTx.type === TransactionType.STOCK_DIVIDEND) {
      setSharesInput(formatShareInputValue(existingTx.exRightsShares));
    }

    setFeeInput(existingTx.fee ? formatMarketPlainAmount(existingTx.fee, txMarket) : "");
    setFeeOverridden(true);
    setTaxInput(existingTx.tax ? formatMarketPlainAmount(existingTx.tax, txMarket) : "");
    setTaxOverridden(true);
    setExpenseInput(
      existingTx.expense ? formatMarketPlainAmount(existingTx.expense, txMarket) : "",
    );
    setExpenseOverridden(true);
    setIncomeInput(
      existingTx.income ? formatMarketPlainAmount(existingTx.income, txMarket) : "",
    );
    setIncomeOverridden(true);

    setCashDividendInput(existingTx.cashDividend ? String(existingTx.cashDividend) : "");
    setStockDividendInput(existingTx.stockDividend ? String(existingTx.stockDividend) : "");
    setDividendSharesInput(
      existingTx.dividendShares ? formatShareInputValue(existingTx.dividendShares) : "",
    );
    setDividendSharesOverridden(true);
    setNhiFeeInput(
      existingTx.supplementaryHealthInsurancePremium
        ? formatMarketPlainAmount(existingTx.supplementaryHealthInsurancePremium, txMarket)
        : "",
    );
    setNhiFeeOverridden(true);

    if (existingTx.type === TransactionType.CAPITAL_REDUCTION) {
      setRatioInput(String(existingTx.capitalReductionRatio || ""));
      setSharesBeforeInput(formatShareInputValue(existingTx.sharesBeforeReduction));
      setSharesAfterInput(formatShareInputValue(existingTx.sharesAfterReduction));
      setCashReturnedInput(existingTx.cashReturned ? String(existingTx.cashReturned) : "");
    } else if (existingTx.type === TransactionType.STOCK_SPLIT) {
      setRatioInput(String(existingTx.stockSplitRatio || ""));
      setSharesBeforeInput(formatShareInputValue(existingTx.sharesBeforeSplit));
      setSharesAfterInput(formatShareInputValue(existingTx.sharesAfterSplit));
    }

    setMarginPrincipalInput(
      existingTx.marginPrincipal ? String(existingTx.marginPrincipal) : "",
    );
    setMarginAnnualRateInput(
      existingTx.marginAnnualRate ? String(existingTx.marginAnnualRate) : "",
    );
    setMarginLotIdInput(existingTx.marginLotId);
    setMarginRepaymentLotId(existingTx.marginRepaymentLotId);
    setMarginRepaymentInput(
      existingTx.marginRepayment ? String(existingTx.marginRepayment) : "",
    );
    setMarginSelfFundedOverridden(existingTx.marginSelfFundedOverridden);
    setMarginSelfFundedInput(
      existingTx.marginSelfFundedOverridden
        ? formatMarketPlainAmount(existingTx.marginSelfFunded, txMarket)
        : "",
    );
    setMarginActualInterestInput(
      existingTx.marginActualInterest ? String(existingTx.marginActualInterest) : "",
    );

    setShortBorrowAnnualRateInput(
      existingTx.shortBorrowAnnualRate ? String(existingTx.shortBorrowAnnualRate) : "",
    );
    setShortLotIdInput(existingTx.shortLotId);
    setShortCoverLotId(existingTx.shortCoverLotId);
    setShortCompensationLotId(existingTx.shortCompensationLotId);
    setShortCompensationInput(
      existingTx.shortCompensation ? String(existingTx.shortCompensation) : "",
    );

    setNote(existingTx.note);
  }, [isEditing, existingTx]);

  const selectedStock = useMemo<Stock | null>(() => {
    const code = canonicalStockCode(stockCode);
    if (!code) return null;
    return stockMap.get(stockCacheKey(market, code)) ?? null;
  }, [stockCode, market, stockMap]);

  const filteredStocks = useMemo(() => {
    const q = stockCode.trim().toLowerCase();
    if (!q) return stocks.slice(0, 10);
    return stocks
      .filter(
        (s) =>
          s.code.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [stocks, stockCode]);

  const availableTypes = useMemo(() => {
    const showFinancing =
      (settings.marginFeatureEnabled && market === StockMarket.TW) ||
      (isEditing &&
        existingTx !== null &&
        FINANCING_TRANSACTION_TYPES.includes(existingTx.type));
    return showFinancing ? ALL_TRANSACTION_TYPES : STANDARD_TRANSACTION_TYPES;
  }, [settings.marginFeatureEnabled, market, isEditing, existingTx]);

  // If market switches to US and current type is TW-only financing, reset to BUY
  useEffect(() => {
    if (!availableTypes.includes(type)) {
      setType(TransactionType.BUY);
    }
  }, [availableTypes, type]);

  // Dynamic Margin & Short lots strictly prior to form (date, recordTime, id)
  const candidateScope = useMemo(
    () => ({
      id: existingTx?.id ?? 0,
      date: dateMillis,
      recordTime: existingTx?.recordTime ?? Date.now(),
      accountId,
      stockCode: canonicalStockCode(stockCode),
      market,
    }),
    [existingTx, dateMillis, accountId, stockCode, market],
  );

  const availableMarginLots = useMemo(
    () =>
      market === StockMarket.TW && candidateScope.stockCode
        ? getAvailableMarginLots(
            transactions,
            candidateScope,
            settings.marginDayCount,
          )
        : [],
    [transactions, candidateScope, settings.marginDayCount, market],
  );

  const availableShortLots = useMemo(
    () =>
      market === StockMarket.TW && candidateScope.stockCode
        ? getAvailableShortLots(
            transactions,
            candidateScope,
            settings.marginDayCount,
          )
        : [],
    [transactions, candidateScope, settings.marginDayCount, market],
  );

  // Clear stale lot selections when stock/account/date changes
  useEffect(() => {
    if (
      marginRepaymentLotId &&
      !availableMarginLots.some((l) => l.lotId === marginRepaymentLotId)
    ) {
      setMarginRepaymentLotId("");
    }
  }, [availableMarginLots, marginRepaymentLotId]);

  useEffect(() => {
    if (
      shortCoverLotId &&
      !availableShortLots.some((l) => l.lotId === shortCoverLotId)
    ) {
      setShortCoverLotId("");
    }
    if (
      shortCompensationLotId &&
      !availableShortLots.some((l) => l.lotId === shortCompensationLotId)
    ) {
      setShortCompensationLotId("");
    }
  }, [availableShortLots, shortCoverLotId, shortCompensationLotId]);

  // Auto-calculate fee, tax, expense, income, NHI fee, dividendShares
  const accountFeeSettings = useMemo(
    () =>
      resolveAccountFeeSettings(
        accounts.find((a) => a.id === accountId),
        {
          feeDiscount: settings.feeDiscount,
          minFeeRegular: settings.minFeeRegular,
          minFeeOddLot: settings.minFeeOddLot,
        },
      ),
    [accounts, accountId, settings.feeDiscount, settings.minFeeRegular, settings.minFeeOddLot],
  );

  const price = parseNum(priceInput);
  const shares = parseNum(sharesInput);

  const autoFee = useMemo(() => {
    if (type === TransactionType.CASH_DIVIDEND) {
      return market === StockMarket.TW ? settings.dividendFee : 0;
    }
    if (
      type === TransactionType.BUY ||
      type === TransactionType.SELL ||
      type === TransactionType.MARGIN_BUY ||
      type === TransactionType.SHORT_SELL ||
      type === TransactionType.SHORT_COVER
    ) {
      if (market === StockMarket.US || price <= 0 || shares <= 0) return 0;
      return calculateTaiwanFee(
        price,
        shares,
        accountFeeSettings.feeDiscount,
        accountFeeSettings.minFeeRegular,
        accountFeeSettings.minFeeOddLot,
        settings.calculationRoundingMode,
      );
    }
    return 0;
  }, [
    type,
    market,
    price,
    shares,
    accountFeeSettings,
    settings.dividendFee,
    settings.calculationRoundingMode,
  ]);

  const effectiveFee = feeOverridden ? parseNum(feeInput) : autoFee;

  const autoTax = useMemo(() => {
    if (
      (type !== TransactionType.SELL && type !== TransactionType.SHORT_SELL) ||
      market === StockMarket.US ||
      price <= 0 ||
      shares <= 0
    ) {
      return 0;
    }
    return calculateTaiwanTax(
      price,
      shares,
      selectedStock?.stockType ?? "",
      isDayTrading,
      {
        normalListedStock: settings.taxRateNormalListedStock,
        domesticStockEtf: settings.taxRateDomesticStockEtf,
        bondEtf: settings.taxRateBondEtf,
        dayTrading: settings.taxRateDayTrading,
      },
      settings.calculationRoundingMode,
    );
  }, [
    type,
    market,
    price,
    shares,
    selectedStock?.stockType,
    isDayTrading,
    settings.taxRateNormalListedStock,
    settings.taxRateDomesticStockEtf,
    settings.taxRateBondEtf,
    settings.taxRateDayTrading,
    settings.calculationRoundingMode,
  ]);

  const effectiveTax = taxOverridden ? parseNum(taxInput) : autoTax;

  const cashDivPerShare = parseNum(cashDividendInput);
  const grossCashDividend = cashDivPerShare * shares;
  const autoNhiFee = useMemo(
    () =>
      type === TransactionType.CASH_DIVIDEND
        ? calculateTaiwanSupplementaryNhiFee(grossCashDividend, market)
        : 0,
    [type, grossCashDividend, market],
  );
  const effectiveNhiFee = nhiFeeOverridden ? parseNum(nhiFeeInput) : autoNhiFee;

  const autoExpense = useMemo(() => {
    if (
      type === TransactionType.BUY ||
      type === TransactionType.MARGIN_BUY ||
      type === TransactionType.SHORT_COVER
    ) {
      return applyCurrencyRounding(
        price * shares + effectiveFee,
        market,
        settings.calculationRoundingMode,
      );
    }
    if (type === TransactionType.MARGIN_REPAYMENT) {
      return applyCurrencyRounding(
        parseNum(marginRepaymentInput) + parseNum(marginActualInterestInput),
        market,
        settings.calculationRoundingMode,
      );
    }
    if (type === TransactionType.SHORT_COMPENSATION) {
      return applyCurrencyRounding(
        parseNum(shortCompensationInput),
        market,
        settings.calculationRoundingMode,
      );
    }
    return 0;
  }, [
    type,
    price,
    shares,
    effectiveFee,
    market,
    settings.calculationRoundingMode,
    marginRepaymentInput,
    marginActualInterestInput,
    shortCompensationInput,
  ]);

  const effectiveExpense = expenseOverridden
    ? parseNum(expenseInput)
    : autoExpense;

  const autoIncome = useMemo(() => {
    if (type === TransactionType.SELL || type === TransactionType.SHORT_SELL) {
      return Math.max(
        0,
        applyCurrencyRounding(
          price * shares - effectiveFee - effectiveTax,
          market,
          settings.calculationRoundingMode,
        ),
      );
    }
    if (type === TransactionType.CASH_DIVIDEND) {
      return Math.max(
        0,
        applyCurrencyRounding(
          grossCashDividend - effectiveFee - effectiveNhiFee,
          market,
          settings.calculationRoundingMode,
        ),
      );
    }
    return 0;
  }, [
    type,
    price,
    shares,
    effectiveFee,
    effectiveTax,
    grossCashDividend,
    effectiveNhiFee,
    market,
    settings.calculationRoundingMode,
  ]);

  const effectiveIncome = incomeOverridden ? parseNum(incomeInput) : autoIncome;

  const autoDividendShares = useMemo(() => {
    if (type !== TransactionType.STOCK_DIVIDEND) return 0;
    const stockDiv = parseNum(stockDividendInput);
    if (stockDiv <= 0 || shares <= 0) return 0;
    return Math.floor((stockDiv / 10) * shares);
  }, [type, stockDividendInput, shares]);

  const effectiveDividendShares = dividendSharesOverridden
    ? parseNum(dividendSharesInput)
    : autoDividendShares;

  const marginPrincipalNum = parseNum(marginPrincipalInput);
  const autoMarginSelfFunded = Math.max(0, effectiveExpense - marginPrincipalNum);
  const effectiveMarginSelfFunded = marginSelfFundedOverridden
    ? parseNum(marginSelfFundedInput)
    : autoMarginSelfFunded;

  const handleSelectStock = (stock: Stock) => {
    setStockCode(stock.code);
    setMarket(normalizeMarket(stock.market));
    setStockSearchOpen(false);
  };

  const handleTypeChange = (nextType: TransactionType) => {
    setType(nextType);
    setFeeOverridden(false);
    setTaxOverridden(false);
    setExpenseOverridden(false);
    setIncomeOverridden(false);
    setNhiFeeOverridden(false);
    setDividendSharesOverridden(false);
    setSubmitError(null);
    setSubmitSuccess(null);

    if (nextType === TransactionType.MARGIN_BUY) {
      if (!marginLotIdInput) setMarginLotIdInput(defaultLotId("M", dateMillis));
      if (!marginAnnualRateInput) {
        setMarginAnnualRateInput(String(settings.defaultMarginAnnualRate));
      }
    } else if (nextType === TransactionType.SHORT_SELL) {
      if (!shortLotIdInput) setShortLotIdInput(defaultLotId("S", dateMillis));
      if (!shortBorrowAnnualRateInput) {
        setShortBorrowAnnualRateInput(
          String(settings.defaultShortBorrowAnnualRate),
        );
      }
    }
  };

  const handleFetchDividendInfo = async () => {
    const code = canonicalStockCode(stockCode);
    if (!code || market !== StockMarket.TW) {
      setDividendInfoMsg("請先輸入台股代號");
      return;
    }
    setDividendInfoLoading(true);
    setDividendInfoMsg(null);
    try {
      const res = await invokeDividendInfo([code]);
      const summary = res.results[code];
      if (!summary) {
        setDividendInfoMsg("查無 Yahoo 配息/配股資料");
        return;
      }
      if (type === TransactionType.CASH_DIVIDEND && summary.cashDividend) {
        setCashDividendInput(String(summary.cashDividend.amount));
        setDividendInfoMsg(
          `已帶入現金股利 ${summary.cashDividend.amount} 元（除息日 ${summary.cashDividend.date}）`,
        );
      } else if (
        type === TransactionType.STOCK_DIVIDEND &&
        summary.stockDividend
      ) {
        setStockDividendInput(String(summary.stockDividend.amount));
        setDividendInfoMsg(
          `已帶入股票股利 ${summary.stockDividend.amount} 元（除權日 ${summary.stockDividend.date}）`,
        );
      } else {
        setDividendInfoMsg("Yahoo 查無對應股利資料");
      }
    } catch (err) {
      setDividendInfoMsg(
        err instanceof Error ? err.message : "查詢股利資訊失敗",
      );
    } finally {
      setDividendInfoLoading(false);
    }
  };

  const buildCandidatePayload = (): Omit<StockTransaction, "id"> & {
    id?: number;
  } => {
    const cleanCode = canonicalStockCode(stockCode);
    const nowRecordTime = existingTx?.recordTime ?? Date.now();
    const base: Omit<StockTransaction, "id"> & { id?: number } = {
      ...(existingTx ? { id: existingTx.id } : {}),
      stockCode: cleanCode,
      market,
      accountId,
      date: dateMillis,
      recordTime: nowRecordTime,
      type,
      buyPrice: 0,
      buyShares: 0,
      sellPrice: 0,
      sellShares: 0,
      fee: effectiveFee,
      tax: effectiveTax,
      income: 0,
      expense: 0,
      cashDividend: 0,
      exDividendShares: 0,
      dividendIncome: 0,
      supplementaryHealthInsurancePremium: 0,
      stockDividend: 0,
      dividendShares: 0,
      exRightsShares: 0,
      note: note.trim(),
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
    };

    switch (type) {
      case TransactionType.BUY:
        base.buyPrice = price;
        base.buyShares = shares;
        base.expense = effectiveExpense;
        break;
      case TransactionType.SELL:
        base.sellPrice = price;
        base.sellShares = shares;
        base.income = effectiveIncome;
        break;
      case TransactionType.CASH_DIVIDEND:
        base.cashDividend = cashDivPerShare;
        base.exDividendShares = shares;
        base.supplementaryHealthInsurancePremium = effectiveNhiFee;
        base.dividendIncome = effectiveIncome;
        base.income = effectiveIncome;
        break;
      case TransactionType.STOCK_DIVIDEND:
        base.stockDividend = parseNum(stockDividendInput);
        base.exRightsShares = shares;
        base.dividendShares = effectiveDividendShares;
        break;
      case TransactionType.CAPITAL_REDUCTION:
        base.capitalReductionRatio = parseNum(ratioInput);
        base.sharesBeforeReduction = parseNum(sharesBeforeInput);
        base.sharesAfterReduction = parseNum(sharesAfterInput);
        base.cashReturned = parseNum(cashReturnedInput);
        base.income = base.cashReturned;
        break;
      case TransactionType.STOCK_SPLIT:
        base.stockSplitRatio = parseNum(ratioInput);
        base.sharesBeforeSplit = parseNum(sharesBeforeInput);
        base.sharesAfterSplit = parseNum(sharesAfterInput);
        break;
      case TransactionType.MARGIN_BUY:
        base.buyPrice = price;
        base.buyShares = shares;
        base.expense = effectiveExpense;
        base.marginPrincipal = marginPrincipalNum;
        base.marginAnnualRate = parseNum(marginAnnualRateInput);
        base.marginLotId =
          marginLotIdInput.trim() || defaultLotId("M", dateMillis);
        base.marginSelfFundedOverridden = marginSelfFundedOverridden;
        base.marginSelfFunded = marginSelfFundedOverridden
          ? parseNum(marginSelfFundedInput)
          : autoMarginSelfFunded;
        break;
      case TransactionType.MARGIN_REPAYMENT:
        base.marginRepaymentLotId = marginRepaymentLotId;
        base.marginRepayment = parseNum(marginRepaymentInput);
        base.marginActualInterest = parseNum(marginActualInterestInput);
        base.expense = effectiveExpense;
        break;
      case TransactionType.SHORT_SELL:
        base.sellPrice = price;
        base.sellShares = shares;
        base.income = effectiveIncome;
        base.shortBorrowPrincipal = applyCurrencyRounding(
          price * shares,
          market,
          settings.calculationRoundingMode,
        );
        base.shortBorrowAnnualRate = parseNum(shortBorrowAnnualRateInput);
        base.shortLotId =
          shortLotIdInput.trim() || defaultLotId("S", dateMillis);
        break;
      case TransactionType.SHORT_COVER:
        base.buyPrice = price;
        base.buyShares = shares;
        base.shortCoverShares = shares;
        base.shortCoverLotId = shortCoverLotId;
        base.expense = effectiveExpense;
        break;
      case TransactionType.SHORT_COMPENSATION:
        base.shortCompensationLotId = shortCompensationLotId;
        base.shortCompensation = parseNum(shortCompensationInput);
        base.expense = effectiveExpense;
        break;
    }

    return base;
  };

  const resetForNext = () => {
    setPriceInput("");
    setSharesInput("");
    setFeeInput("");
    setFeeOverridden(false);
    setTaxInput("");
    setTaxOverridden(false);
    setExpenseInput("");
    setExpenseOverridden(false);
    setIncomeInput("");
    setIncomeOverridden(false);
    setCashDividendInput("");
    setStockDividendInput("");
    setDividendSharesInput("");
    setDividendSharesOverridden(false);
    setNhiFeeInput("");
    setNhiFeeOverridden(false);
    setRatioInput("");
    setSharesBeforeInput("");
    setSharesAfterInput("");
    setCashReturnedInput("");
    setMarginPrincipalInput("");
    setMarginLotIdInput(defaultLotId("M", dateMillis));
    setMarginRepaymentLotId("");
    setMarginRepaymentInput("");
    setMarginSelfFundedInput("");
    setMarginSelfFundedOverridden(false);
    setMarginActualInterestInput("");
    setShortLotIdInput(defaultLotId("S", dateMillis));
    setShortCoverLotId("");
    setShortCompensationLotId("");
    setShortCompensationInput("");
    setNote("");
  };

  const handleSubmit = async (addAnother: boolean) => {
    setSubmitError(null);
    setSubmitSuccess(null);
    setIsSubmitting(true);
    try {
      const payload = buildCandidatePayload();
      if (isEditing && existingTx) {
        const updated = await editTransaction({
          original: existingTx,
          candidate: { ...payload, id: existingTx.id },
        });
        navigate(createTransactionDetailRoute(updated.id));
      } else {
        await addTransaction(payload);
        if (addAnother) {
          resetForNext();
          setSubmitSuccess(
            `已新增 ${payload.stockCode}（${payload.type}），可繼續輸入下一筆`,
          );
        } else {
          navigate(APP_ROUTES.TRANSACTIONS);
        }
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "儲存交易失敗");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isEditing && isLoading && !existingTx) {
    return (
      <section className="space-y-4">
        <div className="h-10 w-36 animate-pulse rounded-md bg-muted" />
        <div className="h-96 animate-pulse rounded-xl border bg-card p-6" />
      </section>
    );
  }

  if (isEditing && !existingTx) {
    return (
      <section className="rounded-xl border bg-card p-6 text-center">
        <h1 className="text-lg font-bold">找不到要編輯的交易</h1>
        <button
          type="button"
          onClick={() => navigate(APP_ROUTES.TRANSACTIONS)}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>返回交易紀錄</span>
        </button>
      </section>
    );
  }

  const editLocked =
    isEditing && existingTx ? !canDeleteTransaction(existingTx, transactions) : false;

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="返回"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-xl font-bold tracking-tight">
            {isEditing ? `編輯交易 #${existingTx?.id}` : "新增交易"}
          </h1>
        </div>
      </div>

      {editLocked && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"
        >
          此開倉交易已被後續的融資還款、買券還券或融券補償引用，無法儲存變更。
        </div>
      )}

      {submitError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      {submitSuccess && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{submitSuccess}</span>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit(false);
        }}
        className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground"
      >
        {/* Stock Code Autocomplete + Market */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="relative sm:col-span-2">
            <label
              htmlFor="tx-stock-code"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              股票代號 / 名稱搜尋
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="tx-stock-code"
                type="text"
                value={stockCode}
                onFocus={() => setStockSearchOpen(true)}
                onBlur={() => {
                  setTimeout(() => setStockSearchOpen(false), 150);
                }}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  setStockCode(val);
                  if (val.trim()) {
                    setMarket(inferMarketFromCode(val));
                  }
                  setStockSearchOpen(true);
                }}
                placeholder="例如 2330 或 AAPL"
                className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm"
                required
              />
            </div>
            {selectedStock && (
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedStock.name} ({selectedStock.exchange || selectedStock.market})
              </p>
            )}
            {stockSearchOpen && filteredStocks.length > 0 && (
              <ul
                role="listbox"
                aria-label="股票搜尋建議"
                className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
              >
                {filteredStocks.map((s) => (
                  <li key={`${s.market}:${s.code}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectStock(s);
                      }}
                      className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-xs hover:bg-accent"
                    >
                      <span>
                        <span className="font-semibold">{s.code}</span>{" "}
                        <span className="text-muted-foreground">{s.name}</span>
                      </span>
                      <span className="rounded border px-1.5 py-0.5 text-[10px]">
                        {s.market}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label
              htmlFor="tx-market"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              市場
            </label>
            <select
              id="tx-market"
              value={market}
              onChange={(e) => setMarket(e.target.value as StockMarket)}
              className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
            >
              <option value={StockMarket.TW}>台股 (TW)</option>
              <option value={StockMarket.US}>美股 (US)</option>
            </select>
          </div>
        </div>

        {/* Account & Date */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="tx-account"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              帳戶
            </label>
            <select
              id="tx-account"
              value={accountId}
              onChange={(e) => setAccountId(Number(e.target.value))}
              className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="tx-date"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              交易日期
            </label>
            <input
              id="tx-date"
              type="date"
              value={toDateInputValue(dateMillis)}
              onChange={(e) => setDateMillis(fromDateInputValue(e.target.value))}
              className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
              required
            />
          </div>
        </div>

        {/* Transaction Type Chips */}
        <div>
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            交易類型
          </span>
          <div className="flex flex-wrap gap-1.5">
            {availableTypes.map((t) => {
              const label =
                t === TransactionType.MARGIN_REPAYMENT ? "還融資" : t;
              const active = type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTypeChange(t)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background text-foreground hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic Fields by Type */}
        {(type === TransactionType.BUY ||
          type === TransactionType.SELL ||
          type === TransactionType.MARGIN_BUY ||
          type === TransactionType.SHORT_SELL ||
          type === TransactionType.SHORT_COVER) && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="tx-price"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  {type === TransactionType.SELL ||
                  type === TransactionType.SHORT_SELL
                    ? "賣出價格"
                    : "買進價格"}
                </label>
                <input
                  id="tx-price"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
                  required
                />
              </div>
              <ShareInputWithStepper
                id="tx-shares"
                label={
                  type === TransactionType.SHORT_COVER
                    ? "買券還券股數"
                    : type === TransactionType.SELL ||
                        type === TransactionType.SHORT_SELL
                      ? "賣出股數"
                      : "買進股數"
                }
                value={sharesInput}
                onChange={setSharesInput}
                market={market}
              />
            </div>

            {market === StockMarket.TW &&
              (type === TransactionType.SELL ||
                type === TransactionType.SHORT_SELL) && (
                <label className="inline-flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={isDayTrading}
                    onChange={(e) => setIsDayTrading(e.target.checked)}
                    className="h-4 w-4 rounded border"
                  />
                  <span>當沖交易（適用當沖證交稅率）</span>
                </label>
              )}

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="tx-fee"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  手續費 {feeOverridden ? "(已手動)" : "(自動)"}
                </label>
                <input
                  id="tx-fee"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={
                    feeOverridden
                      ? feeInput
                      : formatMarketPlainAmount(autoFee, market)
                  }
                  onChange={(e) => {
                    if (e.target.value === "") {
                      setFeeOverridden(false);
                      setFeeInput("");
                    } else {
                      setFeeOverridden(true);
                      setFeeInput(e.target.value);
                    }
                  }}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
                />
              </div>

              {(type === TransactionType.SELL ||
                type === TransactionType.SHORT_SELL) && (
                <div>
                  <label
                    htmlFor="tx-tax"
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                  >
                    交易稅 {taxOverridden ? "(已手動)" : "(自動)"}
                  </label>
                  <input
                    id="tx-tax"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={
                      taxOverridden
                        ? taxInput
                        : formatMarketPlainAmount(autoTax, market)
                    }
                    onChange={(e) => {
                      if (e.target.value === "") {
                        setTaxOverridden(false);
                        setTaxInput("");
                      } else {
                        setTaxOverridden(true);
                        setTaxInput(e.target.value);
                      }
                    }}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
                  />
                </div>
              )}

              {type === TransactionType.BUY ||
              type === TransactionType.MARGIN_BUY ||
              type === TransactionType.SHORT_COVER ? (
                <div>
                  <label
                    htmlFor="tx-expense"
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                  >
                    總支出 {expenseOverridden ? "(已手動)" : "(自動)"}
                  </label>
                  <input
                    id="tx-expense"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={
                      expenseOverridden
                        ? expenseInput
                        : formatMarketPlainAmount(autoExpense, market)
                    }
                    onChange={(e) => {
                      if (e.target.value === "") {
                        setExpenseOverridden(false);
                        setExpenseInput("");
                      } else {
                        setExpenseOverridden(true);
                        setExpenseInput(e.target.value);
                      }
                    }}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
                  />
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="tx-income"
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                  >
                    總收入 {incomeOverridden ? "(已手動)" : "(自動)"}
                  </label>
                  <input
                    id="tx-income"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={
                      incomeOverridden
                        ? incomeInput
                        : formatMarketPlainAmount(autoIncome, market)
                    }
                    onChange={(e) => {
                      if (e.target.value === "") {
                        setIncomeOverridden(false);
                        setIncomeInput("");
                      } else {
                        setIncomeOverridden(true);
                        setIncomeInput(e.target.value);
                      }
                    }}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Cash Dividend Fields */}
        {type === TransactionType.CASH_DIVIDEND && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                台股毛額超過 NT$20,000 自動計算 2.11% 二代健保補充保費
              </span>
              {market === StockMarket.TW && (
                <button
                  type="button"
                  disabled={dividendInfoLoading}
                  onClick={() => void handleFetchDividendInfo()}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>
                    {dividendInfoLoading ? "查詢中..." : "自動帶入 Yahoo 股利"}
                  </span>
                </button>
              )}
            </div>
            {dividendInfoMsg && (
              <p className="text-xs text-primary">{dividendInfoMsg}</p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="tx-cash-dividend"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  每股現金股利
                </label>
                <input
                  id="tx-cash-dividend"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={cashDividendInput}
                  onChange={(e) => setCashDividendInput(e.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
                  required
                />
              </div>
              <ShareInputWithStepper
                id="tx-ex-div-shares"
                label="除息股數"
                value={sharesInput}
                onChange={setSharesInput}
                market={market}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="tx-div-fee"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  匯費/手續費
                </label>
                <input
                  id="tx-div-fee"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={
                    feeOverridden
                      ? feeInput
                      : formatMarketPlainAmount(autoFee, market)
                  }
                  onChange={(e) => {
                    if (e.target.value === "") {
                      setFeeOverridden(false);
                      setFeeInput("");
                    } else {
                      setFeeOverridden(true);
                      setFeeInput(e.target.value);
                    }
                  }}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
                />
              </div>

              <div>
                <label
                  htmlFor="tx-nhi-fee"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  補充保費 (2.11%)
                </label>
                <input
                  id="tx-nhi-fee"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={
                    nhiFeeOverridden
                      ? nhiFeeInput
                      : formatMarketPlainAmount(autoNhiFee, market)
                  }
                  onChange={(e) => {
                    if (e.target.value === "") {
                      setNhiFeeOverridden(false);
                      setNhiFeeInput("");
                    } else {
                      setNhiFeeOverridden(true);
                      setNhiFeeInput(e.target.value);
                    }
                  }}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
                />
              </div>

              <div>
                <label
                  htmlFor="tx-div-income"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  實領股息
                </label>
                <input
                  id="tx-div-income"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={
                    incomeOverridden
                      ? incomeInput
                      : formatMarketPlainAmount(autoIncome, market)
                  }
                  onChange={(e) => {
                    if (e.target.value === "") {
                      setIncomeOverridden(false);
                      setIncomeInput("");
                    } else {
                      setIncomeOverridden(true);
                      setIncomeInput(e.target.value);
                    }
                  }}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
                />
              </div>
            </div>
          </div>
        )}

        {/* Stock Dividend Fields */}
        {type === TransactionType.STOCK_DIVIDEND && (
          <div className="space-y-4">
            {market === StockMarket.TW && (
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  disabled={dividendInfoLoading}
                  onClick={() => void handleFetchDividendInfo()}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>
                    {dividendInfoLoading ? "查詢中..." : "自動帶入 Yahoo 股利"}
                  </span>
                </button>
              </div>
            )}
            {dividendInfoMsg && (
              <p className="text-xs text-primary">{dividendInfoMsg}</p>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="tx-stock-dividend"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  每股股票股利 (元)
                </label>
                <input
                  id="tx-stock-dividend"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={stockDividendInput}
                  onChange={(e) => setStockDividendInput(e.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
                />
              </div>
              <ShareInputWithStepper
                id="tx-ex-rights-shares"
                label="除權股數"
                value={sharesInput}
                onChange={setSharesInput}
                market={market}
              />
              <div>
                <label
                  htmlFor="tx-dividend-shares"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  配發股數
                </label>
                <input
                  id="tx-dividend-shares"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={
                    dividendSharesOverridden
                      ? dividendSharesInput
                      : formatShareInputValue(autoDividendShares)
                  }
                  onChange={(e) => {
                    if (e.target.value === "") {
                      setDividendSharesOverridden(false);
                      setDividendSharesInput("");
                    } else {
                      setDividendSharesOverridden(true);
                      setDividendSharesInput(e.target.value);
                    }
                  }}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
                  required
                />
              </div>
            </div>
          </div>
        )}

        {/* Capital Reduction / Stock Split Fields */}
        {(type === TransactionType.CAPITAL_REDUCTION ||
          type === TransactionType.STOCK_SPLIT) && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="tx-ratio"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                {type === TransactionType.CAPITAL_REDUCTION
                  ? "減資比例 (%)"
                  : "分割比例 (1 拆 N)"}
              </label>
              <input
                id="tx-ratio"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={ratioInput}
                onChange={(e) => setRatioInput(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
                required
              />
            </div>
            {type === TransactionType.CAPITAL_REDUCTION && (
              <div>
                <label
                  htmlFor="tx-cash-returned"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  減資返還現金
                </label>
                <input
                  id="tx-cash-returned"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={cashReturnedInput}
                  onChange={(e) => setCashReturnedInput(e.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
                />
              </div>
            )}
            <ShareInputWithStepper
              id="tx-shares-before"
              label={
                type === TransactionType.CAPITAL_REDUCTION
                  ? "減資前股數"
                  : "分割前股數"
              }
              value={sharesBeforeInput}
              onChange={setSharesBeforeInput}
              market={market}
            />
            <ShareInputWithStepper
              id="tx-shares-after"
              label={
                type === TransactionType.CAPITAL_REDUCTION
                  ? "減資後股數"
                  : "分割後股數"
              }
              value={sharesAfterInput}
              onChange={setSharesAfterInput}
              market={market}
            />
          </div>
        )}

        {/* Margin Buy Specific Fields */}
        {type === TransactionType.MARGIN_BUY && (
          <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="tx-margin-lot-id"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                融資批次 ID
              </label>
              <input
                id="tx-margin-lot-id"
                type="text"
                value={marginLotIdInput}
                onChange={(e) => setMarginLotIdInput(e.target.value)}
                placeholder="自動產生或自訂"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="tx-margin-principal"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                融資本金 (借款金額)
              </label>
              <input
                id="tx-margin-principal"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={marginPrincipalInput}
                onChange={(e) => setMarginPrincipalInput(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
                required
              />
            </div>
            <div>
              <label
                htmlFor="tx-margin-rate"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                融資年利率 (%)
              </label>
              <input
                id="tx-margin-rate"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={marginAnnualRateInput}
                onChange={(e) => setMarginAnnualRateInput(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
              />
            </div>
            <div>
              <label
                htmlFor="tx-margin-self-funded"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                融資自備款{" "}
                {marginSelfFundedOverridden ? "(手動覆寫)" : "(自動 = 支出 - 本金)"}
              </label>
              <input
                id="tx-margin-self-funded"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={
                  marginSelfFundedOverridden
                    ? marginSelfFundedInput
                    : formatMarketPlainAmount(autoMarginSelfFunded, market)
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "") {
                    setMarginSelfFundedOverridden(false);
                    setMarginSelfFundedInput("");
                  } else {
                    setMarginSelfFundedOverridden(true);
                    setMarginSelfFundedInput(val);
                  }
                }}
                placeholder={formatMarketPlainAmount(effectiveMarginSelfFunded, market)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
              />
            </div>
          </div>
        )}

        {/* Margin Repayment Specific Fields */}
        {type === TransactionType.MARGIN_REPAYMENT && (
          <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label
                htmlFor="tx-repayment-lot"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                沖抵融資批次（依交易日前可償還批次）
              </label>
              <select
                id="tx-repayment-lot"
                value={marginRepaymentLotId}
                onChange={(e) => setMarginRepaymentLotId(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
                required
              >
                <option value="">
                  {availableMarginLots.length === 0
                    ? "無可用未清融資批次"
                    : "請選擇融資批次"}
                </option>
                {availableMarginLots.map((lot) => (
                  <option key={lot.lotId} value={lot.lotId}>
                    {lot.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="tx-margin-repayment"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                償還本金
              </label>
              <input
                id="tx-margin-repayment"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={marginRepaymentInput}
                onChange={(e) => setMarginRepaymentInput(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
              />
            </div>
            <div>
              <label
                htmlFor="tx-margin-interest"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                實際利息
              </label>
              <input
                id="tx-margin-interest"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={marginActualInterestInput}
                onChange={(e) => setMarginActualInterestInput(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
              />
            </div>
            <div>
              <label
                htmlFor="tx-repayment-expense"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                總支出
              </label>
              <input
                id="tx-repayment-expense"
                type="number"
                readOnly
                value={formatMarketPlainAmount(effectiveExpense, market)}
                className="h-9 w-full rounded-md border bg-muted px-3 text-sm tabular-nums"
              />
            </div>
          </div>
        )}

        {/* Short Sell Specific Fields */}
        {type === TransactionType.SHORT_SELL && (
          <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="tx-short-lot-id"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                融券批次 ID
              </label>
              <input
                id="tx-short-lot-id"
                type="text"
                value={shortLotIdInput}
                onChange={(e) => setShortLotIdInput(e.target.value)}
                placeholder="自動產生或自訂"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="tx-short-rate"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                融券年費率 (%)
              </label>
              <input
                id="tx-short-rate"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={shortBorrowAnnualRateInput}
                onChange={(e) => setShortBorrowAnnualRateInput(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
              />
            </div>
          </div>
        )}

        {/* Short Cover Specific Fields */}
        {type === TransactionType.SHORT_COVER && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <label
              htmlFor="tx-short-cover-lot"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              沖抵融券批次（依交易日前未還券批次）
            </label>
            <select
              id="tx-short-cover-lot"
              value={shortCoverLotId}
              onChange={(e) => setShortCoverLotId(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
              required
            >
              <option value="">
                {availableShortLots.length === 0
                  ? "無可用未還融券批次"
                  : "請選擇融券批次"}
              </option>
              {availableShortLots.map((lot) => (
                <option key={lot.lotId} value={lot.lotId}>
                  {lot.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Short Compensation Specific Fields */}
        {type === TransactionType.SHORT_COMPENSATION && (
          <div className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="tx-short-comp-lot"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                補償融券批次
              </label>
              <select
                id="tx-short-comp-lot"
                value={shortCompensationLotId}
                onChange={(e) => setShortCompensationLotId(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
                required
              >
                <option value="">
                  {availableShortLots.length === 0
                    ? "無可用未還融券批次"
                    : "請選擇融券批次"}
                </option>
                {availableShortLots.map((lot) => (
                  <option key={lot.lotId} value={lot.lotId}>
                    {lot.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="tx-short-comp-amount"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                融券補償金
              </label>
              <input
                id="tx-short-comp-amount"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={shortCompensationInput}
                onChange={(e) => setShortCompensationInput(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
                required
              />
            </div>
          </div>
        )}

        {/* Note */}
        <div>
          <label
            htmlFor="tx-note"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            備註
          </label>
          <input
            id="tx-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="選填交易筆記"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {!isEditing && (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleSubmit(true)}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              新增下一筆
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting || editLocked}
            className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isSubmitting
              ? "儲存中..."
              : isEditing
                ? "更新交易"
                : "新增交易"}
          </button>
        </div>
      </form>
    </section>
  );
}
