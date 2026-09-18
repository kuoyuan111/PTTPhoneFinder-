import { NextResponse } from "next/server";
import { z } from "zod";

import { searchPtt } from "@/lib/ptt-crawler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SearchSchema = z.object({
  boards: z.array(z.string().regex(/^[A-Za-z0-9_.-]+$/).min(1).max(40)).min(1).max(6),
  keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
  maxBudget: z.number().int().min(0).max(10_000_000).nullable(),
  locations: z.array(z.string().trim().min(1).max(20)).max(10),
  pages: z.number().int().min(1).max(5),
  includeSold: z.boolean(),
});

const RATE_WINDOW_MS = 5 * 60_000;
const RATE_LIMIT = 8;
const requestsByClient = new Map<string, number[]>();

function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function isRateLimited(client: string): boolean {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  const active = (requestsByClient.get(client) ?? []).filter((timestamp) => timestamp >= cutoff);
  if (active.length >= RATE_LIMIT) {
    requestsByClient.set(client, active);
    return true;
  }
  active.push(Date.now());
  requestsByClient.set(client, active);
  return false;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (isRateLimited(clientAddress(request))) {
    return NextResponse.json(
      { error: "搜尋次數過於頻繁，請五分鐘後再試。" },
      { status: 429, headers: { "Retry-After": "300" } },
    );
  }

  try {
    const json: unknown = await request.json();
    const parsed = SearchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "搜尋條件格式不正確。" }, { status: 400 });
    }
    const response = await searchPtt(parsed.data, request.signal);
    return NextResponse.json(response, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "搜尋已取消。" }, { status: 499 });
    }
    const message = error instanceof Error ? error.message : "未知錯誤";
    return NextResponse.json({ error: `搜尋失敗：${message.slice(0, 240)}` }, { status: 500 });
  }
}
