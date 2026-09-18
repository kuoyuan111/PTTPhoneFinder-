import { describe, expect, it } from "vitest";

import { buildResultsWorkbook } from "@/lib/export-excel";
import type { SearchResult } from "@/lib/types";

const result: SearchResult = {
  board: "MacShop",
  source: "jina",
  title: "[販售] iPhone 16 Pro 256G",
  url: "https://www.ptt.cc/bbs/MacShop/M.123.A.456.html",
  author: "seller",
  listDate: "9/18",
  publishedAt: "Thu Sep 18 08:30:00 2026",
  content: "售價：27,500元",
  matchedKeywords: ["iPhone 16 Pro"],
  model: "iPhone 16 Pro",
  storage: "256GB",
  price: 27_500,
  pricesFound: [27_500],
  color: "原色鈦金屬",
  soldStatus: "未售出",
  sold: false,
  locations: ["台北"],
  condition: "正常使用",
};

describe("Excel export", () => {
  it("creates a readable workbook with typed price and hyperlink", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const buffer = await buildResultsWorkbook([result]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(buffer));
    const sheet = workbook.getWorksheet("搜尋結果");

    expect(buffer.byteLength).toBeGreaterThan(1_000);
    expect(sheet).toBeDefined();
    expect(sheet?.getRow(2).getCell(2).value).toBe("即時中繼");
    expect(sheet?.getRow(2).getCell(6).value).toBe(27_500);
    expect(sheet?.getRow(2).getCell(13).value).toMatchObject({
      text: "開啟 PTT 原文",
      hyperlink: result.url,
    });
    expect(sheet?.getRow(2).getCell(15).value).toBe(result.content);
  });
});
