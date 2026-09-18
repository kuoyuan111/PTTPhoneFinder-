import type { Article, SearchResult } from "@/lib/types";

const COLOR_TERMS_CHINESE = [
  "原色鈦金屬", "原色鈦", "星光色", "太空灰", "午夜色", "沙漠鈦金", "沙漠鈦", "沙漠色", "自然鈦", "黑鈦", "白鈦", "藍鈦",
  "曜石黑", "深空黑", "太空黑", "宇宙黑", "亮黑色", "冰藍色", "冰藍", "薰衣草紫", "玫瑰金", "湖水綠", "午夜藍",
  "黑色", "白色", "金色", "銀色", "藍色", "紫色", "粉色", "紅色", "綠色", "黃色", "灰色", "橘色", "橙色",
];
const COLOR_SHORTHANDS = ["黑", "白", "金", "銀", "藍", "紫", "粉", "紅", "綠", "黃", "灰", "橘"];
const COLOR_TERMS_ENGLISH = ["black", "white", "gold", "silver", "blue", "purple", "pink", "red", "green", "yellow", "gray", "grey"];

const LOCATION_ALIASES: Array<[string, string[]]> = [
  ["基隆", ["基隆"]], ["台北", ["台北", "臺北", "台北市", "臺北市", "北市"]], ["新北", ["新北", "新北市"]],
  ["桃園", ["桃園", "桃園市"]], ["新竹", ["新竹", "新竹市", "新竹縣"]], ["苗栗", ["苗栗", "苗栗縣"]],
  ["台中", ["台中", "臺中", "台中市", "臺中市"]], ["彰化", ["彰化", "彰化縣"]], ["南投", ["南投", "南投縣"]],
  ["雲林", ["雲林", "雲林縣"]], ["嘉義", ["嘉義", "嘉義市", "嘉義縣"]], ["台南", ["台南", "臺南", "台南市", "臺南市"]],
  ["高雄", ["高雄", "高雄市"]], ["屏東", ["屏東", "屏東縣"]], ["宜蘭", ["宜蘭", "宜蘭縣"]], ["花蓮", ["花蓮", "花蓮縣"]],
  ["台東", ["台東", "臺東", "台東縣", "臺東縣"]], ["澎湖", ["澎湖", "澎湖縣"]], ["金門", ["金門", "金門縣"]],
  ["馬祖", ["馬祖", "連江", "連江縣"]],
];

const PRICE_LABELS = "售價|賣價|售出價|出售價格|價格|欲售|售|賣";
const RETAIL_PRICE_LABELS = "建議售價|原價|官網價|定價|購入價|買入價";
const CONDITION_FIELDS = ["物品狀況", "商品狀況", "品項狀況", "狀況", "電池健康度", "電池", "盒裝配件", "盒裝", "配件", "保固", "交易方式", "面交地點", "地點"];

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
  const cleaned = text.replaceAll("臺", "台").trim().replace(/[，,、/\\|]+$/g, "").replace(/[縣市區鄉鎮]+$/g, "");
  // Treat 雙北 as a Taipei-anchored filter; extracted 雙北 posts emit both cities.
  return cleaned === "雙北" ? "台北" : cleaned;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim());
}

function isBoilerplateLine(line: string): boolean {
  return /(?:板規|版規|公告|範例|例如|格式|請注意|規則|簽名檔|熱門容量|常見容量|5001\s*元以上的商品|只可面交|第三方代收)/i.test(line);
}

function itemLines(source: string): string[] {
  return splitLines(source).filter((line, index) => Boolean(line) && (index === 0 || !isBoilerplateLine(line)));
}

interface PriceCandidate {
  value: number;
  index: number;
  score: number;
  actualLabel: boolean;
  retailLabel: boolean;
}

function isRetailLabel(label: string): boolean {
  return new RegExp(`^(?:${RETAIL_PRICE_LABELS})$`, "i").test(label);
}

