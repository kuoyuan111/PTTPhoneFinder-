# PTTPhoneFinder 網頁版驗證與部署

這份文件記錄目前正式環境的實際連線方式。換電腦、重新 clone 或交接維護時，依此文件操作即可，不需要複製任何密碼或 Token。

## 目前正式環境

| 項目 | 設定 |
| --- | --- |
| GitHub repository | `https://github.com/kuoyuan111/PTTPhoneFinder-` |
| 開發／production branch | `main` |
| Vercel scope | `owen123` |
| Vercel project | `ptt-phone-finder` |
| 正式網址 | `https://ptt-phone-finder.vercel.app` |
| Function region | `hkg1`（香港，由 `vercel.json` 管理） |
| Environment Variables | 無 |
| 目前部署方式 | 已由本機 Vercel CLI 連結並直接部署 |
| GitHub 自動部署 | 尚未連接；需在 Vercel 授權 GitHub repository 後才會啟用 |

網站頁尾會顯示自動產生的建置版本，例如 `2026.09.18-18:30:45（台灣時間）`。版本由 `scripts/run-next.mjs` 在 `npm run build`／Vercel production build 時產生，格式是 `YYYY.MM.DD-HH:mm:ss`；不需要設定環境變數，也不應手動修改版本字串。`npm run dev` 會顯示開發伺服器啟動時的版本時間。

Vercel CLI 會在本機產生 `.vercel/project.json`，內容是 project/org 識別資訊。`.vercel/` 已加入 `.gitignore`，不應 commit；換電腦時使用 `vercel link` 重新產生即可。Vercel 登入憑證及 Token 也不得放進 repository。

## 技術架構

- Next.js App Router + React + TypeScript
- `/api/search` Node.js Route Handler 負責從伺服器端讀取 PTT
- Cheerio 解析 PTT HTML
- 本機規則抽取價格、容量、顏色、地區及售出狀態
- ExcelJS 在瀏覽器建立 `.xlsx` 下載檔
- 不使用 Gemini、API Key 或資料庫
- PTT 原站若封鎖 Vercel 出口（HTTP 403），會先透過 Jina Reader `X-No-Cache` 讀取原始 PTT HTML；只有即時中繼失敗時才切換到 PTTweb 公開鏡像

## 開發指令

```powershell
npm install
npm test
npm run lint
npm run build
npm run dev
```

第一次 clone 建議使用 `npm ci`，確保安裝版本與 `package-lock.json` 完全一致：

```powershell
git clone https://github.com/kuoyuan111/PTTPhoneFinder-.git
cd PTTPhoneFinder-
git switch main
npm ci
```

若受限 Windows 環境需要使用系統憑證：

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npm run dev
```

## 部署前檢查

以下指令都應成功：

```powershell
npm test
npm run lint
npm run build
npm audit --audit-level=moderate
```

## Vercel Hobby 部署

### 方式一：Vercel CLI（目前可用）

第一次在新電腦設定：

```powershell
npx --yes vercel@latest login
npx --yes vercel@latest link --project ptt-phone-finder
```

登入時選擇 `owen123` scope。確認 `.vercel/project.json` 中的 `projectName` 是 `ptt-phone-finder` 後，部署 production：

```powershell
npx --yes vercel@latest --prod --yes
```

若公司 Windows 憑證鏈造成 `unable to get local issuer certificate`：

```powershell
$env:NODE_OPTIONS="--use-system-ca"
npx --yes vercel@latest --prod --yes
```

CLI deployment 不依賴 GitHub App 權限，即使 GitHub 自動部署尚未連接，也能更新同一個正式網址。

### 方式二：連接 GitHub 自動部署

1. 前往 <https://vercel.com>，使用擁有此 repository 的 GitHub 帳號登入。
2. 開啟既有的 `ptt-phone-finder` project，不要再建立同名專案。
3. 進入 `Settings` → `Git` → `Connect Git Repository`。
4. 若 repository 不在清單中，到 GitHub 的 Vercel App 設定，授權 `kuoyuan111/PTTPhoneFinder-`。
5. 選擇 repository，Production Branch 設為 `main`。
6. Framework Preset 保持 `Next.js`，Root Directory 保持 repository 根目錄。
7. Build Command、Output Directory 和 Install Command 維持預設值，不需要新增 Environment Variables。
8. 連接成功後，push 到 `main` 會自動產生 production deployment；其他 branch/PR 會產生 preview deployment。

部署成功後，Vercel 會提供 `*.vercel.app` 網址。若 Vercel 專案已成功連接 GitHub，之後每次 push 到 production branch 都會自動重新部署。

目前正式站：<https://ptt-phone-finder.vercel.app>

## Git 分支與推送

正式程式碼推送到 `origin/main`。第一次修正本機 upstream 或第一次推送時使用：

```powershell
git push -u origin main
```

之後的日常流程：

```powershell
git switch main
git pull --ff-only origin main
npm ci
npm test
npm run lint
npm run build
git push
```

不要 force push `main`。若 `git status -sb` 顯示 `main...origin/feature/review-fixes`，代表本機 upstream 設定錯誤；重新執行 `git push -u origin main` 即可改回追蹤 `origin/main`。

## 上線後測試

1. 開啟網站首頁。
2. 保留 `MacShop`，取消其他看板。
3. 關鍵字輸入 `iPhone`。
4. 頁數選擇 `1`。
5. 預算留空，勾選包含已售出文章。
6. 執行搜尋，確認有結果或顯示目前無符合文章，而不是連線錯誤。
7. 點擊任一標題，確認能開啟 `https://www.ptt.cc/...` 原文。
8. 點擊 `下載 Excel`，確認活頁簿可開啟且包含原文連結與文章內容。

