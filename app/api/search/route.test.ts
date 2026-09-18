import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchResponse } from "@/lib/types";

const { searchPtt } = vi.hoisted(() => ({ searchPtt: vi.fn() }));

vi.mock("../../../lib/ptt-crawler", () => ({ searchPtt }));

import { POST } from "./route";

const response: SearchResponse = { results: [], candidateCount: 0, elapsedMs: 1, warnings: [] };

function request(body: string, client = `test-${Math.random()}`): Request {
  return new Request("http://localhost/api/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": client },
    body,
  });
}

function validBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    boards: [" MacShop ", "MacShop"],
    keywords: [" iPhone 16 Pro "],
    maxBudget: 0,
    locations: [],
    pages: 1,
    includeSold: false,
    ...overrides,
  });
}

describe("POST /api/search", () => {
  beforeEach(() => {
    searchPtt.mockReset().mockResolvedValue(response);
  });

  it("returns 400 for malformed JSON instead of leaking a server error", async () => {
    const result = await POST(request("{\"boards\":", "malformed-json"));

    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "請求內容不是有效的 JSON。" });
    expect(searchPtt).not.toHaveBeenCalled();
  });

  it("normalizes and deduplicates boards while preserving maxBudget zero", async () => {
    const result = await POST(request(validBody(), "normalized-input"));

    expect(result.status).toBe(200);
    expect(searchPtt).toHaveBeenCalledWith(
      expect.objectContaining({ boards: ["MacShop"], maxBudget: 0 }),
      expect.any(AbortSignal),
    );
  });

  it.each([
    [".", "看板 path fragment"],
    ["..", "parent path fragment"],
    ["Foo.Bar", "dot is not supported by crawler"],
    ["a".repeat(33), "board names are limited to 32 characters"],
  ])("rejects board %s", async (board) => {
    const result = await POST(request(validBody({ boards: [board] }), `invalid-board-${board}`));

    expect(result.status).toBe(400);
    expect(searchPtt).not.toHaveBeenCalled();
  });

  it("rejects punctuation-only keywords", async () => {
    const result = await POST(request(validBody({ keywords: ["--- !!!"] }), "punctuation-keyword"));

    expect(result.status).toBe(400);
    expect(searchPtt).not.toHaveBeenCalled();
  });

  it.each(["かな", "한글", "é"])("rejects unsupported Unicode-only keyword %s", async (keyword, index) => {
    const result = await POST(request(validBody({ keywords: [keyword] }), `unsupported-keyword-${index}`));

    expect(result.status).toBe(400);
    expect(searchPtt).not.toHaveBeenCalled();
  });

  it.each(["iPhone 17", "手機"])("accepts classifier-supported keyword %s", async (keyword, index) => {
    const result = await POST(request(validBody({ keywords: [keyword] }), `supported-keyword-${index}`));

    expect(result.status).toBe(200);
    expect(searchPtt).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: [keyword] }),
      expect.any(AbortSignal),
    );
  });

  it("bounds the actual body bytes before parsing", async () => {
    const result = await POST(request(`${" ".repeat(65 * 1024)}\n`, "oversized-body"));

    expect(result.status).toBe(413);
    expect(searchPtt).not.toHaveBeenCalled();
  });

  it("returns an actual Retry-After value when the client is rate limited", async () => {
    const client = "rate-limited-client";
    for (let index = 0; index < 8; index += 1) await POST(request(validBody(), client));
    const result = await POST(request(validBody(), client));

    expect(result.status).toBe(429);
    expect(Number(result.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