function nearestLabel(text: string, index: number): { actual: boolean; retail: boolean } {
  const labels = Array.from(text.matchAll(new RegExp(`(?:${RETAIL_PRICE_LABELS}|${PRICE_LABELS})`, "g")))
    .map((match) => ({ index: match.index ?? -1, kind: isRetailLabel(match[0]) ? "retail" as const : "actual" as const }))
    .filter((label) => label.index < index && index - label.index <= 40)
    .sort((a, b) => b.index - a.index);
  return { actual: labels[0]?.kind === "actual", retail: labels[0]?.kind === "retail" };
}

function addPriceCandidate(candidates: PriceCandidate[], value: number, index: number, context: string, absoluteIndex: number, kind: "currency" | "chinese" | "label"): void {
  if (!Number.isFinite(value) || value < 0 || value > 999_999) return;
  const before = context.slice(0, index);
  const labels = nearestLabel(context, index);
  const hasCurrency = kind === "currency";
  const score = (labels.actual ? 100 : 0) + (labels.retail ? -55 : 0) + (hasCurrency ? 55 : 0) + (kind === "chinese" ? 45 : 0) + (kind === "label" ? 20 : 0) + (/(?:價格|售價|賣價|售出價|售|賣)/.test(before.slice(-12)) ? 20 : 0);
  candidates.push({ value, index: absoluteIndex, score, actualLabel: labels.actual, retailLabel: labels.retail });
}

function parsePriceText(text: string, absoluteOffset: number, candidates: PriceCandidate[]): void {
  const chinesePattern = /(\d{1,2})\s*萬\s*(\d{0,4})\s*(?:元|塊|新台幣)?/g;
  for (const match of text.matchAll(chinesePattern)) {
    addPriceCandidate(candidates, Number(match[1]) * 10_000 + Number(match[2] || "0"), match.index ?? 0, text, absoluteOffset + (match.index ?? 0), "chinese");
  }
  const currencyPattern = /(?:NT\s*\$|NTD\s*|TWD\s*|\$)\s*([0-9][0-9,]*)|(?<!萬|[0-9])([0-9][0-9,]*)\s*(?:元|塊|新台幣|TWD)/gi;
  for (const match of text.matchAll(currencyPattern)) {
    const raw = match[1] ?? match[2];
    addPriceCandidate(candidates, Number(raw.replaceAll(",", "")), match.index ?? 0, text, absoluteOffset + (match.index ?? 0), "currency");
  }
  const labelPattern = new RegExp(`(?:[\\[【]\\s*)?(${RETAIL_PRICE_LABELS}|${PRICE_LABELS})(?:\\s*[\\]】])?\\s*[:：]?\\s*((?:\\d{1,2}\\s*萬\\s*\\d{0,4})|(?:[0-9][0-9,]{0,6}))(?!\\s*萬)`, "gi");
  for (const match of text.matchAll(labelPattern)) {
    const raw = match[2];
    const valueIndex = (match.index ?? 0) + match[0].lastIndexOf(raw);
    const value = raw.includes("萬")
      ? Number(raw.replace(/\\s+/g, "").replace("萬", "0000"))
      : Number(raw.replaceAll(",", ""));
    addPriceCandidate(candidates, value, valueIndex, text, absoluteOffset + valueIndex, "label");
  }
}

function isSuspiciousPriceLine(line: string): boolean {
  return /(?:5001\s*元以上|以上的商品|板規|版規|公告|範例|例如|格式|只可面交|第三方代收)/i.test(line);
}

