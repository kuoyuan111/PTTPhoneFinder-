# PTTPhoneFinder 系統架構與功能規格說明文件 (AI Reference Guide)

本文件專為接續開發、維護或重構此專案的 AI 代理人所撰寫，詳細記錄了此專案的目錄架構、各模組職責、資料處理流程、設計考量與後續維護要點。

---

## 1. 專案概述 (Project Overview)

- **專案名稱**：PTT 二手手機搜尋工具 (PTTPhoneFinder)
- **類型**：Windows 桌面 GUI 單機工具（無伺服器架構、手動單次觸發）
- **核心目標**：協助使用者從 PTT 多個二手交易看板（如 `MacShop`、`mobilesales` 等）快速抓取最新文章；預設以純 Python 關鍵字列出結果，也可選擇使用 GUI 指定的 Google Gemini 模型進行結構化抽取。
- **技術棧 (Tech Stack)**：
  - **GUI 框架**：`PySide6` (Qt 6 for Python)
  - **HTTP 爬蟲與解析**：`requests`, `truststore`, `beautifulsoup4`
  - **Excel 輸出**：`openpyxl`
  - **可選 LLM SDK**：`google-genai` (官方最新 Google GenAI SDK，非舊版 `google-generativeai`)
  - **可選模型**：預設 `gemini-2.5-flash`（使用 JSON Schema 結構化輸出）
  - **執行環境**：Python 3.11+ (Windows 環境)

---

## 2. 檔案目錄結構與職責 (File Structure)

```text
C:\WORK\tool\PTTPhoneFinder
├── .gitignore          # Git 忽略清單（排除 .venv、__pycache__、seen_articles.json、日誌等）
├── requirements.txt    # 依賴套件清單 (PySide6, requests, beautifulsoup4, openpyxl, optional google-genai)
├── setup_windows.bat   # Windows 初始安裝腳本（檢查 Python 3.11+、建立 .venv、安裝 requirements）
├── run_windows.bat     # Windows 啟動腳本（啟動虛擬環境並執行 main.py）
├── README.md           # 面向終端使用者的安裝與使用操作說明手冊
├── PROJECT_OVERVIEW.md # [本文件] 面向後續維護 AI / 開發者的完整技術與功能規格
└── main.py             # 專案核心原始碼（約 760 行，整合 UI、爬蟲、LLM 解析與背景執行緒）
```

---

## 3. 核心資料流程 (Data Pipeline & Workflow)

整個搜尋生命週期由使用者在 UI 點擊「開始搜尋」後，於後台執行緒 `SearchWorker` 執行共同的抓取與關鍵字篩選；之後依搜尋模式分流：純 Python 直接列出文章，Gemini 模式才擷取內文並呼叫 AI。

```
[使用者點擊開始搜尋]
         │
         ▼
┌─────────────────────────────────┐
│ 階段一：PTT 看板清單分頁爬取     │ ── 遍歷指定看板 (如 MacShop, mobilesales) 最新 N 頁
└─────────────────────────────────┘
         │ 取得 Article(title, url, author, list_date)
         ▼
┌─────────────────────────────────┐
│ 階段二：本機標題關鍵字篩選       │ ── 標題包含目標型號或關鍵字
└─────────────────────────────────┘   Gemini 模式另排除徵求/交換/已售出及已分析文章
         │ 候選文章 (Candidates)
         ▼
┌─────────────────────────────────┐
│ 階段三：依模式分流               │ ── 純 Python：抓取內文並用規則分類
└─────────────────────────────────┘   Gemini：抓取內文後使用結構化 AI 分析
         │
         ├──────── 純 Python ────────► UI 結果呈現
         │
         ▼ Gemini 模式
┌─────────────────────────────────┐
│ 階段四：內文擷取與文本清洗       │ ── 抓取文章 HTML，移除推文 (.push)、
└─────────────────────────────────┘   頁首資訊 (.article-metaline)、發信站簽名檔，
         │                             限制最大長度 18,000 字元（降低 Token 消耗）
         ▼
┌─────────────────────────────────┐
│ 階段五：GUI 選定的 Gemini 模型結構抽取│ ── 透過 Structured Output (JSON Schema)
└─────────────────────────────────┘   抽取：是否為手機賣文、型號、容量、新台幣售價、
         │                             面交縣市、車況/外觀摘要 (≤60字)、售出狀態、信心度
         │ 寫入 SeenArticleStore (確保失敗時可重試、成功時不重複花費 Token)
         ▼
┌─────────────────────────────────┐
│ 階段六：本機二次精準過濾         │ ── 1. 確認 is_phone_sale=True 且 sold=False
└─────────────────────────────────┘   2. 型號+容量比對關鍵字
         │                             3. 價格 ≤ 使用者最高預算
         │                             4. 交易縣市符合使用者指定地區
         │ 通過篩選的商品
         ▼
┌─────────────────────────────────┐
│ 階段七：UI 結果呈現與互動        │ ── 1. 新增至 QTableWidget（價格欄支援數值排序）
└─────────────────────────────────┘   2. 即時 Log 輸出與狀態列更新
                                       3. 使用者雙擊列表列可呼叫預設瀏覽器開啟 PTT 原文
```

