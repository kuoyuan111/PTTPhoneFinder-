import * as cheerio from "cheerio";

import { classifyArticle, compactText, normalizeLocation } from "@/lib/classifier";
import type { Article, SearchRequest, SearchResponse } from "@/lib/types";

const PTT_BASE = "https://www.ptt.cc";
const JINA_READER_BASE = "https://r.jina.ai";
const PTTWEB_BASE = "https://www.pttweb.cc";
const REQUEST_DELAY_MS = 450;
const REQUEST_TIMEOUT_MS = 20_000;
const SEARCH_TIMEOUT_MS = 120_000;
const MAX_CANDIDATES = 40;
const CACHE_TTL_MS = 20_000;
const JINA_REQUEST_BUDGET = 18;
const JINA_LIST_PAGE_BUDGET = 8;
const READER_ROLLING_WINDOW_MS = 60_000;
const READER_ROLLING_LIMIT = 18;
const READER_COOLDOWN_MS = 30_000;
const HTML_CACHE_MAX_ENTRIES = 256;
const HTML_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const HTML_CACHE_MAX_ENTRY_BYTES = 512 * 1024;

interface CacheEntry {
  expiresAt: number;
  html: string;
  bytes: number;
}

const htmlCache = new Map<string, CacheEntry>();
let htmlCacheBytes = 0;
const readerRequestTimes: number[] = [];
let readerCooldownUntil = 0;

export class PttBoardNotFoundError extends Error {
  name = "PttBoardNotFoundError";
}

class PttNotFoundError extends Error {
  name = "PttNotFoundError";
}

class PttAccessBlockedError extends Error {
  name = "PttAccessBlockedError";
}

class PttRateLimitedError extends Error {
  name = "PttRateLimitedError";
}

class ReaderRateLimitedError extends Error {
  name = "ReaderRateLimitedError";
}

class ReaderBudgetExceededError extends Error {
  name = "ReaderBudgetExceededError";
}

class ReaderRollingLimitError extends Error {
  name = "ReaderRollingLimitError";
}

class PttTimeoutError extends Error {
  name = "PttTimeoutError";
}

class SearchTimeoutError extends Error {
  name = "SearchTimeoutError";
}

class HtmlValidationError extends Error {
  name = "HtmlValidationError";
}

class CrossOriginRedirectError extends Error {
  name = "CrossOriginRedirectError";
}

interface ReaderBudget {
  remaining: number;
}

interface ListingPage {
  articles: Article[];
  nextUrl: string | null;
}

interface BoardListing {
  board: string;
  articles: Article[];
  source: "ptt" | "jina" | "pttweb";
  nextUrl: string | null;
  warnings: string[];
}

interface ArticleFetchResult {
  article: Article;
  warnings: string[];
}

export function allocateRealtimePages(boardCount: number, requestedPages: number, pageBudget = JINA_LIST_PAGE_BUDGET): number[] {
  if (boardCount <= 0 || requestedPages <= 0 || pageBudget <= 0) return [];
  const allocation = Array<number>(boardCount).fill(0);
  let remaining = Math.min(pageBudget, boardCount * requestedPages);
  for (let page = 0; page < requestedPages && remaining > 0; page += 1) {
    for (let board = 0; board < boardCount && remaining > 0; board += 1) {
      allocation[board] += 1;
      remaining -= 1;
    }
  }
  return allocation;
}

export function toJinaReaderUrl(pttUrl: string): string {
  const target = validatePttUrl(pttUrl);
  return `${JINA_READER_BASE}/http://${target.host}${target.pathname}${target.search}`;
}

/** Test/support hook. It does not affect Jina's cross-instance quota. */
export function resetCrawlerRuntimeState(): void {
  htmlCache.clear();
  htmlCacheBytes = 0;
  readerRequestTimes.length = 0;
  readerCooldownUntil = 0;
}

function abortError(): Error {
  const error = new Error("搜尋已取消");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/\s+/g, " ").slice(0, 240);
  return String(error).replace(/\s+/g, " ").slice(0, 240);
}