也可以從 PowerShell 驗證首頁：

```powershell
(Invoke-WebRequest -Uri "https://ptt-phone-finder.vercel.app" -UseBasicParsing).StatusCode
```

正常應回傳 `200`。

## 資料來源與連線行為

1. API 優先向 `https://www.ptt.cc` 讀取看板與文章。
2. PTT 若對 Vercel 出口回傳 HTTP 403，會透過 `https://r.jina.ai` 並使用 `X-No-Cache: true`、`X-Respond-With: html` 讀取最新原始 HTML。
3. 匿名即時中繼目前按每次搜尋最多 18 個請求控制：最多 8 個列表頁，其餘保留給符合關鍵字的完整文章。看板多時會先公平分配每個看板最新一頁。
4. Jina Reader 不可用或回傳非 HTML 時，才改讀 `https://www.pttweb.cc`；介面會標示「延遲鏡像」。
5. 回傳給瀏覽器的原文連結仍指向 `www.ptt.cc`，Excel 也會記錄實際資料來源。
6. 即時額度用完時，API 會明確停止並提示縮小看板、頁數或關鍵字，不會把舊資料偽裝成即時資料。

允許的遠端來源直接寫在 `lib/ptt-crawler.ts`；Jina URL 只能由已驗證的 `www.ptt.cc` URL 組成。新增來源時必須同時更新來源白名單、錯誤處理、安全說明與測試，不能接受使用者輸入任意抓取網址。

中繼標頭的官方說明：[Jina Reader README — Using request headers](https://github.com/jina-ai/reader#using-request-headers)。`X-Respond-With: html` 選擇 HTML 輸出，`X-No-Cache: true` 要求略過 Jina 快取；程式自身的短時間快取、來源更新頻率及第三方可用性仍需另外考量。

## 更新與回復

每次修改後先完成：

```powershell
npm test
npm run lint
npm run build
npm audit --audit-level=moderate
```

若 GitHub 自動部署尚未連接，再執行 CLI production deployment。上線後依「上線後測試」驗收。

需要回復時，在 Vercel project 的 `Deployments` 頁選擇上一個已驗證成功的 deployment，使用 `Promote to Production`；接著在 Git 建立修正 commit，不要用 force push 或刪除歷史。

## 常見問題

- `unable to get local issuer certificate`：在目前 PowerShell 設定 `$env:NODE_OPTIONS="--use-system-ca"` 後重試。
- Vercel 顯示 PTT HTTP 403：可能是雲端出口受到限制，檢查搜尋提示與每筆資料來源。Jina 無快取請求是要求重新抓取來源，不保證第三方永久同步；用文章發文時間及原文確認是否符合需要，不以「今天一定有結果」作為成功條件。PTTweb 必須標示為延遲鏡像。
- Vercel 無法連接 GitHub repository：確認登入帳號具有 repository 權限，並在 GitHub Vercel App 中授權該 repository。
- 專案名稱格式錯誤：Vercel project 固定使用小寫 `ptt-phone-finder`。
- 正式網址沒有更新：確認部署目標是既有 project `owen123/ptt-phone-finder`，並確認 deployment 已標示 `Production`、alias 指向 `ptt-phone-finder.vercel.app`。

## 安全與流量控制

- 後端只允許連線到 `https://www.ptt.cc`、中繼 `https://r.jina.ai` 與備援 `https://www.pttweb.cc`，不接受使用者提供任意網址。Jina 的目標只能由已驗證的 PTT 網址組成。
- 看板名稱只接受英數字、底線、句點與連字號。
- API 會驗證看板、關鍵字、預算及頁數。
- PTT 請求之間保留延遲，並對暫時性錯誤重試。
- 看板頁面短時間保存在執行個體記憶體中，減少重複請求。
- 不將文章內容寫入資料庫；所有結果只保存在使用者目前頁面。
- 基本頻率限制使用執行個體記憶體，適合個人 Hobby 專案；若公開給大量使用者，應改用 Vercel WAF 或共享 rate-limit 儲存服務。
