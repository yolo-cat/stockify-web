export class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}

export const sharedHttpSemaphore = new Semaphore(3);

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

export function stripHtmlTags(html: string): string {
  let text = html;
  let prev: string;
  do {
    prev = text;
    text = text.replace(/<[^>]*>/g, "");
  } while (text !== prev);
  return text.replace(/[<>]/g, "").trim();
}

export function parseFiniteNumber(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const cleaned = raw.replace(/[$,%\s]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "--" || cleaned === "N/A") {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function isCertificateError(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("certificate") ||
    message.includes("tls") ||
    message.includes("ssl") ||
    message.includes("x509")
  );
}

export interface FetchTextResult {
  ok: boolean;
  status: number;
  text: string;
  certificateFailure: boolean;
  error?: string;
}

export async function fetchTextWithRetry(
  url: string,
  init: RequestInit = {},
  options: {
    timeoutMs?: number;
    semaphore?: Semaphore;
    decodeBig5?: boolean;
    retryDelayMs?: number;
  } = {},
): Promise<FetchTextResult> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const semaphore = options.semaphore ?? sharedHttpSemaphore;
  const retryDelayMs = options.retryDelayMs ?? 250;

  return semaphore.run(async () => {
    let lastError = "";
    let certificateFailure = false;

    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          ...init,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status >= 500 && attempt === 0) {
          lastError = `HTTP ${res.status}`;
          await sleep(retryDelayMs);
          continue;
        }

        if (!res.ok) {
          return {
            ok: false,
            status: res.status,
            text: "",
            certificateFailure: false,
            error: `HTTP ${res.status}`,
          };
        }

        let text: string;
        if (options.decodeBig5) {
          const buffer = await res.arrayBuffer();
          text = new TextDecoder("big5").decode(buffer);
        } else {
          text = await res.text();
        }

        return {
          ok: true,
          status: res.status,
          text,
          certificateFailure: false,
        };
      } catch (err) {
        clearTimeout(timer);
        if (isCertificateError(err)) {
          certificateFailure = true;
        }
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt === 0 && !certificateFailure) {
          await sleep(retryDelayMs);
          continue;
        }
      }
    }

    return {
      ok: false,
      status: 0,
      text: "",
      certificateFailure,
      error: lastError || "Network error",
    };
  });
}
