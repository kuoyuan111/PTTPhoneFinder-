import { articleTimestamp } from "./article-time";
import { validSearchKeyword } from "./search-validation";
import type { SearchResponse, SearchResult } from "./types";

export { validSearchKeyword } from "./search-validation";

export type SortKey = "board" | "publishedAt" | "model" | "storage" | "price" | "color" | "soldStatus" | "locations" | "title";
export type SortState = { key: SortKey; direction: "asc" | "desc" };
export const DEFAULT_SORT: SortState = { key: "publishedAt", direction: "desc" };
export const DEFAULT_KEYWORD = "iPhone 17 Pro Max";

export interface CommonModelGroup {
  readonly group: string;
  readonly models: readonly string[];
}

export const COMMON_IPHONE_MODELS: readonly CommonModelGroup[] = [
  {
    group: "iPhone 18 系列",
    models: [
      "iPhone 18 Pro Max",
      "iPhone 18 Pro",
      "iPhone 18 Plus",
      "iPhone 18",
    ],
  },
  {
    group: "iPhone 17 系列",
    models: [
      "iPhone 17 Pro Max",
      "iPhone 17 Pro",
      "iPhone 17 Air",
      "iPhone 17",
    ],
  },
  {
    group: "iPhone 16 系列",
    models: [
      "iPhone 16 Pro Max",
      "iPhone 16 Pro",
      "iPhone 16 Plus",
      "iPhone 16",
    ],
  },
  {
    group: "iPhone 15 系列",
    models: [
      "iPhone 15 Pro Max",
      "iPhone 15 Pro",
      "iPhone 15 Plus",
      "iPhone 15",
    ],
  },
  {
    group: "iPhone 14 / 13 / SE 系列",
    models: [
      "iPhone 14 Pro Max",
      "iPhone 14 Pro",
      "iPhone 14",
      "iPhone 13 Pro",
      "iPhone 13",
      "iPhone SE",
    ],
  },
] as const;

export function appendKeyword(current: string, next: string): string {
  const trimmedNext = next.trim();
  if (!trimmedNext) return current;
  const existing = current
    .split(/[,，;；\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (existing.includes(trimmedNext)) return current;
  return current.trim() ? `${current.trim()}, ${trimmedNext}` : trimmedNext;
}

export function validBoardName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(value);
}

export function validKeyword(value: string): boolean {
  return validSearchKeyword(value);
}

export function compareResults(left: SearchResult, right: SearchResult, sort: SortState): number {
  const key = sort.key;
  if (key === "publishedAt" || key === "price") {
    const a = key === "price" ? left.price : articleTimestamp(left.publishedAt, left.url);
    const b = key === "price" ? right.price : articleTimestamp(right.publishedAt, right.url);
    if (a === null || b === null) {
      if (a === null && b === null) return left.url.localeCompare(right.url);
      return a === null ? 1 : -1;
    }
    return (sort.direction === "asc" ? a - b : b - a) || left.url.localeCompare(right.url);
  }
  const a = key === "locations" ? left.locations.join("、") : left[key];
  const b = key === "locations" ? right.locations.join("、") : right[key];
  const comparison = a.localeCompare(b, "zh-Hant", { numeric: true });
  return (sort.direction === "asc" ? comparison : -comparison) || left.url.localeCompare(right.url);
}

/** The returned row order is shared by the table and Excel download. */
export function selectVisibleResults(results: SearchResult[], filterText: string, sort: SortState): SearchResult[] {
  const filter = filterText.trim().toLocaleLowerCase();
  return results.filter((result) => !filter || [
    result.board, result.title, result.model, result.storage, result.color,
    result.locations.join(" "), result.condition,
  ].join(" ").toLocaleLowerCase().includes(filter)).sort((a, b) => compareResults(a, b, sort));
}

type SearchPhase = "idle" | "searching" | "completed" | "failed" | "stopped";
export type SearchView = SearchResponse & { phase: SearchPhase; status: string; error: string };
export function emptySearchView(): SearchView {
  return {
    results: [], warnings: [], candidateCount: 0, elapsedMs: 0, phase: "idle", error: "",
    status: "設定搜尋條件後，按下開始搜尋。",
  };
}

type SearchAction =
  | { type: "start"; boardCount: number }
  | { type: "complete"; data: SearchResponse }
  | { type: "fail"; error: string }
  | { type: "error"; error: string }
  | { type: "stop" | "clear" };

export function searchViewReducer(state: SearchView, action: SearchAction): SearchView {
  switch (action.type) {
    case "start": return { ...emptySearchView(), phase: "searching", status: `正在搜尋 ${action.boardCount} 個看板，請稍候…` };
    case "complete": return {
      ...emptySearchView(), ...action.data, phase: "completed",
      status: `搜尋完成：${action.data.candidateCount} 篇候選文章，顯示 ${action.data.results.length} 筆結果，耗時 ${(action.data.elapsedMs / 1000).toFixed(1)} 秒。`,
    };
    case "fail": return { ...emptySearchView(), phase: "failed", error: action.error, status: "搜尋失敗，請檢查下方訊息。" };
    case "error": return { ...state, error: action.error };
    case "stop": return { ...emptySearchView(), phase: "stopped", status: "搜尋已停止。" };
    case "clear": return emptySearchView();
  }
}

export function emptyResultsMessage(phase: SearchPhase, total: number): string {
  if (phase === "searching") return "正在搜尋 PTT…";
  if (total > 0) return "目前篩選條件沒有結果。";
  if (phase === "completed") return "本次搜尋完成，但沒有符合條件的結果。";
  if (phase === "failed") return "搜尋失敗，目前沒有可顯示的結果。";
  if (phase === "stopped") return "搜尋已停止，目前沒有可顯示的結果。";
  return "尚未搜尋，結果會顯示在這裡。";
}

/** Cancellation invalidates identity immediately, even if fetch ignores abort. */
export function createSearchRequestGate() {
  let active: AbortController | null = null;
  const cancel = () => {
    const previous = active;
    active = null;
    previous?.abort();
  };
  return {
    cancel,
    start() { cancel(); active = new AbortController(); return active; },
    isCurrent(controller: AbortController) { return active === controller && !controller.signal.aborted; },
    finish(controller: AbortController) {
      if (active !== controller) return false;
      active = null;
      return true;
    },
  };
}
