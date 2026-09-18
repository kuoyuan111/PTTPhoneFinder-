import * as cheerio from "cheerio";

import { classifyArticle, compactText, normalizeLocation } from "@/lib/classifier";
import type { Article, SearchRequest, SearchResponse } from "@/lib/types";

const PTT_BASE = "https://www.ptt.cc";
const PTTWEB_BASE = "https://www.pttweb.cc";
const REQUEST_DELAY_MS = 450;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_CANDIDATES = 40;
const CACHE_TTL_MS = 60_000;

const htmlCache = new Map<string, { expiresAt: number; html: string }>();

export class PttBoardNotFoundError extends Error {}
class PttAccessBlockedError extends Error {}

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

async function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchHtml(url: string, signal?: AbortSignal): Promise<string> {
  const target = new URL(url);
  if (target.origin !== PTT_BASE) throw new Error("拒絕存取非 PTT 網址");

  const cached = htmlCache.get(target.href);
  if (cached && cached.expiresAt > Date.now()) return cached.html;

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("PTT 連線逾時")), REQUEST_TIMEOUT_MS);
    const relayAbort = () => controller.abort(abortError());
    signal?.addEventListener("abort", relayAbort, { once: true });
    try {
      const response = await fetch(target, {
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          Cookie: "over18=1",
          "User-Agent":
            "Mozilla/5.0 (compatible; PTT-Phone-Finder-Web/1.0; +https://github.com/kuoyuan111/PTTPhoneFinder-)",
        },
      });
      if (response.status === 404) throw new PttBoardNotFoundError("看板或文章不存在（HTTP 404）");
      if (response.status === 403) throw new PttAccessBlockedError("PTT 封鎖目前的雲端出口（HTTP 403）");
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < 2) {
          await sleep(300 * 2 ** attempt, signal);
          continue;
        }
        throw new Error(`PTT 回應 HTTP ${response.status}`);
      }
      const html = await response.text();
      htmlCache.set(target.href, { expiresAt: Date.now() + CACHE_TTL_MS, html });
      return html;
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw abortError();
      if (error instanceof PttBoardNotFoundError) throw error;
      if (error instanceof PttAccessBlockedError) throw error;
      lastError = error;
      if (attempt < 2) await sleep(300 * 2 ** attempt, signal);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", relayAbort);
    }
  }
  throw new Error(`PTT 連線失敗：${safeMessage(lastError)}`);
}

async function fetchMirrorHtml(url: string, signal?: AbortSignal): Promise<string> {
  const target = new URL(url);
  if (target.origin !== PTTWEB_BASE) throw new Error("拒絕存取非 PTTweb 網址");

  const cached = htmlCache.get(target.href);
  if (cached && cached.expiresAt > Date.now()) return cached.html;

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("PTTweb 連線逾時")), REQUEST_TIMEOUT_MS);
    const relayAbort = () => controller.abort(abortError());
    signal?.addEventListener("abort", relayAbort, { once: true });
    try {
      const response = await fetch(target, {
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent":
            "Mozilla/5.0 (compatible; PTT-Phone-Finder-Web/1.0; +https://github.com/kuoyuan111/PTTPhoneFinder-)",
        },
      });
      if (response.status === 404) throw new PttBoardNotFoundError("看板或文章不存在（HTTP 404）");
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < 2) {
          await sleep(300 * 2 ** attempt, signal);
          continue;
        }
        throw new Error(`PTTweb 回應 HTTP ${response.status}`);
      }
      const html = await response.text();
      htmlCache.set(target.href, { expiresAt: Date.now() + CACHE_TTL_MS, html });
      return html;
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw abortError();
      if (error instanceof PttBoardNotFoundError) throw error;
      lastError = error;
      if (attempt < 2) await sleep(300 * 2 ** attempt, signal);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", relayAbort);
    }
  }
  throw new Error(`PTTweb 連線失敗：${safeMessage(lastError)}`);
}

function pttUrl(href: string): string | null {
  try {
    const url = new URL(href, PTT_BASE);
    return url.origin === PTT_BASE ? url.href : null;
  } catch {
    return null;
  }
}

