import type { TaiwanHolidayCalendarSnapshot } from "@/types/market";

export interface MarketScheduleStatus {
  isTaipeiOpen: boolean;
  isNewYorkOpen: boolean;
  isAnyOpen: boolean;
}

function getZonedDateParts(
  now: Date,
  timeZone: string,
): {
  isoDate: string;
  weekday: string;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  return {
    isoDate: `${year}-${month}-${day}`,
    weekday: get("weekday"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

export function isTaipeiMarketOpen(
  now: Date = new Date(),
  holidaySnapshot?: TaiwanHolidayCalendarSnapshot | null,
): boolean {
  const parts = getZonedDateParts(now, "Asia/Taipei");
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return false;
  }
  if (holidaySnapshot?.holidays?.[parts.isoDate] === true) {
    return false;
  }
  const minutes = parts.hour * 60 + parts.minute;
  // 09:00 ~ 13:30 Taipei time
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
}

export function isNewYorkMarketOpen(now: Date = new Date()): boolean {
  const parts = getZonedDateParts(now, "America/New_York");
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return false;
  }
  const minutes = parts.hour * 60 + parts.minute;
  // 09:30 ~ 16:00 New York time (handles EST/EDT automatically)
  return minutes >= 9 * 60 + 30 && minutes <= 16 * 60;
}

export function getMarketScheduleStatus(
  now: Date = new Date(),
  holidaySnapshot?: TaiwanHolidayCalendarSnapshot | null,
): MarketScheduleStatus {
  const isTaipeiOpen = isTaipeiMarketOpen(now, holidaySnapshot);
  const isNewYorkOpen = isNewYorkMarketOpen(now);
  return {
    isTaipeiOpen,
    isNewYorkOpen,
    isAnyOpen: isTaipeiOpen || isNewYorkOpen,
  };
}

export function computeNextAlignedDelayMs(
  intervalSeconds: number,
  nowMs: number = Date.now(),
): number {
  const safeInterval = Math.max(1, Math.floor(intervalSeconds));
  const intervalMs = safeInterval * 1000;
  const remainder = nowMs % intervalMs;
  const delay = intervalMs - remainder;
  return delay < 200 ? delay + intervalMs : delay;
}

export interface RealtimePollingControllerOptions {
  getIntervalSeconds: () => number;
  getHolidaySnapshot?: () => TaiwanHolidayCalendarSnapshot | null;
  onPoll: (context: {
    reason: "startup" | "scheduled" | "manual" | "post-import";
    schedule: MarketScheduleStatus;
  }) => Promise<void> | void;
}

export class RealtimePollingController {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private isFetching = false;

  constructor(private readonly options: RealtimePollingControllerOptions) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    // Force-fetch once on startup regardless of market hours
    void this.executePoll("startup");
  }

  stop(): void {
    this.isRunning = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  async triggerManualRefresh(): Promise<void> {
    await this.executePoll("manual");
  }

  async triggerPostImportRefresh(): Promise<void> {
    await this.executePoll("post-import");
  }

  private scheduleNext(): void {
    if (!this.isRunning) return;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
    }

    const schedule = getMarketScheduleStatus(
      new Date(),
      this.options.getHolidaySnapshot?.() ?? null,
    );
    const delayMs = schedule.isAnyOpen
      ? computeNextAlignedDelayMs(this.options.getIntervalSeconds())
      : 30_000;

    this.timerId = setTimeout(() => {
      const currentSchedule = getMarketScheduleStatus(
        new Date(),
        this.options.getHolidaySnapshot?.() ?? null,
      );
      if (currentSchedule.isAnyOpen) {
        void this.executePoll("scheduled");
      } else {
        this.scheduleNext();
      }
    }, delayMs);
  }

  private async executePoll(
    reason: "startup" | "scheduled" | "manual" | "post-import",
  ): Promise<void> {
    if (this.isFetching) return;
    this.isFetching = true;
    try {
      const schedule = getMarketScheduleStatus(
        new Date(),
        this.options.getHolidaySnapshot?.() ?? null,
      );
      await this.options.onPoll({ reason, schedule });
    } finally {
      this.isFetching = false;
      if (this.isRunning) {
        this.scheduleNext();
      }
    }
  }
}
