export const DEFAULT_BOARDS = [
  "MacShop",
  "mobilesales",
  "iOS",
  "MobileComm",
  "nb-shopping",
  "HardwareSale",
] as const;

export interface Article {
  board: string;
  title: string;
  url: string;
  source?: "ptt" | "jina" | "pttweb";
  author: string;
  listDate: string;
  publishedAt: string;
  content: string;
}

export interface SearchRequest {
  boards: string[];
  keywords: string[];
  maxBudget: number | null;
  locations: string[];
  pages: number;
  includeSold: boolean;
}

export interface SearchResult extends Article {
  matchedKeywords: string[];
  model: string;
  storage: string;
  price: number | null;
  pricesFound: number[];
  color: string;
  soldStatus: "已售出" | "未售出" | "未判斷";
  sold: boolean;
  locations: string[];
  condition: string;
}

export interface SearchResponse {
  results: SearchResult[];
  candidateCount: number;
  elapsedMs: number;
  warnings: string[];
}
