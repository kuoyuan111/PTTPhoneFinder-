import { describe, expect, it } from "vitest";

import {
  articleExcelSerial,
  articleTimestamp,
  formatArticleTimeTaiwan,
  parseArticleDate,
} from "@/lib/article-time";

describe("article time", () => {
  it("interprets legacy PTT timestamps as Taiwan time across month boundaries", () => {
    const date = parseArticleDate("Wed Jan 31 23:45:06 2024");

    expect(date?.toISOString()).toBe("2024-01-31T15:45:06.000Z");
    expect(formatArticleTimeTaiwan("Wed Jan 31 23:45:06 2024", "")).toContain("2024/01/31");
    expect(formatArticleTimeTaiwan("Wed Jan 31 23:45:06 2024", "")).toContain("23:45");
  });

  it("keeps ISO instants stable and displays them in Taiwan time", () => {
    const value = "2026-09-17T16:30:00.000Z";

    expect(articleTimestamp(value)).toBe(Date.parse(value));
    expect(formatArticleTimeTaiwan(value, "")).toContain("2026/09/18");
    expect(formatArticleTimeTaiwan(value, "")).toContain("00:30");
  });

  it("uses the PTT article URL epoch when a mirror date is missing", () => {
    const url = "https://www.ptt.cc/bbs/MacShop/M.1726578000.A.123.html";

    expect(articleTimestamp("", url)).toBe(1726578000 * 1000);
    expect(formatArticleTimeTaiwan("", url)).toContain("2024/09/17");
  });

  it("makes the Excel serial represent Taiwan wall-clock time regardless of host timezone", () => {
    const serial = articleExcelSerial("2026-09-17T16:30:00.000Z");
    const expected = (Date.UTC(2026, 8, 18, 0, 30) - Date.UTC(1899, 11, 30)) / (24 * 60 * 60 * 1000);

    expect(serial).toBe(expected);
  });
});
