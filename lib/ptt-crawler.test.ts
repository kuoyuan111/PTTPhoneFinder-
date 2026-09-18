import { describe, expect, it } from "vitest";

import { allocateRealtimePages, resetCrawlerRuntimeState, searchPtt, toJinaReaderUrl } from "@/lib/ptt-crawler";

describe("PTT realtime source helpers", () => {
  it("keeps all requested pages when they fit the realtime list budget", () => {
    expect(allocateRealtimePages(2, 3)).toEqual([3, 3]);
  });

  it("distributes constrained pages fairly and preserves one latest page per board", () => {
    expect(allocateRealtimePages(6, 5)).toEqual([2, 2, 1, 1, 1, 1]);
  });

  it("constructs a fixed Jina Reader URL only for PTT", () => {
    expect(toJinaReaderUrl("https://www.ptt.cc/bbs/MacShop/index.html")).toBe(
      "https://r.jina.ai/http://www.ptt.cc/bbs/MacShop/index.html",
    );
    expect(() => toJinaReaderUrl("https://example.com/private")).toThrow("非 PTT 網址");
  });

  it("accepts real article and numbered pagination URLs but rejects hostile paths", () => {
    expect(toJinaReaderUrl("https://www.ptt.cc/bbs/MacShop/M.1789699900.A.7FB.html")).toContain("M.1789699900.A.7FB.html");
    expect(toJinaReaderUrl("https://www.ptt.cc/bbs/MacShop/index4021.html")).toContain("index4021.html");
    expect(toJinaReaderUrl("https://www.ptt.cc/bbs/MacShop/search?q=iPhone+16")).toBe("https://r.jina.ai/http://www.ptt.cc/bbs/MacShop/search?q=iPhone+16");
    expect(toJinaReaderUrl("https://www.ptt.cc/bbs/MacShop/search?page=2&q=iPhone+16")).toBe("https://r.jina.ai/http://www.ptt.cc/bbs/MacShop/search?page=2&q=iPhone+16");
    expect(() => toJinaReaderUrl("https://www.ptt.cc/bbs/MacShop/../secret.html")).toThrow("不合法");
    expect(() => toJinaReaderUrl("https://www.ptt.cc/bbs/MacShop/M.1789699900.X.7FB.html")).toThrow("不合法");
  });
});