function signalFailure(signal?: AbortSignal): Error {
  return signal?.reason instanceof SearchTimeoutError ? signal.reason : abortError();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signalFailure(signal);
}

async function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signalFailure(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function validateBoardName(board: string): string {
  const normalized = board.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(normalized)) throw new Error(`不合法的 PTT 看板名稱：${board}`);
  return normalized;
}

function validatePttUrl(value: string, expectedBoard?: string): URL {
  const target = new URL(value);
  if (target.origin !== PTT_BASE) throw new Error("拒絕存取非 PTT 網址");
  const match = target.pathname.match(/^\/bbs\/([A-Za-z0-9][A-Za-z0-9_-]{0,31})\/(index\d*\.html|M\.\d+\.A\.[A-Za-z0-9]+\.html)$/i);
  if (!match || (expectedBoard && match[1].toLocaleLowerCase() !== expectedBoard.toLocaleLowerCase())) {
    throw new Error("拒絕存取不合法的 PTT 路徑");
  }
  return target;
}

function pttUrl(href: string, expectedBoard?: string): string | null {
  try {
    return validatePttUrl(new URL(href, PTT_BASE).href, expectedBoard).href;
  } catch {
    return null;
  }
}

function pttArticleEpoch(url: string): number | null {
  const match = url.match(/\/bbs\/[A-Za-z0-9][A-Za-z0-9_-]{0,31}\/M\.(\d+)\./i);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

function stablePublishedAt(url: string): string {
  const epoch = pttArticleEpoch(url);
  return epoch === null ? "" : new Date(epoch * 1000).toISOString();
}

function normalizePttDate(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(?:\w{3}\s+)?(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/i);
  if (match) {
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[1].toLowerCase());
    if (month >= 0) {
      // PTT writes this timestamp as Taiwan local time. Keep the wall-clock
      // fields and explicitly annotate them as +08:00; do not depend on the
      // machine's local timezone.
      const utc = Date.UTC(Number(match[6]), month, Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]));
      return `${new Date(utc).toISOString().slice(0, 19)}+08:00`;
    }
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString();
}

function getCachedHtml(key: string): string | null {
  const entry = htmlCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    htmlCache.delete(key);
    htmlCacheBytes -= entry.bytes;
    return null;
  }
  htmlCache.delete(key);
  htmlCache.set(key, entry);
  return entry.html;
}

function cacheHtml(key: string, html: string): void {
  const bytes = html.length * 2;
  if (bytes > HTML_CACHE_MAX_ENTRY_BYTES) return;
  const previous = htmlCache.get(key);
  if (previous) htmlCacheBytes -= previous.bytes;
  htmlCache.delete(key);
  while (htmlCache.size >= HTML_CACHE_MAX_ENTRIES || htmlCacheBytes + bytes > HTML_CACHE_MAX_BYTES) {
    const oldestKey = htmlCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = htmlCache.get(oldestKey);
    htmlCache.delete(oldestKey);
    if (oldest) htmlCacheBytes -= oldest.bytes;
  }
  htmlCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, html, bytes });
  htmlCacheBytes += bytes;
}

function pruneReaderRequestTimes(now: number): void {
  while (readerRequestTimes.length && readerRequestTimes[0] <= now - READER_ROLLING_WINDOW_MS) readerRequestTimes.shift();
  while (readerRequestTimes.length > READER_ROLLING_LIMIT * 2) readerRequestTimes.shift();
}

function reserveReaderRequest(budget: ReaderBudget): void {
  const now = Date.now();
  pruneReaderRequestTimes(now);
  if (budget.remaining <= 0) throw new ReaderBudgetExceededError("本次搜尋的 Jina Reader 額度已用完，已保留目前結果");
  if (readerCooldownUntil > now) throw new ReaderRateLimitedError("Jina Reader 最近回覆 HTTP 429，程序冷卻中，已保留目前結果");
  if (readerRequestTimes.length >= READER_ROLLING_LIMIT) {
    throw new ReaderRollingLimitError("Jina Reader 程序級滾動額度已滿，已保留目前結果（僅限制本程序，其他執行個體不共享此狀態）");
  }
  budget.remaining -= 1;
  readerRequestTimes.push(now);
}