function extractPrices(source: string): { values: number[]; price: number | null } {
  const candidates: PriceCandidate[] = [];
  const lines = splitLines(source);
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineOffset = offset;
    offset += line.length + 1;
    if (!line || isSuspiciousPriceLine(line)) continue;
    parsePriceText(line, lineOffset, candidates);
    if (new RegExp(`^\\s*(?:\\[|【)?\\s*(?:${RETAIL_PRICE_LABELS}|${PRICE_LABELS})\\s*(?:\\]|】)?\\s*[:：]?\\s*$`, "i").test(line)) {
      const next = lines.slice(index + 1).find((value) => Boolean(value));
      if (next && !isSuspiciousPriceLine(next)) parsePriceText(`${line} ${next}`, lineOffset, candidates);
    }
  }

  const merged = new Map<number, PriceCandidate>();
  for (const candidate of candidates) {
    const existing = merged.get(candidate.value);
    if (!existing || candidate.score > existing.score) merged.set(candidate.value, candidate);
  }
  const ordered = [...merged.values()].sort((a, b) => a.index - b.index);
  const values = ordered.map((candidate) => candidate.value);
  if (!ordered.length) return { values, price: null };
  const actualPrices = unique(ordered.filter((candidate) => candidate.actualLabel && !candidate.retailLabel).map((candidate) => candidate.value));
  if (actualPrices.length > 1) return { values, price: null };
  if (actualPrices.length === 1) return { values, price: actualPrices[0] };
  if (ordered.every((candidate) => candidate.retailLabel)) return { values, price: null };
  if (ordered.length === 1) return { values, price: ordered[0].value };
  const ranked = [...ordered].sort((a, b) => b.score - a.score);
  return ranked[0].score > ranked[1].score ? { values, price: ranked[0].value } : { values, price: null };
}

function extractCapacities(lines: string[]): string[] {
  const values: string[] = [];
  const pattern = /(?:^|[^A-Za-z0-9])(32|64|128|256|512|1024|[12])\s*(GB|G|TB|T)(?![A-Za-z0-9])/gi;
  for (const line of lines) {
    for (const match of line.matchAll(pattern)) {
      const number = match[1];
      const unit = match[2].toUpperCase();
      values.push(unit === "T" || unit === "TB" || (number === "1024" && ["G", "GB"].includes(unit)) ? `${number === "1024" ? "1" : number}TB` : `${number}GB`);
    }
  }
  return unique(values);
}

