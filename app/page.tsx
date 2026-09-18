"use client";

import { FormEvent, useMemo, useRef, useState } from "react";

import { downloadResultsExcel } from "@/lib/export-excel";
import { DEFAULT_BOARDS, type SearchResponse, type SearchResult } from "@/lib/types";

type SortKey =
  | "board"
  | "publishedAt"
  | "model"
  | "storage"
  | "price"
  | "color"
  | "soldStatus"
  | "locations"
  | "title";

type SortState = { key: SortKey; direction: "asc" | "desc" };

function splitValues(value: string): string[] {
  return [...new Set(value.split(/[,，;；\n]+/).map((part) => part.trim()).filter(Boolean))];
}

function splitBoards(value: string): string[] {
  return [...new Set(value.split(/[,，\s]+/).map((part) => part.trim()).filter(Boolean))];
}

function formatPrice(value: number | null): string {
  return value === null ? "價格未知" : `$${value.toLocaleString("zh-TW")}`;
}

function formatPublished(value: string, fallback: string): string {
  if (!value) return fallback || "日期未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function sourceLabel(source: SearchResult["source"]): string {
  if (source === "jina") return "即時中繼";
  if (source === "pttweb") return "延遲鏡像";
  return "PTT 直連";
}

function sortableValue(result: SearchResult, key: SortKey): string | number {
  if (key === "price") return result.price ?? Number.MAX_SAFE_INTEGER;
  if (key === "locations") return result.locations.join("、");
  return result[key];
}

