import type { Article, SearchResult } from "@/lib/types";

const COLOR_TERMS_CHINESE = [
  "星光色",
  "太空灰",
  "午夜色",
  "原色鈦金屬",
  "沙漠色",
  "自然鈦",
  "黑鈦",
  "白鈦",
  "藍鈦",
  "黑色",
  "白色",
  "金色",
  "銀色",
  "銀",
  "藍色",
  "紫色",
  "粉色",
  "紅色",
  "綠色",
  "黃色",
  "灰色",
  "橘色",
  "橙色",
];

const COLOR_TERMS_ENGLISH = [
  "black",
  "white",
  "gold",
  "silver",
  "blue",
  "purple",
  "pink",
  "red",
  "green",
  "yellow",
  "gray",
  "grey",
];

const SOLD_TERMS = [
  "已售出",
  "已賣出",
  "已成交",
  "交易完成",
  "已預訂",
  "已預定",
  "sold",
  "reserved",
];

const UNSOLD_TERMS = ["未售出", "尚未售出", "還沒售出", "未賣出"];

const LOCATION_ALIASES: Array<[string, string[]]> = [
  ["基隆", ["基隆"]],
  ["台北", ["台北", "臺北"]],
  ["新北", ["新北"]],
  ["桃園", ["桃園"]],
  ["新竹", ["新竹"]],
  ["苗栗", ["苗栗"]],
  ["台中", ["台中", "臺中"]],
  ["彰化", ["彰化"]],
  ["南投", ["南投"]],
  ["雲林", ["雲林"]],
  ["嘉義", ["嘉義"]],
  ["台南", ["台南", "臺南"]],
  ["高雄", ["高雄"]],
  ["屏東", ["屏東"]],
  ["宜蘭", ["宜蘭"]],
  ["花蓮", ["花蓮"]],
  ["台東", ["台東", "臺東"]],
  ["澎湖", ["澎湖"]],
  ["金門", ["金門"]],
  ["馬祖", ["馬祖", "連江"]],
];

function unique<T>(values: T[], key: (value: T) => string = String): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = key(value).toLocaleLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function compactText(text: string): string {
  return text.toLocaleLowerCase().replace(/[^0-9a-z\u4e00-\u9fff]+/g, "");
}

export function normalizeLocation(text: string): string {
  return text.replaceAll("臺", "台").trim().replace(/[縣市區鄉鎮]+$/g, "");
}

function extractPrices(text: string): number[] {
  const prices: number[] = [];
  const chinesePricePattern = /(\d{1,2})\s*萬\s*(\d{0,4})\s*(?:元|塊|新台幣)?/g;
  for (const match of text.matchAll(chinesePricePattern)) {
    prices.push(Number(match[1]) * 10_000 + Number(match[2] || "0"));
  }

  const pricePattern = /(?:(?:售價|價格|售|賣價|售出價|收)?\s*[:：]?\s*)?(?:NT\$|NTD\s*|\$)?([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s*(?:元|塊|新台幣|TWD)?/gi;
  for (const match of text.matchAll(pricePattern)) {
    const index = match.index ?? 0;
    const value = Number(match[1].replaceAll(",", ""));
    const after = text.slice(index + match[0].length, index + match[0].length + 2);
    if (after.startsWith("年") || after.startsWith("/") || after.startsWith("-") || after.startsWith("以上")) continue;

    const explicitCurrency = /(?:元|塊|新台幣|NT\$|TWD|\$)/i.test(match[0]);
    if (value >= 2018 && value <= 2030 && !explicitCurrency) continue;

    const before = text.slice(Math.max(0, index - 10), index);
    const priceContext = /(?:價格|售價|賣價|售出價|售|賣|收)/.test(before);
    if ((explicitCurrency || priceContext) && !prices.includes(value)) prices.push(value);
  }
  return prices;
}

function extractCapacities(text: string): string[] {
  const values: string[] = [];
  const pattern = /(?:^|[^A-Za-z0-9])(32|64|128|256|512|1024|[12])\s*(GB|G|TB|T)(?![A-Za-z0-9])/gi;
  for (const match of text.matchAll(pattern)) {
    const number = match[1];
    const unit = match[2].toUpperCase();
    if (unit === "T" || unit === "TB" || (number === "1024" && ["G", "GB"].includes(unit))) {
      values.push(`${number === "1024" ? "1" : number}TB`);
    } else {
      values.push(`${number}GB`);
    }
  }
  return unique(values);
}

function extractColors(text: string): string[] {
  const compact = compactText(text);
  const matched = COLOR_TERMS_CHINESE.filter((color) => compact.includes(compactText(color)));
  if (compact.includes(compactText("原色鈦"))) matched.push("原色鈦金屬");
  for (const color of COLOR_TERMS_ENGLISH) {
    if (new RegExp(`\\b${color}\\b`, "i").test(text)) matched.push(color);
  }
  const specific = matched.filter(
    (color) => !matched.some((other) => color !== other && compactText(other).includes(compactText(color))),
  );
  return unique(specific);
}

function extractSoldStatus(text: string): SearchResult["soldStatus"] {
  const lower = text.toLocaleLowerCase();
  if (UNSOLD_TERMS.some((term) => lower.includes(term.toLocaleLowerCase()))) return "未售出";
  if (SOLD_TERMS.some((term) => lower.includes(term.toLocaleLowerCase()))) return "已售出";
  return "未判斷";
}

function extractLocations(text: string): string[] {
  return LOCATION_ALIASES.filter(([, aliases]) => aliases.some((alias) => text.includes(alias))).map(
    ([name]) => name,
  );
}

function extractCondition(content: string): string {
  const usefulLine = /(?:物品|商品)?狀況|品項狀況|保固|電池(?:健康度)?|盒裝|配件|交易方式|面交地點/;
  const lines = unique(
    content
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length >= 3 && usefulLine.test(line)),
  ).slice(0, 4);
  if (!lines.length) return "未擷取到明確商品狀況；請開啟原文確認";
  const summary = lines.join("；");
  return summary.length > 180 ? `${summary.slice(0, 177)}…` : summary;
}

export function classifyArticle(article: Article, keywords: string[]): SearchResult {
  const source = `${article.title}\n${article.content}`;
  const compactSource = compactText(source);
  const matchedKeywords = unique(keywords.filter((keyword) => compactSource.includes(compactText(keyword))));
  const pricesFound = extractPrices(source);
  const capacities = extractCapacities(source);
  const colors = extractColors(source);
  const soldStatus = extractSoldStatus(source);

  return {
    ...article,
    matchedKeywords,
    model: matchedKeywords.join("、"),
    storage: capacities.join("、"),
    price: pricesFound[0] ?? null,
    pricesFound,
    color: colors.join("、"),
    soldStatus,
    sold: soldStatus === "已售出",
    locations: extractLocations(source),
    condition: extractCondition(article.content),
  };
}