function separatedChineseTerm(line: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\\s:：/、,，()（）\\[\\]【】])${escaped}(?=$|[\\s:：/、,，()（）\\[\\]【】])`).test(line);
}

function extractColors(lines: string[]): string[] {
  const searchable = lines.join("\n");
  const fieldText = lines.filter((line) => /(?:顏色|颜色|色系|配色|color|colour)\s*[:：]?/i.test(line)).join("\n");
  const matched: string[] = [];
  for (const color of COLOR_TERMS_CHINESE) {
    if (compactText(searchable).includes(compactText(color))) matched.push(color === "原色鈦" ? "原色鈦金屬" : color);
  }
  for (const shorthand of COLOR_SHORTHANDS) {
    if (fieldText && fieldText.includes(shorthand)) matched.push(shorthand);
    else if (lines.some((line, index) => index === 0 && separatedChineseTerm(line, shorthand))) matched.push(shorthand);
  }
  for (const color of COLOR_TERMS_ENGLISH) if (new RegExp(`\\b${color}\\b`, "i").test(searchable)) matched.push(color);
  const specific = matched.filter((color) => !matched.some((other) => color !== other && compactText(other).includes(compactText(color))));
  return unique(specific);
}

function extractSoldStatus(text: string): SearchResult["soldStatus"] {
  const events: Array<{ index: number; status: SearchResult["soldStatus"] }> = [];
  const negativePattern = /未售出|尚未售出|還沒售出|未賣出|未售|未成交|\bunsold\b|\bnot\s+sold\b/gi;
  const positivePattern = /(?:[\[［]\s*(?:已售出?|售出|已賣出?|已成交|交易完成|已預訂|已預定|sold|reserved)\s*[\]］])|已售出?|已賣出?|已成交|交易完成|已預訂|已預定|(?<!欲|未)(?:售出|賣出)(?!價|價格|後|概不|不退)|(?<![A-Za-z])sold(?![A-Za-z])/gi;
  const titleSoldPattern = /(?:[\[［]\s*(?:已售出?|售出|已賣出?|已成交|交易完成|已預訂|已預定|sold|reserved)\s*[\]］])|(?:^|\s)(?:sold|reserved)(?=\s|$)/i;
  if (titleSoldPattern.test(text.split(/\r?\n/, 1)[0] ?? "")) return "已售出";
  for (const match of text.matchAll(negativePattern)) events.push({ index: match.index ?? 0, status: "未售出" });
  for (const match of text.matchAll(positivePattern)) events.push({ index: match.index ?? 0, status: "已售出" });
  events.sort((a, b) => a.index - b.index);
  return events.at(-1)?.status ?? "未判斷";
}

function extractLocations(source: string): string[] {
  const lines = itemLines(source);
  const locationContext = /面交|交易|取貨|自取|寄送|郵寄|交貨|所在地|地點|地區|住在|人在|雙北/;
  const relevant = lines.filter((line, index) => index === 0 || locationContext.test(line) || line.length <= 10);
  const found: string[] = [];
  for (const [name, aliases] of LOCATION_ALIASES) if (relevant.some((line) => aliases.some((alias) => line.includes(alias)))) found.push(name);
  if (relevant.some((line) => line.includes("雙北"))) found.push("台北", "新北");
  return unique(found);
}

function conditionField(line: string): { label: string; value: string } | null {
  const fields = CONDITION_FIELDS.join("|");
  let normalized = line.replace(/^[-*※•]\s*/, "").trim();
  if (normalized.startsWith("[") || normalized.startsWith("【")) normalized = normalized.slice(1).trimStart();
  if (normalized.endsWith("]") || normalized.endsWith("】")) normalized = normalized.slice(0, -1).trimEnd();
  const match = normalized.match(new RegExp(`^(${fields})(?:(?:\\s*[:：]\\s*|\\s+)(.*))?$`));
  return match ? { label: match[1], value: (match[2] ?? "").trim() } : null;
}

function extractCondition(content: string): string {
  const lines = splitLines(content);
  const summaries: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || isBoilerplateLine(line)) continue;
    const field = conditionField(line);
    if (!field) continue;
    let value = field.value;
    if (!value) {
      const next = lines.slice(index + 1).find((candidate) => Boolean(candidate));
      if (next && !isBoilerplateLine(next) && !conditionField(next)) value = next;
    }
    if (value) summaries.push(`${field.label}：${value}`);
  }
  const shown = unique(summaries).slice(0, 4);
  if (!shown.length) return "未擷取到明確商品狀況；請開啟原文確認";
  const summary = shown.join("；");
  return summary.length > 180 ? `${summary.slice(0, 177)}…` : summary;
}

function isVagueModelKeyword(keyword: string): boolean {
  return /^\d{1,3}$/.test(keyword.trim());
}

export function matchToken(compactText: string, token: string): boolean {
  if (compactText.includes(token)) return true;
  if (token.endsWith("gb")) {
    const withoutB = token.slice(0, -1);
    if (compactText.includes(withoutB)) return true;
    const numOnly = token.slice(0, -2);
    if (compactText.includes(numOnly)) return true;
  }
  if (token.endsWith("tb")) {
    const withoutB = token.slice(0, -1);
    if (compactText.includes(withoutB)) return true;
  }
  return false;
}

export function keywordMatchesText(text: string, keyword: string): boolean {
  const compact = compactText(text);
  const compactKw = compactText(keyword);
  if (!compactKw) return false;
  if (compact.includes(compactKw)) return true;
  const tokens = keyword.split(/[\s/_-]+/).map(compactText).filter(Boolean);
  return tokens.length > 1 && tokens.every((token) => matchToken(compact, token));
}

export function classifyArticle(article: Article, keywords: string[]): SearchResult {
  const source = `${article.title}\n${article.content}`;
  const matchedKeywords = unique(
    keywords.filter(
      (keyword) => !isVagueModelKeyword(keyword) && keywordMatchesText(source, keyword),
    ),
  );
  const priceResult = extractPrices(source);
  const lines = itemLines(source);
  const capacities = extractCapacities(lines);
  const colors = extractColors(lines);
  const soldStatus = extractSoldStatus(source);
  return {
    ...article,
    matchedKeywords,
    model: matchedKeywords.join("、"),
    storage: capacities.join("、"),
    price: priceResult.price,
    pricesFound: priceResult.values,
    color: colors.join("、"),
    soldStatus,
    sold: soldStatus === "已售出",
    locations: extractLocations(source),
    condition: extractCondition(article.content),
  };
}
