import { describe, expect, it } from "vitest";

import { allocateRealtimePages, toJinaReaderUrl } from "@/lib/ptt-crawler";

describe("PTT realtime source helpers", () => {
  it("keeps all requested pages when they fit the realtime list budget", () => {
    expect(allocateRealtimePages(2, 3)).toEqual([3, 3]);
  });

  it("distributes constrained pages fairly and preserves one latest page per board", () => {
    expect(allocateRealtimePages(6, 5)).toEqual([2, 2, 1, 1, 1, 1]);
  });

  it("constructs a fixed Jina Reader URL only for PTT", () => {
    expect(toJinaReaderUrl("https://www.ptt.cc/bbs/MacShop/index.html")).toBe(
      "https://r.jina.ai/http://www.ptt.cc/bbs/MacShop/index.html",
    );
    expect(() => toJinaReaderUrl("https://example.com/private")).toThrow("非 PTT 網址");
  });
});
