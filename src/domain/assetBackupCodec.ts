import type {
  AssetBalanceBackup,
  AssetBalances,
  BankDeposit,
  HoldingsOrderBackup,
  HoldingsOrderData,
  Loan,
} from "@/types";

export const ASSET_BALANCE_BACKUP_FILE_NAME = "stockify_asset_balances.json";
export const ASSET_BALANCE_BACKUP_MAX_BYTES = 2 * 1024 * 1024;
export const ASSET_BALANCE_BACKUP_MAX_ROWS = 10_000;
const ASSET_BALANCE_FORMAT = "stockify.asset-balances";

export function validateAssetBalances(balances: AssetBalances): void {
  if (balances.bankDeposits.length + balances.loans.length > ASSET_BALANCE_BACKUP_MAX_ROWS) {
    throw new Error("備份筆數不可超過 10,000 筆");
  }

  const validateRows = (rows: readonly (BankDeposit | Loan)[]): number => {
    const seenIds = new Set<number>();
    let sum = 0.0;
    for (const row of rows) {
      if (!Number.isInteger(row.id) || row.id <= 0) {
        throw new Error("名稱、識別碼或金額無效；金額須為非負有限數值");
      }
      if (seenIds.has(row.id)) {
        throw new Error("備份含重複識別碼");
      }
      seenIds.add(row.id);

      if (!row.name || !row.name.trim()) {
        throw new Error("名稱、識別碼或金額無效；金額須為非負有限數值");
      }
      if (!Number.isFinite(row.amount) || row.amount < 0.0) {
        throw new Error("名稱、識別碼或金額無效；金額須為非負有限數值");
      }
      sum += row.amount;
      if (!Number.isFinite(sum)) {
        throw new Error("備份總金額超出範圍");
      }
    }
    return sum;
  };

  const depositSum = validateRows(balances.bankDeposits);
  const loanSum = validateRows(balances.loans);
  if (!Number.isFinite(depositSum + loanSum)) {
    throw new Error("備份總金額超出範圍");
  }
}

export function serializeAssetBalanceBackup(balances: AssetBalances): string {
  validateAssetBalances(balances);
  const payload: AssetBalanceBackup = {
    format: ASSET_BALANCE_FORMAT,
    version: 1,
    bankDeposits: balances.bankDeposits.map((d) => ({
      id: d.id,
      name: d.name,
      amount: d.amount,
    })),
    loans: balances.loans.map((l) => ({
      id: l.id,
      name: l.name,
      amount: l.amount,
    })),
  };
  const content = JSON.stringify(payload, null, 2);
  const byteLength = new TextEncoder().encode(content).length;
  if (byteLength > ASSET_BALANCE_BACKUP_MAX_BYTES) {
    throw new Error("存款與貸款備份不可超過 2 MB");
  }
  return content;
}

export function parseAssetBalanceBackup(input: string | Uint8Array): AssetBalances {
  let content: string;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > ASSET_BALANCE_BACKUP_MAX_BYTES) {
      throw new Error("備份檔不可超過 2 MB");
    }
    content = input;
  } else {
    if (input.length > ASSET_BALANCE_BACKUP_MAX_BYTES) {
      throw new Error("備份檔不可超過 2 MB");
    }
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      throw new Error("請選擇完整的存款與貸款備份檔");
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("請選擇完整的存款與貸款備份檔");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("請選擇完整的存款與貸款備份檔");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.format !== ASSET_BALANCE_FORMAT) {
    throw new Error("這不是存款與貸款備份檔");
  }
  if (obj.version !== 1) {
    throw new Error("不支援此備份版本");
  }
  if (!Array.isArray(obj.bankDeposits) || !Array.isArray(obj.loans)) {
    throw new Error("請選擇完整的存款與貸款備份檔");
  }

  const parseRow = (raw: unknown): BankDeposit => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("請選擇完整的存款與貸款備份檔");
    }
    const r = raw as Record<string, unknown>;
    if (
      typeof r.id !== "number" ||
      typeof r.name !== "string" ||
      typeof r.amount !== "number"
    ) {
      throw new Error("名稱、識別碼或金額無效；金額須為非負有限數值");
    }
    return { id: r.id, name: r.name, amount: r.amount };
  };

  const balances: AssetBalances = {
    bankDeposits: obj.bankDeposits.map(parseRow),
    loans: obj.loans.map(parseRow),
  };
  validateAssetBalances(balances);
  return balances;
}

export function nextAssetBalanceId(ids: readonly number[]): number {
  let max = 0;
  for (const id of ids) {
    if (id > max) max = id;
  }
  if (max < Number.MAX_SAFE_INTEGER) return max + 1;
  const used = new Set(ids);
  let candidate = 1;
  while (used.has(candidate)) candidate++;
  return candidate;
}

function sanitizeHoldingsOrder(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

export function serializeHoldingsOrderBackup(data: HoldingsOrderData): string {
  const payload: HoldingsOrderBackup = {
    version: 1,
    order: sanitizeHoldingsOrder(data.order),
    realizedOrder: sanitizeHoldingsOrder(data.realizedOrder),
  };
  return JSON.stringify(payload, null, 2);
}

export function parseHoldingsOrderBackup(input: string | Uint8Array): HoldingsOrderData {
  const raw =
    typeof input === "string"
      ? input
      : new TextDecoder("utf-8", { fatal: true }).decode(input);
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) {
    return { order: [], realizedOrder: [] };
  }
  if (text.startsWith("{")) {
    const parsed = JSON.parse(text) as Partial<HoldingsOrderBackup>;
    return {
      order: sanitizeHoldingsOrder(Array.isArray(parsed.order) ? parsed.order : []),
      realizedOrder: sanitizeHoldingsOrder(
        Array.isArray(parsed.realizedOrder) ? parsed.realizedOrder : []
      ),
    };
  }
  return {
    order: sanitizeHoldingsOrder(text.split(/\r?\n/)),
    realizedOrder: [],
  };
}