async function fetchBoardPages(board: string, pages: number, signal?: AbortSignal): Promise<Article[]> {
  let url = `${PTT_BASE}/bbs/${encodeURIComponent(board)}/index.html`;
  const articles: Article[] = [];
  const knownUrls = new Set<string>();

  for (let page = 0; page < pages; page += 1) {
    let html: string;
    try {
      html = await fetchHtml(url, signal);
    } catch (error) {
      if (error instanceof PttAccessBlockedError && page === 0) {
        return fetchMirrorBoardPages(board, pages, signal);
      }
      throw error;
    }
    const $ = cheerio.load(html);
    const entries = $("div.r-ent");
    if (!entries.length && $.root().text().includes("不存在")) {
      throw new PttBoardNotFoundError("看板不存在");
    }

    entries.each((_, element) => {
      const entry = $(element);
      const anchor = entry.find("div.title a").first();
      const href = anchor.attr("href");
      if (!href) return;
      const articleUrl = pttUrl(href);
      if (!articleUrl || knownUrls.has(articleUrl)) return;
      knownUrls.add(articleUrl);
      articles.push({
        board,
        title: anchor.text().replace(/\s+/g, " ").trim(),
        url: articleUrl,
        source: "ptt",
        author: entry.find("div.author").first().text().trim(),
        listDate: entry.find("div.date").first().text().trim(),
        publishedAt: "",
        content: "",
      });
    });

    const previousHref = $("div.btn-group-paging a.btn")
      .filter((_, element) => $(element).text().includes("上頁"))
      .first()
      .attr("href");
    const previousUrl = previousHref ? pttUrl(previousHref) : null;
    if (!previousUrl) break;
    url = previousUrl;
    await sleep(REQUEST_DELAY_MS, signal);
  }
  return articles;
}

async function fetchMirrorBoardPages(board: string, pages: number, signal?: AbortSignal): Promise<Article[]> {
  const html = await fetchMirrorHtml(`${PTTWEB_BASE}/bbs/${encodeURIComponent(board)}`, signal);
  const $ = cheerio.load(html);
  const articles: Article[] = [];
  const knownUrls = new Set<string>();
  const escapedBoard = board.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const articlePath = new RegExp(`^/bbs/${escapedBoard}/(M\\.[A-Za-z0-9.]+)$`, "i");

  $("a[href]").each((_, element) => {
    if (articles.length >= pages * 20) return;
    const anchor = $(element);
    const href = anchor.attr("href") ?? "";
    const match = href.match(articlePath);
    if (!match) return;
    const articleUrl = `${PTT_BASE}/bbs/${encodeURIComponent(board)}/${match[1]}.html`;
    if (knownUrls.has(articleUrl)) return;

    const desktopTitle = anchor.find(".e7-show-if-device-is-not-xs span").first().text();
    const title = (desktopTitle || anchor.find(".e7-title").first().text() || anchor.text())
      .replace(/\s+/g, " ")
      .trim();
    if (!title) return;

    const container = anchor.closest(".e7-container");
    const author = container.find('a[href^="https://www.pttweb.cc/user/"] span').first().text().trim();
    const listDate = container.find(".e7-meta-container .e7-grey-text").first().text().replace(/\s+/g, " ").trim();
    knownUrls.add(articleUrl);
    articles.push({
      board,
      title,
      url: articleUrl,
      source: "pttweb",
      author,
      listDate,
      publishedAt: "",
      content: "",
    });
  });

  if (!articles.length) throw new PttBoardNotFoundError("看板不存在，或 PTTweb 暫無可用文章");
  return articles;
}

async function fetchMirrorArticle(article: Article, signal?: AbortSignal): Promise<Article> {
  const sourceUrl = new URL(article.url);
  const mirrorPath = sourceUrl.pathname.replace(/\.html$/i, "");
  const html = await fetchMirrorHtml(`${PTTWEB_BASE}${mirrorPath}`, signal);
  const $ = cheerio.load(html);
  const main = $(".e7-main-content").first().clone();
  main.find(".e7-recommend-container, script, style").remove();
  const mainText = main.text().replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const description = $('meta[property="og:description"]').attr("content")?.trim() ?? "";
  const content = (mainText || description).slice(0, 18_000);
  if (!content) throw new Error("找不到文章內容，PTTweb HTML 結構可能已變更");
  await sleep(REQUEST_DELAY_MS, signal);
  return { ...article, source: "pttweb", content };
}