export default function HomePage() {
  const [selectedBoards, setSelectedBoards] = useState<string[]>(["MacShop", "mobilesales"]);
  const [customBoards, setCustomBoards] = useState("");
  const [keywords, setKeywords] = useState("iPhone 16 Pro");
  const [maxBudget, setMaxBudget] = useState("30000");
  const [locations, setLocations] = useState("");
  const [pages, setPages] = useState(3);
  const [includeSold, setIncludeSold] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [candidateCount, setCandidateCount] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [filterText, setFilterText] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "publishedAt", direction: "desc" });
  const [status, setStatus] = useState("設定搜尋條件後，按下開始搜尋。");
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [exporting, setExporting] = useState(false);
  const abortController = useRef<AbortController | null>(null);

  const visibleResults = useMemo(() => {
    const filter = filterText.trim().toLocaleLowerCase();
    const filtered = filter
      ? results.filter((result) =>
          [
            result.board,
            result.title,
            result.model,
            result.storage,
            result.color,
            result.locations.join(" "),
            result.condition,
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(filter),
        )
      : [...results];

    return filtered.sort((left, right) => {
      const leftValue = sortableValue(left, sort.key);
      const rightValue = sortableValue(right, sort.key);
      const comparison =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), "zh-Hant", { numeric: true });
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [filterText, results, sort]);

  function toggleBoard(board: string) {
    setSelectedBoards((current) =>
      current.includes(board) ? current.filter((value) => value !== board) : [...current, board],
    );
  }

  function changeSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "price" ? "asc" : "desc" },
    );
  }

  function sortLabel(label: string, key: SortKey): string {
    if (sort.key !== key) return label;
    return `${label} ${sort.direction === "asc" ? "↑" : "↓"}`;
  }

  async function startSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const boards = [...new Set([...selectedBoards, ...splitBoards(customBoards)])].filter((board) =>
      /^[A-Za-z0-9_.-]+$/.test(board),
    );
    const keywordValues = splitValues(keywords);
    if (!boards.length || !keywordValues.length) {
      setError("請至少選擇一個看板，並輸入一個搜尋關鍵字。");
      return;
    }

    const controller = new AbortController();
    abortController.current = controller;
    setSearching(true);
    setError("");
    setWarnings([]);
    setResults([]);
    setCandidateCount(0);
    setStatus(`正在搜尋 ${boards.length} 個看板，請稍候…`);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          boards,
          keywords: keywordValues,
          maxBudget: maxBudget.trim() ? Number(maxBudget) : null,
          locations: splitValues(locations),
          pages,
          includeSold,
        }),
      });
      const data = (await response.json()) as SearchResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || `搜尋服務回應 HTTP ${response.status}`);
      setResults(data.results);
      setWarnings(data.warnings);
      setCandidateCount(data.candidateCount);
      setElapsedMs(data.elapsedMs);
      setStatus(
        `搜尋完成：${data.candidateCount} 篇候選文章，顯示 ${data.results.length} 筆結果，耗時 ${(
          data.elapsedMs / 1000
        ).toFixed(1)} 秒。`,
      );
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        setStatus("搜尋已停止。");
      } else {
        setError(caught instanceof Error ? caught.message : "搜尋發生未知錯誤。");
        setStatus("搜尋失敗，請檢查下方訊息。");
      }
    } finally {
      abortController.current = null;
      setSearching(false);
    }
  }

  function stopSearch() {
    setStatus("正在停止搜尋…");
    abortController.current?.abort();
  }

  async function exportExcel() {
    if (!results.length) return;
    setExporting(true);
    setError("");
    try {
      await downloadResultsExcel(results);
    } catch (caught) {
      setError(caught instanceof Error ? `Excel 匯出失敗：${caught.message}` : "Excel 匯出失敗。");
    } finally {
      setExporting(false);
    }
  }

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">PTT PHONE FINDER</span>
          <h1>二手手機搜尋，<br />整理後再看。</h1>
          <p>直接搜尋 PTT 最新文章，以本機規則整理價格、容量、顏色、地區與售出狀態。不使用 AI，也不需要 API Key。</p>
        </div>
        <div className="hero-stats" aria-label="服務特色">
          <div><strong>0</strong><span>API Key</span></div>
          <div><strong>5</strong><span>頁／看板上限</span></div>
          <div><strong>XLSX</strong><span>一鍵下載</span></div>
        </div>
      </section>

      <section className="panel search-panel">
        <form onSubmit={startSearch}>
          <div className="section-heading">
            <div><span className="step">01</span><h2>搜尋條件</h2></div>
            <p>預設搜尋 MacShop 與 mobilesales 最近三頁。</p>
          </div>

          <fieldset>
            <legend>常用看板</legend>
            <div className="board-grid">
              {DEFAULT_BOARDS.map((board) => (
                <label className="check-card" key={board}>
                  <input
                    type="checkbox"
                    checked={selectedBoards.includes(board)}
                    onChange={() => toggleBoard(board)}
                  />
                  <span>{board}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="form-grid">
            <label className="field span-two">
              <span>自訂看板</span>
              <input
                value={customBoards}
                onChange={(event) => setCustomBoards(event.target.value)}
                placeholder="例如：MacShop, mobilesales"
                disabled={searching}
              />
            </label>
            <label className="field span-two">
              <span>手機型號／關鍵字</span>
              <input
                value={keywords}
                onChange={(event) => setKeywords(event.target.value)}
                placeholder="多個關鍵字用逗號分隔"
                required
                disabled={searching}
              />
            </label>
            <label className="field">
              <span>最高預算</span>
              <div className="input-suffix">
                <input
                  type="number"
                  min="0"
                  max="10000000"
                  step="1000"
                  value={maxBudget}
                  onChange={(event) => setMaxBudget(event.target.value)}
                  placeholder="留空不限"
                  disabled={searching}
                />
                <span>元</span>
              </div>
            </label>
            <label className="field">
              <span>限定地區</span>
              <input
                value={locations}
                onChange={(event) => setLocations(event.target.value)}
                placeholder="例如：台北, 新竹"
                disabled={searching}
              />
            </label>
            <label className="field">
              <span>每個看板搜尋頁數</span>
              <select value={pages} onChange={(event) => setPages(Number(event.target.value))} disabled={searching}>
                {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} 頁</option>)}
              </select>
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={includeSold}
                onChange={(event) => setIncludeSold(event.target.checked)}
                disabled={searching}
              />
              <span>包含已售出文章</span>
            </label>
          </div>

          <div className="action-row">
            <button className="primary-button" type="submit" disabled={searching}>
              {searching ? <span className="spinner" aria-hidden="true" /> : <span aria-hidden="true">⌕</span>}
              {searching ? "搜尋中…" : "開始搜尋"}
            </button>
            <button className="secondary-button danger" type="button" onClick={stopSearch} disabled={!searching}>停止</button>
            <span className="status-text" aria-live="polite">{status}</span>
          </div>
        </form>
      </section>

      {error && <div className="message error-message" role="alert">{error}</div>}
      {!!warnings.length && (
        <details className="message warning-message">
          <summary>搜尋完成，但有 {warnings.length} 項提示</summary>
          <ul>{warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
        </details>
      )}

      <section className="panel results-panel">
        <div className="section-heading results-heading">
          <div><span className="step">02</span><h2>搜尋結果</h2></div>
          <div className="result-actions">
            <input
              className="result-filter"
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              placeholder="篩選目前結果"
              aria-label="篩選目前結果"
            />
            <button className="secondary-button" type="button" onClick={() => setResults([])} disabled={!results.length || searching}>清除</button>
            <button className="export-button" type="button" onClick={exportExcel} disabled={!results.length || exporting}>
              {exporting ? "產生中…" : "下載 Excel"}
            </button>
          </div>
        </div>

        {!!results.length && (
          <div className="summary-strip">
            <span><strong>{results.length}</strong> 筆結果</span>
            <span><strong>{candidateCount}</strong> 篇候選</span>
            <span><strong>{(elapsedMs / 1000).toFixed(1)}</strong> 秒</span>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th><button onClick={() => changeSort("board")}>{sortLabel("看板", "board")}</button></th>
                <th>資料來源</th>
                <th><button onClick={() => changeSort("publishedAt")}>{sortLabel("發文時間", "publishedAt")}</button></th>
                <th><button onClick={() => changeSort("model")}>{sortLabel("型號", "model")}</button></th>
                <th><button onClick={() => changeSort("storage")}>{sortLabel("容量", "storage")}</button></th>
                <th className="number"><button onClick={() => changeSort("price")}>{sortLabel("價格", "price")}</button></th>
                <th><button onClick={() => changeSort("color")}>{sortLabel("顏色", "color")}</button></th>
                <th><button onClick={() => changeSort("soldStatus")}>{sortLabel("狀態", "soldStatus")}</button></th>
                <th><button onClick={() => changeSort("locations")}>{sortLabel("地區", "locations")}</button></th>
                <th>商品狀況</th>
                <th><button onClick={() => changeSort("title")}>{sortLabel("PTT 原文", "title")}</button></th>
              </tr>
            </thead>
            <tbody>
              {visibleResults.map((result) => (
                <tr key={result.url}>
                  <td><span className="board-badge">{result.board}</span></td>
                  <td><span className={`source-badge ${result.source ?? "ptt"}`}>{sourceLabel(result.source)}</span></td>
                  <td className="date-cell">{formatPublished(result.publishedAt, result.listDate)}</td>
                  <td><strong>{result.model || "命中關鍵字"}</strong></td>
                  <td>{result.storage || "未知"}</td>
                  <td className="number price" title={result.pricesFound.length ? `候選：${result.pricesFound.join("、")}` : undefined}>
                    {formatPrice(result.price)}
                  </td>
                  <td>{result.color || "未提供"}</td>
                  <td><span className={`status-badge ${result.sold ? "sold" : "active"}`}>{result.soldStatus}</span></td>
                  <td>{result.locations.join("、") || "未提供"}</td>
                  <td className="condition-cell">{result.condition}</td>
                  <td className="title-cell"><a href={result.url} target="_blank" rel="noreferrer">{result.title}<span aria-hidden="true"> ↗</span></a></td>
                </tr>
              ))}
              {!visibleResults.length && (
                <tr><td className="empty-state" colSpan={11}>{searching ? "正在搜尋 PTT…" : results.length ? "目前篩選條件沒有結果。" : "尚未搜尋，結果會顯示在這裡。"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer>
        <p>本工具只整理 PTT 公開文章，不保存搜尋內容。請確認商品資訊並注意交易安全。</p>
      </footer>
    </main>
  );
}