describe("PTT crawler full-flow safeguards", () => {
  const request = (url: string, status: number, body: string) => new Response(body, { status, headers: { "content-type": "text/html" } });
  const listing = (next = "") => `<html><body><div id="main-container"><div class="r-list-container">
    <div class="r-ent"><div class="title"><a href="/bbs/MacShop/M.1789699900.A.7FB.html">[販售] iPhone 17 256G</a></div><div class="author">seller</div><div class="date">9/18</div></div>
  </div>${next ? `<div class="btn-group-paging"><a class="btn" href="${next}">‹ 上頁</a></div>` : ""}</div></body></html>`;
  const emptyListing = `<html><body><div id="main-container"><div class="r-list-container"></div></div></body></html>`;
  const article = `<html><body><div id="main-content">
    <div class="article-metaline"><span class="article-meta-tag">作者</span><span class="article-meta-value">actual-seller</span></div>
    <div class="article-metaline"><span class="article-meta-tag">看板</span><span class="article-meta-value">MacShop</span></div>
    <div class="article-metaline"><span class="article-meta-tag">標題</span><span class="article-meta-value">[販售] iPhone 17 256G</span></div>
    <div class="article-metaline"><span class="article-meta-tag">時間</span><span class="article-meta-value">Fri Sep 18 00:30:08 2026</span></div>
    售價 27500元\n台北\n</div></body></html>`;

  it("uses Jina after native 403, sends no-cache HTML headers, follows numbered pages, and keeps labeled metadata", async () => {
    resetCrawlerRuntimeState();
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; headers: Headers }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      calls.push({ url, headers: new Headers(init?.headers) });
      if (url === "https://www.ptt.cc/bbs/MacShop/index.html") return request(url, 403, "blocked");
      if (url.includes("/index.html")) return request(url, 200, listing("/bbs/MacShop/index4021.html"));
      if (url.includes("index4021.html")) return request(url, 200, emptyListing);
      if (url.includes("M.1789699900.A.7FB.html")) return request(url, 200, article);
      return request(url, 404, "missing");
    }) as typeof fetch;
    try {
      const result = await searchPtt({ boards: ["MacShop"], keywords: ["iPhone 17"], maxBudget: null, locations: [], pages: 2, includeSold: true });
      const jinaCalls = calls.filter((call) => call.url.startsWith("https://r.jina.ai/"));
      expect(jinaCalls.length).toBeGreaterThanOrEqual(3);
      expect(jinaCalls.every((call) => call.headers.get("X-Respond-With") === "html")).toBe(true);
      expect(jinaCalls.every((call) => call.headers.get("X-No-Cache") === "true")).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].author).toBe("actual-seller");
      expect(result.results[0].publishedAt).toBe("2026-09-18T00:30:08+08:00");
      expect(result.results[0].source).toBe("jina");
      expect(result.warnings.join(" ")).not.toContain("PTTweb");
    } finally {
      globalThis.fetch = originalFetch;
      resetCrawlerRuntimeState();
    }
  });

  it("honors a pre-aborted signal without making a request", async () => {
    resetCrawlerRuntimeState();
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = (async () => { fetchCount += 1; return request("", 200, listing()); }) as typeof fetch;
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(searchPtt({ boards: ["MacShop"], keywords: ["iPhone"], maxBudget: null, locations: [], pages: 1, includeSold: true }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
      expect(fetchCount).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not resurrect a 404 article through PTTweb", async () => {
    resetCrawlerRuntimeState();
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      urls.push(url);
      if (url === "https://www.ptt.cc/bbs/MacShop/index.html") return request(url, 200, listing());
      if (url.includes("M.1789699900.A.7FB.html")) return request(url, 404, "missing");
      return request(url, 500, "unexpected mirror");
    }) as typeof fetch;
    try {
      const result = await searchPtt({ boards: ["MacShop"], keywords: ["iPhone 17"], maxBudget: null, locations: [], pages: 1, includeSold: true });
      expect(result.results).toHaveLength(0);
      expect(urls.some((url) => url.startsWith("https://www.pttweb.cc/"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      resetCrawlerRuntimeState();
    }
  });

  it("keeps earlier pages when a later listing page fails", async () => {
    resetCrawlerRuntimeState();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/index.html")) return request(url, 200, listing("/bbs/MacShop/index4021.html"));
      if (url.endsWith("/index4021.html")) return request(url, 503, "temporary failure");
      if (url.includes("M.1789699900.A.7FB.html")) return request(url, 200, article);
      return request(url, 404, "missing");
    }) as typeof fetch;
    try {
      const result = await searchPtt({ boards: ["MacShop"], keywords: ["iPhone 17"], maxBudget: null, locations: [], pages: 2, includeSold: true });
      expect(result.results).toHaveLength(1);
      expect(result.warnings.join(" ")).toContain("第 2 頁列表未完成");
    } finally {
      globalThis.fetch = originalFetch;
      resetCrawlerRuntimeState();
    }
  });

  it("deduplicates an article repeated across the latest and older listing pages", async () => {
    resetCrawlerRuntimeState();
    const originalFetch = globalThis.fetch;
    const articleUrl = "https://www.ptt.cc/bbs/MacShop/M.1789699900.A.7FB.html";
    const latest = listing("/bbs/MacShop/index4021.html");
    const older = listing();
    const calls: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/index.html")) return request(url, 200, latest);
      if (url.endsWith("/index4021.html")) return request(url, 200, older);
      if (url === articleUrl) return request(url, 200, article);
      return request(url, 404, "missing");
    }) as typeof fetch;
    try {
      const result = await searchPtt({ boards: ["MacShop"], keywords: ["iPhone 17"], maxBudget: null, locations: [], pages: 2, includeSold: true });
      expect(result.candidateCount).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(calls.filter((url) => url === articleUrl)).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
      resetCrawlerRuntimeState();
    }
  });

  it("keeps partial results and never falls back to PTTweb after a Jina 429", async () => {
    resetCrawlerRuntimeState();
    const originalFetch = globalThis.fetch;
    const firstUrl = "https://www.ptt.cc/bbs/MacShop/M.1789699901.A.7FB.html";
    const secondUrl = "https://www.ptt.cc/bbs/MacShop/M.1789699900.A.8FC.html";
    const partialListing = `<html><body><div id="main-container"><div class="r-list-container">
      <div class="r-ent"><div class="title"><a href="/bbs/MacShop/M.1789699901.A.7FB.html">[販售] iPhone 17 256G</a></div><div class="author">seller</div><div class="date">9/18</div></div>
      <div class="r-ent"><div class="title"><a href="/bbs/MacShop/M.1789699900.A.8FC.html">[販售] iPhone 17 Pro 256G</a></div><div class="author">seller</div><div class="date">9/18</div></div>
    </div></div></body></html>`;
    const urls: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/index.html")) return request(url, 200, partialListing);
      if (url === firstUrl) return request(url, 200, article);
      if (url === secondUrl) return request(url, 403, "blocked");
      if (url.startsWith("https://r.jina.ai/") && url.includes("8FC.html")) return request(url, 429, "rate limited");
      if (url.startsWith("https://r.jina.ai/")) return request(url, 200, article);
      return request(url, 500, "unexpected mirror request");
    }) as typeof fetch;
    try {
      const result = await searchPtt({ boards: ["MacShop"], keywords: ["iPhone 17"], maxBudget: null, locations: [], pages: 1, includeSold: true });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].url).toBe(firstUrl);
      expect(urls.some((url) => url.startsWith("https://www.pttweb.cc/"))).toBe(false);
      expect(result.warnings.join(" ")).toContain("Jina Reader達到流量限制");
      expect(result.warnings.join(" ")).toContain("未使用延遲鏡像");
    } finally {
      globalThis.fetch = originalFetch;
      resetCrawlerRuntimeState();
    }
  });

  it("rejects hostile listing HTML instead of treating it as an empty board", async () => {
    resetCrawlerRuntimeState();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("r.jina.ai")) return request(url, 200, "<html><body>challenge</body></html>");
      return request(url, 200, "<html><body>challenge</body></html>");
    }) as typeof fetch;
    try {
      const result = await searchPtt({ boards: ["MacShop"], keywords: ["iPhone 17"], maxBudget: null, locations: [], pages: 1, includeSold: true });
      expect(result.results).toHaveLength(0);
      expect(result.warnings.join(" ")).toContain("結構驗證失敗");
    } finally {
      globalThis.fetch = originalFetch;
      resetCrawlerRuntimeState();
    }
  });

  it("applies includeSold through the complete article flow", async () => {
    resetCrawlerRuntimeState();
    const originalFetch = globalThis.fetch;
    const soldListing = listing().replace("[販售] iPhone 17 256G", "[販售] iPhone 17 256G");
    const soldArticle = article.replace("售價 27500元", "售價 27500元\\n已售出");
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/index.html")) return request(url, 200, soldListing);
      if (url.includes("M.1789699900.A.7FB.html")) return request(url, 200, soldArticle);
      return request(url, 404, "missing");
    }) as typeof fetch;
    try {
      const base = { boards: ["MacShop"], keywords: ["iPhone 17"], maxBudget: null, locations: [], pages: 1 };
      const excluded = await searchPtt({ ...base, includeSold: false });
      resetCrawlerRuntimeState();
      const included = await searchPtt({ ...base, includeSold: true });
      expect(excluded.results).toHaveLength(0);
      expect(included.results).toHaveLength(1);
      expect(included.results[0].sold).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      resetCrawlerRuntimeState();
    }
  });

  it("queries PTT native search endpoint and follows search pagination", async () => {
    resetCrawlerRuntimeState();
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    const searchListingP1 = listing("/bbs/MacShop/search?page=2&q=iPhone+16");
    const searchListingP2 = `<html><body><div id="main-container"><div class="r-list-container">
      <div class="r-ent"><div class="title"><a href="/bbs/MacShop/M.1789699901.A.7FB.html">[販售] 雙北 iPhone 16 256G</a></div><div class="author">seller2</div><div class="date">9/18</div></div>
    </div></div></body></html>`;
    const searchArticle = article.replace("[販售] iPhone 17 256G", "[販售] iPhone 16 256G");
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("/search?q=iPhone%2016") || url.includes("/search?q=iPhone+16")) return request(url, 200, searchListingP1);
      if (url.includes("/search?page=2&q=iPhone+16") || url.includes("/search?page=2&q=iPhone%2016")) return request(url, 200, searchListingP2);
      if (url.includes("M.1789699900.A.7FB.html") || url.includes("M.1789699901.A.7FB.html")) return request(url, 200, searchArticle);
      return request(url, 404, "missing");
    }) as typeof fetch;
    try {
      const result = await searchPtt({ boards: ["MacShop"], keywords: ["iPhone 16"], maxBudget: null, locations: [], pages: 2, includeSold: true });
      expect(requestedUrls.some((u) => u.includes("/search?q=iPhone%2016") || u.includes("/search?q=iPhone+16"))).toBe(true);
      expect(requestedUrls.some((u) => u.includes("/search?page=2&q=iPhone+16") || u.includes("/search?page=2&q=iPhone%2016"))).toBe(true);
      expect(result.results.length).toBeGreaterThanOrEqual(1);
    } finally {
      globalThis.fetch = originalFetch;
      resetCrawlerRuntimeState();
    }
  });
});
