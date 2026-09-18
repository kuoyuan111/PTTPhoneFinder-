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

  it("prefers the actual sale price over retail price, dates, and board instructions", () => {
    const result = classifyArticle(
      article(
        "[販售] iPhone 17 Pro 256G 黑",
        "官網價：39,900\n售價：27,500\n保固到期：2026/10/01\n5001元以上的商品只可面交或透過第三方代收平台交易。",
      ),
      ["iPhone 17 Pro"],
    );

    expect(result.price).toBe(27_500);
    expect(result.pricesFound).toEqual([39_900, 27_500]);
    expect(result.storage).toBe("256GB");
    expect(result.color).toContain("黑");
  });

  it("parses an explicit sub-1000 dollar price and a label on the preceding line", () => {
    const result = classifyArticle(
      article("[販售] 手機配件", "售價\n$500\n交易方式：台北面交"),
      ["手機配件"],
    );

    expect(result.price).toBe(500);
    expect(result.pricesFound).toEqual([500]);
  });

  it("parses bracketed and compound asking prices without promoting retail prices", () => {
    expect(classifyArticle(article("[販售] 配件", "[售價] 27500"), ["配件"]).price).toBe(27_500);
    expect(classifyArticle(article("[販售] 配件", "[售價]\n27500"), ["配件"]).price).toBe(27_500);
    expect(classifyArticle(article("[販售] 配件", "售價 2萬3500元"), ["配件"]).pricesFound).toEqual([23_500]);
    expect(classifyArticle(article("[販售] 配件", "售價 2萬3500元"), ["配件"]).price).toBe(23_500);
    expect(classifyArticle(article("[販售] 配件", "原價39900元\n售價私訊"), ["配件"]).price).toBeNull();
    expect(classifyArticle(article("[販售] 配件", "建議售價39900元，售價27500元"), ["配件"]).price).toBe(27_500);
  });

  it("leaves price unknown when multiple sale prices cannot be linked to one item", () => {
    const result = classifyArticle(
      article("[販售] iPhone 多支", "iPhone 15 128G\n售價：15,000\niPhone 15 Pro 256G\n售價：25,000"),
      ["iPhone"],
    );

    expect(result.price).toBeNull();
    expect(result.pricesFound).toEqual([15_000, 25_000]);
  });

  it("keeps storage and color from the item instead of boilerplate examples", () => {
    const result = classifyArticle(
      article(
        "[販售] iPhone 17 Pro Max 1TB 曜石黑",
        "板規範例：iPhone 17 256G black，請勿照抄。\n容量：1TB\n顏色：曜石黑",
      ),
      ["iPhone 17 Pro Max"],
    );

    expect(result.storage).toBe("1TB");
    expect(result.color).toContain("曜石黑");
    expect(result.color).not.toContain("black");
  });

  it("uses values after condition headings and does not keep a bare heading", () => {
    const result = classifyArticle(
      article("[販售] iPhone 16", "[保固]\n2027/01/01\n[盒裝配件]\n盒裝完整，配件齊全"),
      ["iPhone 16"],
    );

    expect(result.condition).toContain("保固：2027/01/01");
    expect(result.condition).toContain("盒裝配件：盒裝完整，配件齊全");
    expect(result.condition).not.toBe("保固；盒裝配件");
  });

  it("does not confuse conditional sale terms with a sold event", () => {
    const result = classifyArticle(
      article("[已售出] iPhone 16", "目前未售出\n售出後不退，售出概不退換"),
      ["iPhone 16"],
    );
    expect(result.soldStatus).toBe("已售出");

    const conditional = classifyArticle(article("[販售] iPhone 16", "售價 27500\n售出後不退"), ["iPhone 16"]);
    expect(conditional.soldStatus).toBe("未判斷");

    const soldWord = classifyArticle(article("[販售] iPhone 16", "SOLD"), ["iPhone 16"]);
    expect(soldWord.soldStatus).toBe("已售出");
  });

  it("uses the latest sold event and ignores negative or unsold wording", () => {
    const updated = classifyArticle(
      article("[販售] iPhone 15", "目前未售出\n※ 編輯：seller (已售)"),
      ["iPhone 15"],
    );
    const unsold = classifyArticle(article("[販售] iPhone 15", "unsold，仍在販售"), ["iPhone 15"]);

    expect(updated.soldStatus).toBe("已售出");
    expect(updated.sold).toBe(true);
    expect(unsold.soldStatus).toBe("未售出");
    expect(unsold.sold).toBe(false);
  });

  it("expands 雙北 while avoiding a boilerplate region list and vague model keywords", () => {
    const result = classifyArticle(
      article("[販售] iPhone 17 Pro 台北", "面交地點：雙北\n板規：台北、新北、桃園、台中皆有交易規則"),
      ["17"],
    );

    expect(result.locations).toEqual(["台北", "新北"]);
    expect(result.matchedKeywords).toEqual([]);
    expect(result.model).toBe("");
  });

  it("matches keywords with space-separated tokens even when words intervene", () => {
    const result = classifyArticle(
      article("[販售] 雙北 iPhone 16 黑色 Pro 256G", "售價 27500"),
      ["iPhone 16 Pro"],
    );
    expect(result.matchedKeywords).toContain("iPhone 16 Pro");
    expect(result.model).toBe("iPhone 16 Pro");
  });

  it("matches keywords with 256GB against titles written as 256G", () => {
    const result = classifyArticle(
      article("[販售] 台北 iPhone 16 Pro 256G", "售價 27500"),
      ["iPhone 16 Pro 256GB"],
    );
    expect(result.matchedKeywords).toContain("iPhone 16 Pro 256GB");
  });
});