function noteReaderRateLimit(): void {
  readerCooldownUntil = Math.max(readerCooldownUntil, Date.now() + READER_COOLDOWN_MS);
}

async function fetchOriginHtml(url: string, expectedOrigin: string, label: string, signal?: AbortSignal, extraHeaders?: Record<string, string>): Promise<string> {
  throwIfAborted(signal);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new PttTimeoutError(`${label} 連線逾時`));
  }, REQUEST_TIMEOUT_MS);
  const relayAbort = () => controller.abort(signal?.reason ?? abortError());
  signal?.addEventListener("abort", relayAbort, { once: true });
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0 (compatible; PTT-Phone-Finder-Web/1.0)", ...extraHeaders },
    });
    if (timedOut) throw new PttTimeoutError(`${label} 連線逾時`);
    if (signal?.aborted) throw signalFailure(signal);
    if (response.status >= 300 && response.status < 400) throw new CrossOriginRedirectError(`${label} 回應重新導向，為安全起見未跟隨`);
    if (response.url && new URL(response.url).origin !== expectedOrigin) throw new CrossOriginRedirectError(`${label} 重新導向至非核准來源，已拒絕`);
    if (response.status === 404) throw new PttNotFoundError(`${label} 回應 HTTP 404`);
    if (response.status === 403) throw new PttAccessBlockedError(`${label} 回應 HTTP 403`);
    if (response.status === 429) throw new PttRateLimitedError(`${label} 回應 HTTP 429`);
    if (!response.ok) throw new Error(`${label} 回應 HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (timedOut) throw new PttTimeoutError(`${label} 連線逾時`);
    if (signal?.aborted) throw signalFailure(signal);
    if (error instanceof Error && error.name === "AbortError") throw new PttTimeoutError(`${label} 連線逾時`);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", relayAbort);
  }
}

async function fetchHtml(url: string, signal?: AbortSignal): Promise<string> {
  const target = validatePttUrl(url);
  const cached = getCachedHtml(target.href);
  if (cached !== null) return cached;
  const html = await fetchOriginHtml(target.href, PTT_BASE, "PTT", signal);
  cacheHtml(target.href, html);
  return html;
}

async function fetchMirrorHtml(url: string, signal?: AbortSignal): Promise<string> {
  const target = new URL(url);
  if (target.origin !== PTTWEB_BASE || !/^\/bbs\/[A-Za-z0-9][A-Za-z0-9_-]{0,31}(?:\/M\.\d+\.A\.[A-Za-z0-9]+)?$/i.test(target.pathname)) throw new Error("拒絕存取不合法的 PTTweb 路徑");
  const cached = getCachedHtml(target.href);
  if (cached !== null) return cached;
  const html = await fetchOriginHtml(target.href, PTTWEB_BASE, "PTTweb", signal);
  cacheHtml(target.href, html);
  return html;
}

async function fetchReaderHtml(url: string, budget: ReaderBudget, signal?: AbortSignal): Promise<string> {
  const target = validatePttUrl(url);
  const cacheKey = `reader:${target.href}`;
  const cached = getCachedHtml(cacheKey);
  if (cached !== null) return cached;
  reserveReaderRequest(budget);
  try {
  const html = await fetchOriginHtml(toJinaReaderUrl(target.href), JINA_READER_BASE, "Jina Reader", signal, { "X-Respond-With": "html", "X-No-Cache": "true" });
    if (!/<html[\s>]/i.test(html)) throw new HtmlValidationError("Jina Reader 未回傳 HTML");
    cacheHtml(cacheKey, html);
    return html;
  } catch (error) {
    if (error instanceof PttRateLimitedError) {
      noteReaderRateLimit();
      throw new ReaderRateLimitedError("Jina Reader 回應 HTTP 429，未重試");
    }
    throw error;
  }
}

function parseNativeBoardPage(board: string, html: string, source: "ptt" | "jina"): ListingPage {
  const $ = cheerio.load(html);
  if (!$("#main-container").length || !$("div.r-list-container").length) throw new HtmlValidationError("PTT 看板頁面結構驗證失敗，可能是挑戰頁或非看板 HTML");
  const articles: Article[] = [];
  const knownUrls = new Set<string>();
  $("div.r-ent").each((_, element) => {
    const entry = $(element);
    const anchor = entry.find("div.title a").first();
    const href = anchor.attr("href");
    const articleUrl = href ? pttUrl(href, board) : null;
    if (!articleUrl || knownUrls.has(articleUrl)) return;
    knownUrls.add(articleUrl);
    articles.push({ board, title: anchor.text().replace(/\s+/g, " ").trim(), url: articleUrl, source, author: entry.find("div.author").first().text().trim(), listDate: entry.find("div.date").first().text().trim(), publishedAt: stablePublishedAt(articleUrl), content: "" });
  });
  const previousHref = $("div.btn-group-paging a.btn").filter((_, element) => $(element).text().includes("上頁")).first().attr("href");
  return { articles, nextUrl: previousHref ? pttUrl(previousHref, board) : null };
}

function parseMirrorBoardPage(board: string, html: string): ListingPage {
  const $ = cheerio.load(html);
  if (!$(".e7-container").length && !$(".e7-main").length) throw new HtmlValidationError("PTTweb 看板頁面結構驗證失敗，可能是挑戰頁或非看板 HTML");
  const articles: Article[] = [];
  const knownUrls = new Set<string>();
  const escapedBoard = board.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const articlePath = new RegExp(`^/bbs/${escapedBoard}/(M\\.\\d+\\.A\\.[A-Za-z0-9]+)$`, "i");
  $("a[href]").each((_, element) => {
    const anchor = $(element);
    const match = (anchor.attr("href") ?? "").match(articlePath);
    if (!match) return;
    const articleUrl = pttUrl(`${PTT_BASE}/bbs/${encodeURIComponent(board)}/${match[1]}.html`, board);
    if (!articleUrl || knownUrls.has(articleUrl)) return;
    const desktopTitle = anchor.find(".e7-show-if-device-is-not-xs span").first().text();
    const title = (desktopTitle || anchor.find(".e7-title").first().text() || anchor.text()).replace(/\s+/g, " ").trim();
    if (!title) return;
    const container = anchor.closest(".e7-container");
    const author = container.find('a[href^="https://www.pttweb.cc/user/"] span').first().text().trim();
    const listDate = container.find(".e7-meta-container .e7-grey-text").first().text().replace(/\s+/g, " ").trim();
    knownUrls.add(articleUrl);
    articles.push({ board, title, url: articleUrl, source: "pttweb", author, listDate, publishedAt: stablePublishedAt(articleUrl), content: "" });
  });
  if (!articles.length) throw new PttBoardNotFoundError("PTTweb 看板不存在，或暫無可用文章");
  return { articles, nextUrl: null };
}

async function fetchBoardPage(board: string, url: string, source: "ptt" | "jina" | "pttweb", budget: ReaderBudget, signal?: AbortSignal): Promise<ListingPage> {
  if (source === "ptt") return parseNativeBoardPage(board, await fetchHtml(url, signal), "ptt");
  if (source === "jina") return parseNativeBoardPage(board, await fetchReaderHtml(url, budget, signal), "jina");
  return parseMirrorBoardPage(board, await fetchMirrorHtml(`${PTTWEB_BASE}/bbs/${encodeURIComponent(board)}`, signal));
}

function isFallbackEligible(error: unknown): boolean {
  return !(error instanceof PttNotFoundError) && !isAbortError(error) && !(error instanceof SearchTimeoutError);
}

function isReaderQuotaFailure(error: unknown): boolean {
  return error instanceof ReaderRateLimitedError || error instanceof ReaderBudgetExceededError || error instanceof ReaderRollingLimitError;
}

function sourceFailureLabel(source: "ptt" | "jina" | "pttweb", error: unknown): string {
  const sourceName = source === "ptt" ? "PTT 直連" : source === "jina" ? "Jina Reader" : "PTTweb 鏡像";
  if (error instanceof PttTimeoutError) return `${sourceName}逾時`;
  if (error instanceof PttAccessBlockedError) return `${sourceName}遭拒（403）`;
  if (error instanceof PttRateLimitedError || error instanceof ReaderRateLimitedError) return `${sourceName}達到流量限制`;
  if (error instanceof ReaderBudgetExceededError || error instanceof ReaderRollingLimitError) return `${sourceName}額度不足`;
  return `${sourceName}失敗：${safeMessage(error)}`;
}

async function fetchBoardLatest(board: string, realtimePages: number, budget: ReaderBudget, signal?: AbortSignal): Promise<BoardListing> {
  const latestUrl = `${PTT_BASE}/bbs/${encodeURIComponent(board)}/index.html`;
  const warnings: string[] = [];
  try {
    const page = await fetchBoardPage(board, latestUrl, "ptt", budget, signal);
    return { board, articles: page.articles, source: "ptt", nextUrl: page.nextUrl, warnings };
  } catch (nativeError) {
    if (nativeError instanceof PttNotFoundError) throw new PttBoardNotFoundError(`${board} 看板不存在或已刪除（HTTP 404）`);
    if (isAbortError(nativeError) || nativeError instanceof SearchTimeoutError) throw nativeError;
    warnings.push(`[${board}] ${sourceFailureLabel("ptt", nativeError)}`);
    if (realtimePages > 0 && isFallbackEligible(nativeError)) {
      try {
        const page = await fetchBoardPage(board, latestUrl, "jina", budget, signal);
        warnings.push(`[${board}] 看板最新頁已改用 Jina Reader。`);
        return { board, articles: page.articles, source: "jina", nextUrl: page.nextUrl, warnings };
      } catch (readerError) {
        if (readerError instanceof PttNotFoundError) throw new PttBoardNotFoundError(`${board} 看板不存在或已刪除（HTTP 404）`);
        if (isAbortError(readerError) || readerError instanceof SearchTimeoutError) throw readerError;
        warnings.push(`[${board}] ${sourceFailureLabel("jina", readerError)}`);
        if (isReaderQuotaFailure(readerError)) {
          return { board, articles: [], source: "jina", nextUrl: null, warnings };
        }
      }
    }
    try {
      const page = await fetchBoardPage(board, latestUrl, "pttweb", budget, signal);
      warnings.push(`[${board}] 看板已改用可能延遲的 PTTweb 鏡像。`);
      return { board, articles: page.articles, source: "pttweb", nextUrl: null, warnings };
    } catch (mirrorError) {
      if (mirrorError instanceof PttNotFoundError) throw new PttBoardNotFoundError(`${board} 看板不存在或已刪除，未使用舊鏡像資料`);
      if (isAbortError(mirrorError) || mirrorError instanceof SearchTimeoutError) throw mirrorError;
      warnings.push(`[${board}] ${sourceFailureLabel("pttweb", mirrorError)}`);
      return { board, articles: [], source: "pttweb", nextUrl: null, warnings };
    }
  }
}

async function fetchOlderBoardPages(listing: BoardListing, pages: number, budget: ReaderBudget, signal?: AbortSignal): Promise<void> {
  let nextUrl = listing.nextUrl;
  for (let pageIndex = 1; pageIndex < pages && nextUrl; pageIndex += 1) {
    try {
      const page = await fetchBoardPage(listing.board, nextUrl, listing.source, budget, signal);
      listing.articles.push(...page.articles);
      nextUrl = page.nextUrl;
      if (nextUrl) await sleep(REQUEST_DELAY_MS, signal);
    } catch (error) {
      if (isAbortError(error) || error instanceof SearchTimeoutError) throw error;
      if (error instanceof PttNotFoundError) listing.warnings.push(`[${listing.board}] 較舊列表頁回應 404，未改用可能過時的鏡像資料。`);
      else listing.warnings.push(`[${listing.board}] 第 ${pageIndex + 1} 頁列表未完成：${sourceFailureLabel(listing.source, error)}`);
      break;
    }
  }
}

async function fetchMirrorArticle(article: Article, signal?: AbortSignal): Promise<Article> {
  const sourceUrl = validatePttUrl(article.url, article.board);
  const html = await fetchMirrorHtml(`${PTTWEB_BASE}${sourceUrl.pathname.replace(/\.html$/i, "")}`, signal);
  const $ = cheerio.load(html);
  const main = $(".e7-main-content").first().clone();
  if (!main.length) throw new HtmlValidationError("找不到 PTTweb 文章結構");
  main.find(".e7-recommend-container, script, style").remove();
  const mainText = main.text().replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const description = $("meta[property=\"og:description\"]").attr("content")?.trim() ?? "";
  const content = (mainText || description).slice(0, 18_000);
  if (!content) throw new HtmlValidationError("找不到文章內容，PTTweb HTML 結構可能已變更");
  await sleep(REQUEST_DELAY_MS, signal);
  return { ...article, source: "pttweb", publishedAt: stablePublishedAt(article.url) || article.publishedAt, content };
}

function parseNativeArticleHtml(article: Article, html: string, source: "ptt" | "jina"): Article {
  const $ = cheerio.load(html);
  const main = $("#main-content").first();
  if (!main.length) throw new HtmlValidationError("找不到文章內容，可能是挑戰頁或非 PTT 文章 HTML");
  const metadata = new Map<string, string>();
  main.find(".article-metaline").each((_, element) => {
    const tag = $(element).find(".article-meta-tag").first().text().replace(/[：:]$/, "").trim();
    const value = $(element).find(".article-meta-value").first().text().replace(/\s+/g, " ").trim();
    if (tag && value) metadata.set(tag, value);
  });
  const fallbackValues = main.find(".article-meta-value").map((_, element) => $(element).text().replace(/\s+/g, " ").trim()).get();
  if (metadata.size < 3 && fallbackValues.length < 4) throw new HtmlValidationError("PTT 文章 metadata 結構驗證失敗");
  const author = metadata.get("作者") || fallbackValues[0] || article.author;
  const title = metadata.get("標題") || fallbackValues[2] || fallbackValues[1] || article.title;
  const dateValue = metadata.get("時間") || fallbackValues[3] || "";
  const publishedAt = normalizePttDate(dateValue) || stablePublishedAt(article.url) || article.publishedAt;
  main.find(".push, .article-metaline, .article-metaline-right").remove();
  main.find("br").replaceWith("\n");
  const rawText = main.text().replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const [body, signature = ""] = rawText.split("※ 發信站:", 2);
  const edits = [...signature.matchAll(/※\s*編輯:[^\n]+/g)].map((match) => match[0]);
  const content = `${body.trim()}${edits.length ? `\n${edits.join("\n")}` : ""}`.slice(0, 18_000);
  if (!content) throw new HtmlValidationError("PTT 文章內容為空，可能是挑戰頁或已移除文章");
  return { ...article, source, title, author, publishedAt, content };
}

async function fetchArticle(article: Article, budget: ReaderBudget, signal?: AbortSignal): Promise<ArticleFetchResult> {
  if (article.source === "pttweb") return { article: await fetchMirrorArticle(article, signal), warnings: [] };
  const warnings: string[] = [];
  const directSource = article.source === "jina" ? "jina" : "ptt";
  try {
    const html = directSource === "jina" ? await fetchReaderHtml(article.url, budget, signal) : await fetchHtml(article.url, signal);
    const parsed = parseNativeArticleHtml(article, html, directSource);
    await sleep(REQUEST_DELAY_MS, signal);
    return { article: parsed, warnings };
  } catch (directError) {
    if (isAbortError(directError) || directError instanceof SearchTimeoutError) throw directError;
    if (directError instanceof PttNotFoundError) throw directError;
    if (isReaderQuotaFailure(directError)) throw directError;
    warnings.push(sourceFailureLabel(directSource, directError));
  }
  if (directSource === "ptt") {
    try {
      const html = await fetchReaderHtml(article.url, budget, signal);
      const parsed = parseNativeArticleHtml(article, html, "jina");
      warnings.push("文章已改用 Jina Reader。");
      await sleep(REQUEST_DELAY_MS, signal);
      return { article: parsed, warnings };
    } catch (readerError) {
      if (isAbortError(readerError) || readerError instanceof SearchTimeoutError) throw readerError;
      if (readerError instanceof PttNotFoundError) throw readerError;
      warnings.push(sourceFailureLabel("jina", readerError));
      if (isReaderQuotaFailure(readerError)) throw new Error(`${warnings.join("；")}；Jina Reader 額度或冷卻限制，未使用延遲鏡像`);
    }
  }
  try {
    const mirrored = await fetchMirrorArticle(article, signal);
    warnings.push("文章已改用 PTTweb 鏡像，內容可能延遲；HTTP 404 不會使用鏡像復活文章。");
    return { article: mirrored, warnings };
  } catch (mirrorError) {
    if (isAbortError(mirrorError) || mirrorError instanceof SearchTimeoutError) throw mirrorError;
    if (mirrorError instanceof PttNotFoundError) throw mirrorError;
    throw new Error(`${warnings.join("；")}；${sourceFailureLabel("pttweb", mirrorError)}`);
  }
}

function titleMatches(title: string, keywords: string[]): boolean {
  const compactTitle = compactText(title);
  return keywords.some((keyword) => compactText(keyword).length > 0 && compactTitle.includes(compactText(keyword)));
}

const SALE_TAGS = new Set(["賣", "售", "出售", "販售", "二手", "交易", "售出", "已售", "已售出"]);
const NON_SALE_TAGS = new Set(["徵", "徵求", "求購", "收購", "收", "交換", "討論", "新聞", "公告", "情報", "心得", "問題", "請益", "開箱", "閒聊", "問卦"]);

export function looksLikeSale(title: string): boolean {
  const normalized = title.replace(/[［【]/g, "[").replace(/[］】]/g, "]").replace(/\s+/g, "");
  const leadingTags = [...normalized.matchAll(/^\[([^\]]+)\]/g)].map((match) => match[1].toLocaleLowerCase());
  if (leadingTags.some((tag) => NON_SALE_TAGS.has(tag))) return false;
  if (leadingTags.some((tag) => SALE_TAGS.has(tag))) return true;
  if (/\b(?:news|discussion|wanted|lookingfor)\b/i.test(normalized)) return false;
  return !/(?:新聞|討論|公告|徵求|求購|收購|交換)/.test(normalized);
}

function sortNewestFirst(articles: Article[]): Article[] {
  return articles.map((article, index) => ({ article, index, epoch: pttArticleEpoch(article.url) ?? -1 })).sort((left, right) => right.epoch - left.epoch || left.index - right.index).map(({ article }) => article);
}

function dedupeBoards(boards: string[]): string[] {
  const seen = new Set<string>();
  return boards.map(validateBoardName).filter((board) => {
    const key = board.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateKeywords(keywords: string[]): void {
  if (!keywords.some((keyword) => compactText(keyword).length > 0)) throw new Error("至少需要一個有效的關鍵字，不能只有標點符號");
}

export async function searchPtt(options: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
  throwIfAborted(signal);
  const startedAt = Date.now();
  const results: SearchResponse["results"] = [];
  const warnings: string[] = [];
  const readerBudget: ReaderBudget = { remaining: JINA_REQUEST_BUDGET };
  const boards = dedupeBoards(options.boards);
  validateKeywords(options.keywords);
  const realtimePages = allocateRealtimePages(boards.length, options.pages);
  if (!boards.length) return { results, candidateCount: 0, elapsedMs: 0, warnings: ["至少需要一個 PTT 看板"] };
  const searchController = new AbortController();
  const timeoutReason = new SearchTimeoutError("搜尋已達 120 秒上限，已回傳目前累積結果");
  const timer = setTimeout(() => searchController.abort(timeoutReason), SEARCH_TIMEOUT_MS);
  const relayAbort = () => searchController.abort(abortError());
  signal?.addEventListener("abort", relayAbort, { once: true });
  const listings: BoardListing[] = [];
  let candidateCount = 0;
  try {
    // Phase 1: every board's latest page is collected before any older page or article detail.
    for (const [boardIndex, board] of boards.entries()) {
      try {
        const listing = await fetchBoardLatest(board, realtimePages[boardIndex] ?? 0, readerBudget, searchController.signal);
        listings.push(listing);
        warnings.push(...listing.warnings);
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (error instanceof SearchTimeoutError) {
          warnings.push(error.message);
          break;
        }
        warnings.push(`[${board}] ${safeMessage(error)}`);
      }
    }
    // Phase 2: only after all latest pages have been attempted, walk older pages.
    if (!searchController.signal.aborted) {
      for (const listing of listings) {
        if (options.pages <= 1 || listing.source === "pttweb") continue;
        const boardIndex = boards.indexOf(listing.board);
        const allowedPages = listing.source === "jina" ? Math.min(options.pages, realtimePages[boardIndex] ?? 1) : options.pages;
        try {
          await fetchOlderBoardPages(listing, allowedPages, readerBudget, searchController.signal);
        } catch (error) {
          if (isAbortError(error)) throw error;
          if (error instanceof SearchTimeoutError) {
            warnings.push(error.message);
            break;
          }
          warnings.push(`[${listing.board}] ${safeMessage(error)}`);
        }
        warnings.push(...listing.warnings.splice(0));
      }
    } else if (searchController.signal.reason instanceof SearchTimeoutError) {
      warnings.push(timeoutReason.message);
    }
    const seenCandidateUrls = new Set<string>();
    const candidates = sortNewestFirst(
      listings
        .flatMap((listing) => listing.articles)
        .filter((article) => {
          if (seenCandidateUrls.has(article.url)) return false;
          seenCandidateUrls.add(article.url);
          return titleMatches(article.title, options.keywords) && looksLikeSale(article.title);
        }),
    );
    candidateCount = candidates.length;
    if (candidates.length > MAX_CANDIDATES) warnings.push(`候選文章超過 ${MAX_CANDIDATES} 篇，已優先處理 PTT URL 時間戳最新的文章。`);
    const locations = new Set(options.locations.map(normalizeLocation));
    for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
      if (searchController.signal.aborted) {
        if (signal?.aborted) throw abortError();
        warnings.push(timeoutReason.message);
        break;
      }
      try {
        const fetched = await fetchArticle(candidate, readerBudget, searchController.signal);
        if (fetched.warnings.length) warnings.push(`[${candidate.board}] ${candidate.title}：${fetched.warnings.join("；")}`);
        const result = classifyArticle(fetched.article, options.keywords);
        if (!options.includeSold && result.sold) continue;
        if (options.maxBudget !== null && result.price !== null && result.price > options.maxBudget) continue;
        if (locations.size && !result.locations.some((location) => locations.has(normalizeLocation(location)))) continue;
        results.push(result);
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (error instanceof SearchTimeoutError) {
          warnings.push(timeoutReason.message);
          break;
        }
        if (warnings.length < 24) warnings.push(`[${candidate.board}] ${candidate.title}：${safeMessage(error)}`);
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relayAbort);
  }
  return { results, candidateCount, elapsedMs: Date.now() - startedAt, warnings: [...new Set(warnings)] };
}
