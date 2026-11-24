import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { calculatePerformanceCalendar } from "@/domain";
import {
  formatCompactAmount,
  formatSignedHomeAmount,
  formatSignedPercent,
  plColorClass,
} from "@/features/holdings/formatters";
import { cn } from "@/lib/utils";
import { HomeDisplayMode, type PersonalHistoryPoint } from "@/types";

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const;

interface PerformanceCalendarSectionProps {
  points: readonly PersonalHistoryPoint[];
  displayMode?: HomeDisplayMode | string;
}

export function PerformanceCalendarSection({
  points,
  displayMode = HomeDisplayMode.COMBINED,
}: PerformanceCalendarSectionProps) {
  const calendar = useMemo(() => calculatePerformanceCalendar(points), [points]);
  const months = calendar.monthly;

  const [selectedYearMonth, setSelectedYearMonth] = useState<string>(() =>
    months.length > 0 ? months[months.length - 1].yearMonth : "",
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    if (months.length === 0) {
      setSelectedYearMonth("");
      return;
    }
    if (!months.some((m) => m.yearMonth === selectedYearMonth)) {
      setSelectedYearMonth(months[months.length - 1].yearMonth);
    }
  }, [months, selectedYearMonth]);

  const currentMonthIndex = useMemo(
    () => months.findIndex((m) => m.yearMonth === selectedYearMonth),
    [months, selectedYearMonth],
  );
  const activeMonth =
    currentMonthIndex >= 0
      ? months[currentMonthIndex]
      : months[months.length - 1] ?? null;

  useEffect(() => {
    if (!activeMonth) {
      setSelectedDate(null);
      return;
    }
    if (
      !selectedDate ||
      !activeMonth.dailyItems.some((d) => d.date === selectedDate)
    ) {
      const last = activeMonth.dailyItems[activeMonth.dailyItems.length - 1];
      setSelectedDate(last?.date ?? null);
    }
  }, [activeMonth, selectedDate]);

  const dailyByDate = useMemo(() => {
    const map = new Map<string, (typeof calendar.daily)[number]>();
    if (activeMonth) {
      for (const item of activeMonth.dailyItems) {
        map.set(item.date, item);
      }
    }
    return map;
  }, [activeMonth, calendar]);

  const calendarCells = useMemo(() => {
    if (!activeMonth) return [];
    const [yStr, mStr] = activeMonth.yearMonth.split("-");
    const year = Number(yStr);
    const month = Number(mStr);
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    const cells: Array<{
      key: string;
      dayNumber: number | null;
      date: string | null;
    }> = [];

    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ key: `pad-${i}`, dayNumber: null, date: null });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${yStr}-${mStr}-${String(day).padStart(2, "0")}`;
      cells.push({ key: iso, dayNumber: day, date: iso });
    }
    return cells;
  }, [activeMonth]);

  const barData = useMemo(
    () =>
      (activeMonth?.dailyItems ?? []).map((item) => ({
        date: item.date,
        dayLabel: item.date.slice(8, 10),
        profitLoss: item.profitLoss,
        returnPercentage: item.returnPercentage,
      })),
    [activeMonth],
  );

  if (!activeMonth) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        尚無足夠的歷史點位可計算報酬日曆
      </div>
    );
  }

  const displayYearMonth = activeMonth.yearMonth.replace("-", "/");
  const selectedDaily = selectedDate ? dailyByDate.get(selectedDate) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={currentMonthIndex <= 0}
            onClick={() => {
              if (currentMonthIndex > 0) {
                setSelectedYearMonth(months[currentMonthIndex - 1].yearMonth);
              }
            }}
            aria-label="上個月"
            className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[4.5rem] text-center text-sm font-semibold tabular-nums">
            {displayYearMonth}
          </span>
          <button
            type="button"
            disabled={currentMonthIndex < 0 || currentMonthIndex >= months.length - 1}
            onClick={() => {
              if (currentMonthIndex >= 0 && currentMonthIndex < months.length - 1) {
                setSelectedYearMonth(months[currentMonthIndex + 1].yearMonth);
              }
            }}
            aria-label="下個月"
            className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs sm:text-sm">
          <span className="text-muted-foreground">{displayYearMonth} 報酬</span>
          <span className={cn("font-semibold tabular-nums", plColorClass(activeMonth.profitLoss))}>
            {formatSignedHomeAmount(activeMonth.profitLoss, displayMode)}
          </span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-xs font-medium tabular-nums",
              activeMonth.returnPercentage > 0
                ? "bg-stock-gain/10 text-stock-gain"
                : activeMonth.returnPercentage < 0
                  ? "bg-stock-loss/10 text-stock-loss"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {formatSignedPercent(activeMonth.returnPercentage)}
          </span>
        </div>
      </div>

      {/* 7-column calendar grid */}
      <div className="space-y-1">
        <div className="grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="py-1">
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {calendarCells.map((cell) => {
            if (!cell.date || cell.dayNumber === null) {
              return <div key={cell.key} className="min-h-[3.25rem]" />;
            }
            const daily = dailyByDate.get(cell.date);
            const isSelected = selectedDate === cell.date;
            return (
              <button
                key={cell.key}
                type="button"
                disabled={!daily}
                onClick={() => daily && setSelectedDate(cell.date)}
                className={cn(
                  "flex min-h-[3.25rem] flex-col items-center justify-between rounded-md border p-1 text-center transition-colors",
                  daily
                    ? "cursor-pointer hover:bg-muted/60"
                    : "cursor-default border-transparent bg-muted/20 opacity-50",
                  isSelected && "border-primary bg-primary/5 ring-1 ring-primary",
                )}
              >
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {cell.dayNumber}
                </span>
                {daily ? (
                  <>
                    <span
                      className={cn(
                        "whitespace-nowrap text-[10px] font-semibold leading-tight tabular-nums",
                        plColorClass(daily.profitLoss),
                      )}
                    >
                      {formatCompactAmount(daily.profitLoss)}
                    </span>
                    <span
                      className={cn(
                        "whitespace-nowrap text-[9px] leading-tight tabular-nums",
                        plColorClass(daily.returnPercentage),
                      )}
                    >
                      {formatSignedPercent(daily.returnPercentage)}
                    </span>
                  </>
                ) : (
                  <span className="text-[10px] text-muted-foreground/40">-</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Synced interactive PerformanceBarChart */}
      {barData.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>每日損益柱狀圖</span>
            {selectedDaily && (
              <span className="tabular-nums">
                {selectedDaily.date}：
                <strong className={plColorClass(selectedDaily.profitLoss)}>
                  {formatSignedHomeAmount(selectedDaily.profitLoss, displayMode)} (
                  {formatSignedPercent(selectedDaily.returnPercentage)})
                </strong>
              </span>
            )}
          </div>
          <div className="h-36 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barData}
                margin={{ top: 6, right: 4, left: 4, bottom: 0 }}
                onClick={(state) => {
                  const clicked = state?.activePayload?.[0]?.payload as
                    | { date?: string }
                    | undefined;
                  if (clicked?.date) {
                    setSelectedDate(clicked.date);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.2} />
                <XAxis
                  dataKey="dayLabel"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis hide />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.5} />
                <Tooltip
                  formatter={(value: number) => [
                    formatSignedHomeAmount(value, displayMode),
                    "當日損益",
                  ]}
                  labelFormatter={(_label, payload) => {
                    const row = payload?.[0]?.payload as { date?: string } | undefined;
                    return row?.date ?? "";
                  }}
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "0.5rem",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="profitLoss" radius={[2, 2, 0, 0]}>
                  {barData.map((entry) => {
                    const isPos = entry.profitLoss >= 0;
                    const isDimmed = selectedDate !== null && selectedDate !== entry.date;
                    return (
                      <Cell
                        key={entry.date}
                        cursor="pointer"
                        fill={
                          isPos
                            ? "hsl(var(--stock-gain))"
                            : "hsl(var(--stock-loss))"
                        }
                        fillOpacity={isDimmed ? 0.45 : 0.95}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