---

## 4. `main.py` 核心類別與模組解析

### 4.1 資料結構
- **`Article` (dataclass)**:
  - 儲存文章欄位：`board`, `title`, `url`, `author`, `list_date`, `published_at`, `content`。
- **`SearchOptions` (dataclass)**:
  - 封裝搜尋條件：`api_key`, `boards`, `keywords`, `max_budget`, `locations`, `pages`, `unseen_only`。

### 4.2 工具函式
- **`split_board_values(text)`**: 支援中英文逗號、空白、換行分割看板名稱，並按輸入順序去重。
- **`split_filter_values(text)`**: 分割關鍵字與地區（只依逗號/分號/換行分割，以保留如 `iPhone 16 Pro` 內部的空格）。
- **`compact_text(text)`**: 移除空白及特殊符號並轉小寫（例：`iPhone 16 Pro` -> `iphone16pro`），供字串模糊比對。
- **`normalize_location(text)`**: 將「臺」正規化為「台」，並移除結尾的「縣/市/區/鄉/鎮」，提升地區比對命中率。
- **`safe_error(exc, secret)`**: 異常防呆遮罩，自動將例外訊息中的 Gemini API Key 替換為 `***`，避免 Key 洩漏至 Log 介面。

### 4.3 `SeenArticleStore`（已讀紀錄存取器）
- **儲存路徑**：Windows 的 `QStandardPaths.AppDataLocation/seen_articles.json`。
- **主鍵 (Key)**：文章 URL 的檔名 stem（例如 `M.1710000000.A.123`）。
- **安全性設計**：寫入時先寫入 `.tmp` 暫存檔，再進行原子性替換 (`replace`)，避免斷電或程式被強制中斷導致 JSON 損壞。
- **機制**：只有在文章成功通過 Gemini 解析後才加入紀錄；若網路超時或 API 報錯則不計入已讀，保留下次重試機會。

### 4.4 `PTTMacShopCrawler`（PTT 爬蟲）
- **Session 設定**：自帶 Cookie `over18: 1` 繞過年齡確認頁；自訂 User-Agent。
- **超時與延遲**：連線 timeout `(8, 20)` 秒；每次請求間隔 `time.sleep(0.45)` 避免被 PTT 暫時封鎖 IP。
- **看板存在性判斷**：處理 HTTP 404 及 PTT 找不到看板時回傳的特定 HTML 提示，自定義拋出 `PTTBoardNotFound` 例外。
- **內文清理**：透過 BeautifulSoup 移除 `.push` (推文)、`.article-metaline`，並從 `※ 發信站:` 切割，截斷至前 18,000 字元。

### 4.5 `PythonArticleClassifier`（本機規則分類器）
- 不需要 API Key 或網路 AI 服務，使用正規表示式與關鍵字從文章內容抽取：價格、容量、顏色、售出狀態與命中關鍵字。
- 文章頁的 PTT 日期會解析成完整的 `YYYY-MM-DD` 與 `HH:MM:SS`；解析不到時保留原始日期文字，不自行猜測年份。

### 4.6 `GeminiParser`（可選的 LLM 結構化抽取器）
- **SDK 與模型**：`from google import genai`，使用 `client = genai.Client(api_key=...)`；預設為 `gemini-3.6-flash`，實際模型由 GUI 選擇或輸入。
- **輸出控制 (Structured Output)**：使用 `config={"response_mime_type": "application/json", "response_json_schema": RESPONSE_SCHEMA}`。
- **抽取欄位**：
  - `is_phone_sale` (bool): 僅在賣家出售手機本體時為 true（徵求、換物、售出、零件機為 false）。
  - `model` (string | null): 手機品牌與型號。
  - `storage` (string | null): 儲存容量（如 256G）。
  - `price` (int | null): 新台幣整數（中文萬位數字或逗點會轉為整數）。
  - `location` (list[string]): 面交或交易縣市簡稱。
  - `condition` (string | null): 60 字以內的繁體中文商品狀況精簡摘要。
  - `sold` (bool): 是否已售出。
  - `confidence` (float): 信心度 (0 ~ 1)。

### 4.7 `SearchWorker` (QThread 後台執行緒)
- 繼承自 `QThread`，將耗時的網路 I/O 與可選的 LLM API 呼叫移出主執行緒，確保 UI 不卡頓。
- 純 Python 模式使用標題關鍵字找候選，再下載文章內文做本機分類；不建立 Gemini client、不需要 API Key，也不呼叫 AI。
- **訊號 (Signals)**：
  - `log = Signal(str)`：傳遞即時日誌給 UI。
  - `result_found = Signal(dict)`：每當找到符合條件的商品即時發射訊號更新表格。
  - `summary = Signal(int, int)`：回傳 (匹配數, 候選總數)。
