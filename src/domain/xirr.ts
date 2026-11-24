import type { CashFlow } from "@/types";

const DAYS_PER_YEAR = 365.0;
const EPSILON = 1e-10;
const DEFAULT_GUESS = 0.1;
const MS_PER_DAY = 86_400_000;

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getDateFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Returns UTC midnight epoch millis for the local calendar date of [epochMillis] in [timeZone].
 * Subtracting two such UTC midnights and dividing by 86,400,000 yields exact calendar days
 * across DST transitions and leap years.
 */
export function localDateUtcMidnightMillis(
  epochMillis: number,
  timeZone: string = getSystemTimeZone()
): number {
  const parts = getDateFormatter(timeZone).formatToParts(new Date(epochMillis));
  let year = 1970;
  let month = 1;
  let day = 1;
  for (const part of parts) {
    if (part.type === "year") year = Number(part.value);
    else if (part.type === "month") month = Number(part.value);
    else if (part.type === "day") day = Number(part.value);
  }
  return Date.UTC(year, month - 1, day);
}

export function calendarDaysBetween(
  startMillis: number,
  endMillis: number,
  timeZone: string = getSystemTimeZone()
): number {
  const startDay = localDateUtcMidnightMillis(startMillis, timeZone);
  const endDay = localDateUtcMidnightMillis(endMillis, timeZone);
  return Math.round((endDay - startDay) / MS_PER_DAY);
}

export function getSystemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

interface PreparedCashFlow {
  years: number;
  amount: number;
}

function xnpv(rate: number, flows: readonly PreparedCashFlow[]): number {
  if (rate <= -1.0) return Number.NaN;
  const base = 1.0 + rate;
  let sum = 0.0;
  for (const flow of flows) {
    sum += flow.amount / Math.pow(base, flow.years);
  }
  return sum;
}

function xnpvDerivative(rate: number, flows: readonly PreparedCashFlow[]): number {
  if (rate <= -1.0) return Number.NaN;
  const base = 1.0 + rate;
  let sum = 0.0;
  for (const flow of flows) {
    if (flow.years !== 0.0) {
      sum += (-flow.years * flow.amount) / Math.pow(base, flow.years + 1.0);
    }
  }
  return sum;
}

function solveWithNewton(
  flows: readonly PreparedCashFlow[],
  guess: number
): number | null {
  let rate = Number.isFinite(guess) && guess > -0.999999999 ? guess : DEFAULT_GUESS;
  for (let i = 0; i < 100; i++) {
    const value = xnpv(rate, flows);
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) < 1e-8) return rate;

    const derivative = xnpvDerivative(rate, flows);
    if (!Number.isFinite(derivative) || Math.abs(derivative) < EPSILON) return null;

    const nextRate = rate - value / derivative;
    if (!Number.isFinite(nextRate) || nextRate <= -0.999999999) return null;

    if (Math.abs(nextRate - rate) < 1e-10) return nextRate;
    rate = nextRate;
  }
  return null;
}

function solveWithBisection(flows: readonly PreparedCashFlow[]): number | null {
  let lower = -0.999999999;
  let upper = 0.1;
  let lowerValue = xnpv(lower, flows);
  let upperValue = xnpv(upper, flows);

  let expandCount = 0;
  while (
    Number.isFinite(lowerValue) &&
    Number.isFinite(upperValue) &&
    lowerValue * upperValue > 0.0 &&
    expandCount < 80
  ) {
    upper = upper < 1.0 ? upper + 1.0 : upper * 2.0;
    upperValue = xnpv(upper, flows);
    expandCount++;
  }

  if (
    !Number.isFinite(lowerValue) ||
    !Number.isFinite(upperValue) ||
    lowerValue * upperValue > 0.0
  ) {
    return null;
  }

  for (let i = 0; i < 200; i++) {
    const mid = (lower + upper) / 2.0;
    const midValue = xnpv(mid, flows);
    if (!Number.isFinite(midValue)) return null;
    if (Math.abs(midValue) < 1e-8 || Math.abs(upper - lower) < 1e-10) return mid;

    if (lowerValue * midValue <= 0.0) {
      upper = mid;
      upperValue = midValue;
    } else {
      lower = mid;
      lowerValue = midValue;
    }
  }

  return (lower + upper) / 2.0;
}

export function calculateXirrRate(
  cashFlows: readonly CashFlow[],
  guess: number = DEFAULT_GUESS,
  timeZone: string = getSystemTimeZone()
): number | null {
  const flows = cashFlows
    .filter((cf) => Number.isFinite(cf.amount) && Math.abs(cf.amount) > EPSILON)
    .slice()
    .sort((a, b) => a.dateMillis - b.dateMillis);

  if (flows.length < 2) return null;
  if (!flows.some((f) => f.amount > 0.0) || !flows.some((f) => f.amount < 0.0)) {
    return null;
  }

  const baseDay = localDateUtcMidnightMillis(flows[0].dateMillis, timeZone);
  const preparedFlows: PreparedCashFlow[] = flows.map((flow) => {
    const flowDay = localDateUtcMidnightMillis(flow.dateMillis, timeZone);
    const days = Math.round((flowDay - baseDay) / MS_PER_DAY);
    return {
      years: days / DAYS_PER_YEAR,
      amount: flow.amount,
    };
  });

  const newton = solveWithNewton(preparedFlows, guess);
  if (newton !== null) return newton;
  return solveWithBisection(preparedFlows);
}

export function calculateXirrPercentage(
  cashFlows: readonly CashFlow[],
  guess: number = DEFAULT_GUESS,
  timeZone: string = getSystemTimeZone()
): number | null {
  const xirr = calculateXirrRate(cashFlows, guess, timeZone);
  return xirr === null ? null : xirr * 100.0;
}
