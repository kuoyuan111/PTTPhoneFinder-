import { NextResponse } from "next/server";
import { z } from "zod";

import { searchPtt } from "../../../lib/ptt-crawler";
import { validSearchKeyword } from "../../../lib/search-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SearchSchema = z.object({
  boards: z
    .array(
      z
        .string()
        .transform((value) => value.trim())
        .pipe(z.string().min(1).max(32).regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/))
        .refine((value) => value !== "." && value !== "..", "看板名稱不可為路徑片段"),
    )
    .transform((values) => [...new Set(values)])
    .pipe(z.array(z.string()).min(1).max(6)),
  keywords: z
    .array(
      z
        .string()
        .trim()
        .transform((value) => value.replace(/\s+/g, " "))
        .pipe(z.string().min(1).max(80).refine(validSearchKeyword, "關鍵字不含目前支援的可搜尋字元")),
    )
    .transform((values) => [...new Set(values)])
    .pipe(z.array(z.string()).min(1).max(10)),
  maxBudget: z.number().int().min(0).max(10_000_000).nullable().optional().default(null),
  locations: z
    .array(z.string().trim().transform((value) => value.replace(/\s+/g, " ")).pipe(z.string().min(1).max(20)))
    .transform((values) => [...new Set(values)])
    .pipe(z.array(z.string()).max(10))
    .optional()
    .default([]),
  pages: z.number().int().min(1).max(5).optional().default(3),
  includeSold: z.boolean().optional().default(false),
});

const RATE_WINDOW_MS = 5 * 60_000;
const RATE_LIMIT = 8;
const MAX_TRACKED_CLIENTS = 2_048;
const MAX_BODY_BYTES = 64 * 1024;
const requestsByClient = new Map<string, number[]>();

function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 100) || "local";
}

function cleanupRateLimits(now: number): void {
  const cutoff = now - RATE_WINDOW_MS;
  for (const [client, timestamps] of requestsByClient) {
    const active = timestamps.filter((timestamp) => timestamp >= cutoff);
    if (active.length) requestsByClient.set(client, active);
    else requestsByClient.delete(client);
  }
  if (requestsByClient.size <= MAX_TRACKED_CLIENTS) return;
  const oldestClients = [...requestsByClient.entries()]
    .sort((left, right) => (left[1][0] ?? 0) - (right[1][0] ?? 0))
    .slice(0, requestsByClient.size - MAX_TRACKED_CLIENTS);
  for (const [client] of oldestClients) requestsByClient.delete(client);
}

function rateLimitResult(client: string): { limited: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  cleanupRateLimits(now);
  const cutoff = now - RATE_WINDOW_MS;
  const active = (requestsByClient.get(client) ?? []).filter((timestamp) => timestamp >= cutoff);
  if (active.length >= RATE_LIMIT) {
    requestsByClient.set(client, active);
    const retryAfterMs = Math.max(1, (active[0] ?? now) + RATE_WINDOW_MS - now);
    return { limited: true, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
  }
  active.push(now);
  requestsByClient.set(client, active);
  return { limited: false, retryAfterSeconds: 0 };
}

class RequestBodyTooLargeError extends Error {
  name = "RequestBodyTooLargeError";
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.body) throw new SyntaxError("Request body is missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function POST(request: Request): Promise<NextResponse> {
  const rateLimit = rateLimitResult(clientAddress(request));
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "搜尋次數過於頻繁，請五分鐘後再試。" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  let json: unknown;
  try {
    json = await readJson(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "請求內容過大。" }, { status: 413 });
    }
    return NextResponse.json({ error: "請求內容不是有效的 JSON。" }, { status: 400 });
  }

  const parsed = SearchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "搜尋條件格式不正確。" }, { status: 400 });
  }

  try {
    const response = await searchPtt(parsed.data, request.signal);
    return NextResponse.json(response, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "搜尋已取消。" }, { status: 499 });
    }
    return NextResponse.json({ error: "搜尋服務暫時無法完成，請稍後再試。" }, { status: 500 });
  }
}