- **安全停止機制**：使用 `threading.Event` (`stop_event`)，在迴圈各階段檢查，使用者點擊停止時平順中斷，不使用危險的執行緒強制終止。

### 4.8 `MainWindow` & `NumericTableWidgetItem` (GUI)
- **表格設計**：
  - 欄位包含：來源看板、發文日期、發文時間、手機型號/命中關鍵字、容量、價格、價格候選、顏色、售出狀態、地區、商品狀況、信心度、原始標題、文章 URL（URL 欄隱藏）。
  - `NumericTableWidgetItem`：重載 `<` 比較運算子，讀取 `Qt.ItemDataRole.UserRole` 數值，使「價格」欄位能按照實際金額大小排序，而非字串字典序排序。
  - 雙擊事件：雙擊該列會自動呼叫 `QDesktopServices.openUrl` 開啟瀏覽器原文。
- **輸入驗證與防呆**：
  - API Key 欄位預設為 Password 遮蔽模式，提供 CheckBox 勾選明文顯示。
  - 勾選「記住 Key」時，使用 Windows DPAPI 加密後保存於使用者 AppData 的 QSettings；不保存明文 Key。一般環境採使用者範圍，受限帳號則使用加密的機器範圍 fallback。
  - Gemini 模型提供下拉選單，也允許直接輸入新的模型代號；模型選擇會保存供下次啟動使用。
  - 「匯出 Excel」會建立可篩選的 `搜尋結果` 工作表，包含完整文章內容；日期、時間與價格會以可排序的 Excel 型別寫入，原文 URL 會建立超連結。
  - 支援預設常用看板 (MacShop, mobilesales, iOS, MobileComm, nb-shopping, HardwareSale) 以及自訂看板輸入欄位。
  - 關閉視窗 (`closeEvent`) 時，若背景搜尋尚未完成，會提示使用者確認並安全停止 Worker。

---

## 5. 重要設計原則與安全考量 (Critical Design Decisions)

1. **API Key 安全保護**：
   - 使用者輸入的 API Key 絕對不能寫入 Log、終端或快取檔案。
   - 若使用者選擇記住 Key，透過 Windows DPAPI 加密保存，不寫入專案目錄；正常環境綁定目前使用者，受限 profile 則 fallback 到機器範圍加密。
   - `safe_error()` 函式主動掃描並遮蔽任何包含 Key 的字串（例如網路例外詳細堆疊中可能包含的 URL 參數）。
2. **Token 與費用最優化**：
   - 純 Python 模式完全不產生 Gemini API 請求，適合只想自行查看文章的使用情境。
   - **兩段式過濾 (Two-stage Filtering)**：在呼叫 Gemini 之前，先透過正規表達式與關鍵字快篩標題；標題明顯是徵求/已售出，或型號完全不符者直接捨棄，大幅減少不必要的 API 請求。
   - **推文與雜訊剔除**：PTT 推文量通常極大且充斥灌水留言，爬蟲主動移除 `.push` 區塊，僅保留賣家內文，顯著減少傳送給 Gemini 的 Token 量。
   - **已讀去重快取**：已成功分析過的文章記錄在本地 `seen_articles.json`，預設勾選「只分析尚未看過的文章」，重複執行時直接跳過已分析文章。
3. **PTT 爬蟲禮儀與穩定性**：
   - 帶有 `over18=1` Cookie 避免轉址。
   - 設定 0.45 秒延遲與 User-Agent，避免觸發 PTT 防火牆限制。

---

## 6. 給後續開發 / 接手 AI 的擴充指南 (Future Enhancements & Tips)

若未來需要針對本專案進行修改、擴充或修復，請參考以下建議：

1. **升級多執行緒 / 併行解析**：
   - 目前爬取與 Gemini 解析採單執行緒線性執行（一頁爬完抓一篇、分析一篇）。若欲加快速度，可將「看板頁面抓取」與「Gemini 內文分析」分離，利用 `ThreadPoolExecutor` 進行併行分析（需注意 Google Gemini API 的 RPM / TPM Rate Limit）。
2. **擴展通知功能**：
   - 目前專案定位為手動 GUI 單次搜尋。若後續欲擴充為常駐監控，可在後台設定 QTimer 或排程，並在 `result_found` 時觸發 LINE Notify、Telegram Bot 或 Windows 系統原生通知 (`QSystemTrayIcon`)。
3. **Gemini SDK 與模型版本**：
   - 本專案使用全新的 `google-genai` (v1.x) 套件（`from google import genai`）。請勿混淆為舊版的 `google-generativeai`。
   - 預設模型為 `gemini-3.6-flash`，使用者可在 GUI 選擇或直接輸入模型代號；預設選單可在 `GEMINI_MODELS` 更新。
4. **自訂搜尋條件擴充**：
   - 目前地區比對依賴 `normalize_location()` 做簡稱比對（如「台北」、「台中」）。若要支援跨區或特定行政區搜尋，可擴充 `normalize_location()` 的對應字典或讓 Gemini 在抽取時一併標準化縣市代碼。
