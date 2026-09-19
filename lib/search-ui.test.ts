import { describe, expect, it } from "vitest";

import {
  appendKeyword,
  COMMON_IPHONE_MODELS,
  createSearchRequestGate,
  DEFAULT_KEYWORD,
  DEFAULT_SORT,
  emptyResultsMessage,
  emptySearchView,
  searchViewReducer,
  selectVisibleResults,
  validKeyword,
} from "@/lib/search-ui";
import type { SearchResult } from "@/lib/types";

const baseResult: SearchResult = {
  board: "MacShop",
  source: "jina",
  title: "[販售] iPhone 17 256G",
  url: "https://www.ptt.cc/bbs/MacShop/M.1760000000.A.123.html",
  author: "seller",
  listDate: "9/18",
  publishedAt: "Thu Sep 18 08:30:00 2026",
  content: "售價 27500",
  matchedKeywords: ["iPhone 17"],
  model: "iPhone 17",
  storage: "256GB",
  price: 27500,
  pricesFound: [27500],
  color: "黑",
  soldStatus: "未售出",
  sold: false,
  locations: ["台北"],
  condition: "正常",
};

describe("search UI state", () => {
  it.each([
    ["iPhone 17", true],
    ["手機", true],
    ["かな", false],
    ["한글", false],
    ["é", false],
  ])("uses the classifier-supported keyword alphabet for %s", (keyword, expected) => {
    expect(validKeyword(keyword)).toBe(expected);
  });

  it("ignores stale completion after a newer request starts", () => {
    const gate = createSearchRequestGate();
    const first = gate.start();
    const second = gate.start();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it("invalidates an active request when stopped or cleared", () => {
    const gate = createSearchRequestGate();
    const controller = gate.start();
    gate.cancel();

    expect(controller.signal.aborted).toBe(true);
    expect(gate.isCurrent(controller)).toBe(false);
  });

  it("keeps filtered rows in the same sorted order used by export", () => {
    const older = { ...baseResult, price: null, url: `${baseResult.url}-older`, title: "older" };
    const newer = { ...baseResult, url: `${baseResult.url}-newer`, title: "newer" };

    expect(selectVisibleResults([older, newer], "new", DEFAULT_SORT)).toEqual([newer]);
    expect(selectVisibleResults([older, newer], "", { key: "price", direction: "asc" })).toEqual([newer, older]);
    expect(selectVisibleResults([older, newer], "", { key: "price", direction: "desc" })).toEqual([newer, older]);
  });

  it("distinguishes local filter empty from an empty search", () => {
    expect(emptyResultsMessage("completed", 1)).toBe("目前篩選條件沒有結果。");
    expect(emptyResultsMessage("completed", 0)).toBe("本次搜尋完成，但沒有符合條件的結果。");
  });

  it("clears stale errors when a new search starts", () => {
    const failed = searchViewReducer(emptySearchView(), { type: "fail", error: "failed" });
    const searching = searchViewReducer(failed, { type: "start", boardCount: 1 });
    expect(searching.error).toBe("");
    expect(searching.phase).toBe("searching");
  });

  it("provides default keyword iPhone 17 Pro Max and categorized presets", () => {
    expect(DEFAULT_KEYWORD).toBe("iPhone 17 Pro Max");
    expect(COMMON_IPHONE_MODELS.some((g) => g.group.includes("18"))).toBe(true);
    expect(COMMON_IPHONE_MODELS.some((g) => g.group.includes("17"))).toBe(true);
    expect(COMMON_IPHONE_MODELS.some((g) => g.group.includes("16"))).toBe(true);
    expect(COMMON_IPHONE_MODELS.some((g) => g.group.includes("15"))).toBe(true);
    for (const group of COMMON_IPHONE_MODELS) {
      for (const model of group.models) {
        expect(validKeyword(model)).toBe(true);
      }
    }
  });

  it("appends keyword without duplication", () => {
    expect(appendKeyword("", "iPhone 17 Pro Max")).toBe("iPhone 17 Pro Max");
    expect(appendKeyword("iPhone 17 Pro Max", "iPhone 16 Pro")).toBe("iPhone 17 Pro Max, iPhone 16 Pro");
    expect(appendKeyword("iPhone 17 Pro Max, iPhone 16 Pro", "iPhone 17 Pro Max")).toBe("iPhone 17 Pro Max, iPhone 16 Pro");
    expect(appendKeyword("iPhone 17 Pro Max", "")).toBe("iPhone 17 Pro Max");
  });
});