async function fetchArticle(article: Article, signal?: AbortSignal): Promise<Article> {
  if (article.source === "pttweb") return fetchMirrorArticle(article, signal);

  let html: string;
  try {
    html = await fetchHtml(article.url, signal);
  } catch (error) {
    if (error instanceof PttAccessBlockedError) return fetchMirrorArticle(article, signal);
    throw error;
  }
  const $ = cheerio.load(html);
  const main = $("#main-content").first();
  if (!main.length) throw new Error("找不到文章內容，PTT HTML 結構可能已變更");

  const metaValues = main
    .find(".article-meta-value")
    .map((_, element) => $(element).text().replace(/\s+/g, " ").trim())
    .get();
  const publishedAt = metaValues.length >= 4 ? metaValues[3] : article.publishedAt;

  main.find(".push, .article-metaline, .article-metaline-right").remove();
  main.find("br").replaceWith("\n");
  const rawText = main.text().replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const [body, signature = ""] = rawText.split("※ 發信站:", 2);
  const edits = [...signature.matchAll(/※\s*編輯:[^\n]+/g)].map((match) => match[0]);
  const content = `${body.trim()}${edits.length ? `\n${edits.join("\n")}` : ""}`.slice(0, 18_000);
  await sleep(REQUEST_DELAY_MS, signal);
  return { ...article, publishedAt, content };
}

function titleMatches(title: string, keywords: string[]): boolean {
  const compactTitle = compactText(title);
  return keywords.some((keyword) => compactTitle.includes(compactText(keyword)));
}

function looksLikeSale(title: string): boolean {
  const compact = title.replace(/\s+/g, "").toLocaleLowerCase();
  return !["[徵", "［徵", "[收購", "[交換", "[已售", "已售出"].some((token) =>
    compact.includes(token.toLocaleLowerCase()),
  );
}

export async function searchPtt(options: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
  const startedAt = Date.now();
  const results: SearchResponse["results"] = [];
  const warnings: string[] = [];
  const seenUrls = new Set<string>();
  let candidateCount = 0;
  let processedCandidates = 0;

  boardLoop: for (const board of options.boards) {
    if (signal?.aborted) throw abortError();
    let articles: Article[];
    try {
      articles = await fetchBoardPages(board, options.pages, signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
      warnings.push(`[${board}] ${safeMessage(error)}`);
      continue;
    }

    if (articles.some((article) => article.source === "pttweb")) {
      warnings.push(`[${board}] PTT 阻擋 Vercel 雲端連線，已改用 PTTweb 公開鏡像資料。`);
    }

    const candidates = articles.filter(
      (article) =>
        !seenUrls.has(article.url) && titleMatches(article.title, options.keywords) && looksLikeSale(article.title),
    );
    candidateCount += candidates.length;

    for (const candidate of candidates) {
      if (processedCandidates >= MAX_CANDIDATES) {
        warnings.push(`候選文章超過 ${MAX_CANDIDATES} 篇，已停止下載其餘文章；可縮小關鍵字或頁數。`);
        break boardLoop;
      }
      seenUrls.add(candidate.url);
      processedCandidates += 1;
      try {
        const article = await fetchArticle(candidate, signal);
        const result = classifyArticle(article, options.keywords);
        if (!options.includeSold && result.sold) continue;
        if (options.maxBudget && result.price !== null && result.price > options.maxBudget) continue;
        if (options.locations.length) {
          const targets = new Set(options.locations.map(normalizeLocation));
          if (!result.locations.some((location) => targets.has(normalizeLocation(location)))) continue;
        }
        results.push(result);
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (warnings.length < 12) warnings.push(`[${board}] ${candidate.title}：${safeMessage(error)}`);
      }
    }
  }

  return {
    results,
    candidateCount,
    elapsedMs: Date.now() - startedAt,
    warnings,
  };
}
