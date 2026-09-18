"use client";

import { FormEvent, useEffect, useMemo, useReducer, useState } from "react";

import { formatArticleTimeTaiwan } from "@/lib/article-time";
import { BUILD_VERSION_LABEL } from "@/lib/build-version";
import {
  createSearchRequestGate, DEFAULT_SORT, emptyResultsMessage, emptySearchView,
  searchViewReducer, selectVisibleResults, validBoardName, validKeyword,
  type SortKey, type SortState,
} from "@/lib/search-ui";
import { downloadResultsExcel } from "@/lib/export-excel";
import { DEFAULT_BOARDS, type SearchResponse, type SearchResult } from "@/lib/types";

function splitValues(value: string): string[] {
  return [...new Set(value.split(/[,，;；\n]+/).map((part) => part.trim()).filter(Boolean))];
}

function splitBoards(value: string): string[] {
  return [...new Set(value.split(/[,，\s]+/).map((part) => part.trim()).filter(Boolean))];
}

function formatPrice(value: number | null): string {
  return value === null ? "價格未知" : `$${value.toLocaleString("zh-TW")}`;
}

function sourceLabel(source: SearchResult["source"]): string {
  if (source === "jina") return "中繼抓取";
  if (source === "pttweb") return "延遲鏡像";
  return "PTT 直連";
}

export default function HomePage() {
  const [selectedBoards, setSelectedBoards] = useState<string[]>(["MacShop", "mobilesales"]);
  const [customBoards, setCustomBoards] = useState("");
  const [keywords, setKeywords] = useState("iPhone 16 Pro");
  const [maxBudget, setMaxBudget] = useState("30000");
  const [locations, setLocations] = useState("");
  const [pages, setPages] = useState(3);
  const [includeSold, setIncludeSold] = useState(false);
  const [view, dispatch] = useReducer(searchViewReducer, undefined, emptySearchView);
  const { results, warnings, candidateCount, elapsedMs, status, error, phase: searchPhase } = view;
  const searching = searchPhase === "searching";
  const [filterText, setFilterText] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [exporting, setExporting] = useState(false);
  const [requests] = useState(createSearchRequestGate);

  useEffect(() => {
    return () => requests.cancel();
  }, [requests]);

  const visibleResults = useMemo(
    () => selectVisibleResults(results, filterText, sort), [filterText, results, sort],
  );

  function setError(error: string) { dispatch({ type: "error", error }); }

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
    requests.cancel();
    dispatch({ type: "clear" });
    const customBoardValues = splitBoards(customBoards);
    const invalidCustomBoards = customBoardValues.filter(
      (board) => !validBoardName(board),
    );
    if (invalidCustomBoards.length) {
      setError(`自訂看板名稱無效：${invalidCustomBoards.join("、")}。請以英文字母或數字開頭，限 1–32 個英數字、底線或連字號。`);
      return;
    }
    const boards = [...new Set([...selectedBoards, ...customBoardValues])];
    const keywordValues = splitValues(keywords);
    if (boards.length > 6) {
      setError("最多可搜尋 6 個看板，請移除部分自訂看板。");
      return;
    }
    if (!boards.length || !keywordValues.length || !keywordValues.every(validKeyword)) {
      setError("請至少選擇一個看板；每個關鍵字需包含英數字或中文字，不能只有標點符號。");
      return;
    }
    const budgetValue = maxBudget.trim() ? Number(maxBudget) : null;
    if (budgetValue !== null && (!Number.isFinite(budgetValue) || budgetValue < 0)) {
      setError("預算金額必須為有效的正整數。");
      return;
    }

    const controller = requests.start();
    dispatch({ type: "start", boardCount: boards.length });
    setFilterText("");

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          boards,
          keywords: keywordValues,
          maxBudget: budgetValue,
          locations: splitValues(locations),
          pages,
          includeSold,
        }),
      });
      const data = (await response.json().catch(() => {
        throw new Error("搜尋服務回應無法讀取，請稍後再試。");
      })) as SearchResponse & { error?: string };
      if (!requests.isCurrent(controller)) return;
      if (!response.ok) throw new Error(data.error || `搜尋服務回應 HTTP ${response.status}`);
      dispatch({ type: "complete", data });
    } catch (caught) {
      if (!requests.isCurrent(controller)) return;
      if (caught instanceof Error && caught.name === "AbortError") {
        dispatch({ type: "stop" });
      } else {
        dispatch({ type: "fail", error: caught instanceof Error ? caught.message : "搜尋失敗，請稍後再試。" });
      }
    } finally {
      requests.finish(controller);
    }
  }

  function stopSearch() {
    requests.cancel();
    dispatch({ type: "stop" });
  }

  async function exportExcel() {
    if (!visibleResults.length) return;
    setExporting(true);
    setError("");
    try {
      await downloadResultsExcel(visibleResults);
    } catch (caught) {
      setError(caught instanceof Error ? `Excel 匯出失敗：${caught.message}` : "Excel 匯出失敗。");
    } finally {
      setExporting(false);
    }
  }

  function clearResults() {
    requests.cancel();
    dispatch({ type: "clear" });
    setFilterText("");
    setSort(DEFAULT_SORT);
  }

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow-row">
            <span className="eyebrow">PTT PHONE FINDER</span>
            <span className="site-version" aria-label={`網站版本 ${BUILD_VERSION_LABEL}`}>版本 {BUILD_VERSION_LABEL}</span>
          </div>
          <h1>二手手機搜尋，<br />整理後再看。</h1>
          <p>搜尋 PTT 公開文章，整理價格、容量、顏色、地區與售出狀態。中繼或鏡像資料可能延遲，交易前請確認原文。不使用 AI，也不需要 API Key。</p>
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
                    disabled={searching}
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
                  step="1"
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
            <button className="secondary-button" type="button" onClick={clearResults} disabled={searching || exporting}>清除</button>
            <button className="export-button" type="button" onClick={exportExcel} disabled={!visibleResults.length || exporting}>
              {exporting ? "產生中…" : `下載目前 ${visibleResults.length} 筆 Excel`}
            </button>
          </div>
        </div>

        {searchPhase === "completed" && (
          <div className="summary-strip">
            <span>顯示 <strong>{visibleResults.length}</strong> / <strong>{results.length}</strong> 筆結果</span>
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
                <th><button onClick={() => changeSort("publishedAt")}>{sortLabel("發文時間（台灣）", "publishedAt")}</button></th>
                <th><button onClick={() => changeSort("model")}>{sortLabel("命中關鍵字", "model")}</button></th>
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
                  <td className="date-cell">{formatArticleTimeTaiwan(result.publishedAt, result.url, result.listDate)}</td>
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
                <tr><td className="empty-state" colSpan={11}>
                  {emptyResultsMessage(searchPhase, results.length)}
                </td></tr>
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
