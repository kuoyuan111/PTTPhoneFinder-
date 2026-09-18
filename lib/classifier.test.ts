import { describe, expect, it } from "vitest";

import { classifyArticle, compactText, normalizeLocation } from "@/lib/classifier";
import type { Article } from "@/lib/types";

function article(title: string, content: string): Article {
  return {
    board: "MacShop",
    title,
    content,
    url: "https://www.ptt.cc/bbs/MacShop/M.123.A.456.html",
    author: "seller",
    listDate: "9/18",
    publishedAt: "Thu Sep 18 08:30:00 2026",
  };
}

describe("classifier", () => {
  it("normalizes model and location text", () => {
    expect(compactText("iPhone 16 Pro Max")).toBe("iphone16promax");
    expect(normalizeLocation("臺北市")).toBe("台北");
  });

  it("extracts structured fields from a sale article", () => {
    const result = classifyArticle(
      article(
        "[販售] iPhone 16 Pro 256G 原色鈦",
        "售價：27,500元\n物品狀況：正常使用，無摔機\n面交地點：台北市\n電池健康度：95%",
      ),
      ["iPhone 16 Pro"],
    );

    expect(result.model).toBe("iPhone 16 Pro");
    expect(result.storage).toBe("256GB");
    expect(result.price).toBe(27_500);
    expect(result.color).toContain("原色鈦金屬");
    expect(result.locations).toContain("台北");
    expect(result.condition).toContain("物品狀況");
    expect(result.sold).toBe(false);
  });

  it("understands Chinese prices and sold markers", () => {
    const result = classifyArticle(
      article("[販售] Pixel 9 128G", "價格 2萬3500，台中面交\n※ 編輯: seller (已售出)"),
      ["Pixel 9"],
    );

    expect(result.price).toBe(23_500);
    expect(result.storage).toBe("128GB");
    expect(result.soldStatus).toBe("已售出");
    expect(result.locations).toContain("台中");
  });

  it("accepts a bare dollar sign and ignores the MacShop 5001 rule", () => {
    const result = classifyArticle(
      article(
        "[販售] iPhone Pro 512G",
        "[售價]官網-500 $56,400\n5001元以上的商品只可面交或透過第三方代收平台交易。",
      ),
      ["iPhone Pro"],
    );

    expect(result.price).toBe(56_400);
    expect(result.pricesFound).not.toContain(5_001);
  });
});
