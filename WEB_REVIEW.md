# 網頁搜尋 review 與回歸驗證

Review 日期：2026-09-18。檢查基準：`9767934`。第一輪由 GPT-6 Astra review；使用者其後指定改由 GPT-5.6 Sol review。GPT-5.6 Luna 負責程式修正，主代理負責整合、文件與驗收。

## 執行紀錄

- 2026-09-18 代理因 workspace credits 用完而中斷，使用者選擇保留修改、不改由主代理接手；同日補足額度並要求續做。
- Astra 已完成對保留快照的獨立 review，以下 findings 已交 Luna 修正；最終整合驗收結果另記。
- 三個 Luna 修正工作再次因 workspace credits 用完而中斷，其中 UI 工作留下部分修改。使用者要求續做並將 reviewer 改為 GPT-5.6 Sol；Sol 以這個穩定快照重新檢查，再把確認 findings 交給新的 Luna 工作。
- 中斷前 `npm test`：26 個測試，25 通過、1 失敗。UI 部分修改留下後重跑：24 通過、2 失敗。保固／配件解析仍失敗；Excel workbook 測試超過 Vitest 預設 5 秒而逾時，需判斷是測試門檻或功能退化，不能只提高時間掩蓋問題。
- `npm run lint`：通過。
- `npm run build`：通過（含 production TypeScript 檢查）。這不代表搜尋行為已驗收。
- `npm audit --audit-level=moderate`：本次檢查為 0 個已知漏洞。
- 上述 26 測試、lint／build 為中斷時的檢查結果，不代表新抓取流程已完成驗收；完整 crawler 行為測試需在續做時補齊。
- 個人 skill 已另存並通過官方格式驗證：`C:\Users\owen.hsu\.codex\skills\astra-sol-review-luna-fix\SKILL.md`。此 skill 不包含在網站 repository 中。Astra 已完成 read-only 情境檢查，review-only、Luna 不可用、未授權 push、dirty working tree 及重疊寫入範圍沒有發現實質授權矛盾。

## Sol review findings（最終均已關閉）

| ID | 優先級 | 已重現的問題 | 驗收重點 |
| --- | --- | --- | --- |
| F1 | P1 | 新 URL 白名單誤擋實際文章與數字分頁網址，搜尋可無提示地回零筆 | 正常 `M.<timestamp>.A.<hash>.html`、`index123.html` 可抓取，錯誤來源／跨看板路徑仍拒絕 |
| F2 | P1 | Jina HTML／無快取標頭在改動時遺漏 | 列表和文章請求均帶 `X-Respond-With: html` 及 `X-No-Cache: true` |
| F3 | P1 | 售出標題被舊內文未售出覆蓋，交易條款被誤判售出，漏判 SOLD | 售出開關保留可售文並正確排除已售文 |
| F4 | P2 | 方括號售價漏讀、中文複合金額重複拆解、原價冒充售價 | 五個 reviewer 固定案例與多商品模糊價格回歸 |
| F5 | P2 | 保固／配件標題的結束括號成為欄位值 | inline／下一行欄位可讀且不產生 `]` 假值 |
| F6 | P2 | 作者 metadata 使用錯誤位置，輸出看板名稱 | 依標籤擷取真實作者並保留至 Excel |
| F7 | P2 | 預算 27500 被 `step=1000` 阻止送出 | 接受非負整數預算，保留範圍驗證 |
| F8 | P2 | UI／API 和 crawler 看板驗證不一致造成 500 | 所有層使用相同支援格式，無效名稱在 API 回 400 |
| F9 | P2 | 已取消的 signal 仍啟動抓取 | 預先取消不產生網路請求，執行中取消亦有效 |
| F10 | P3 | 本地篩選零筆顯示搜尋本身無結果 | 清除篩選可復原現有結果，不需重查 |
| F11 | P3 | 命中關鍵字誤標為實際型號 | 網頁／Excel 欄位使用真實語意 |

第一輪 Sol review 判定 F1、F2、F3 是 release blocker；F4、F5、F6、F8、F9 必須修正。Luna 完成後，Sol 第二輪確認 F1–F11 均關閉，並追加跨頁 URL 去重、API／matcher 關鍵字規則一致及 Jina 429 不切換延遲鏡像三項驗收。Luna 補修後，Sol 最終 micro-review 確認三項均關閉，沒有新 release blocker。

## 最終驗收結果

- `npm test`：6 個 test files、54/54 通過。包含真實 PTT URL 格式、Jina headers、403／404／429、部分結果、跨頁去重、取消、售出與價格解析、API validation、介面狀態、台灣時間及 Excel workbook。
- `npm run lint`：通過。
- `npm run build`：通過，包含 production TypeScript check。
- `npm audit --audit-level=moderate`：0 個已知漏洞。
- `git diff --check`：通過；Windows 僅顯示 LF／CRLF 轉換提示。
- 本機 live API：MacShop 關鍵字 `17`、預算 36000 取得當日下午 PTT 直連資料，作者、價格、URL 與 `+08:00` 時間正常；mobilesales 關鍵字 `iPhone`、2 頁取得 25 篇候選／25 筆結果，無 warning。
- 本機瀏覽器：預算 `27500` 可送出，不再被 step validation 阻擋；預算提高至 `36000` 後顯示一筆當日下午結果，台灣時間、作者、價格、容量與 PTT 原文連結可見。
- Excel 按鈕執行時瀏覽器 console 無 error；in-app browser 未捕捉到 blob download event。活頁簿的可讀性、欄位型別、台灣時間、原文 hyperlink 與欄名由自動測試實際建立並重新載入驗證。

## 檢查範圍

包含搜尋 API、PTT／Jina／PTTweb 取資料流程、規則分類、網頁搜尋狀態、時間排序、Excel 匯出及部署文件。Windows Python 桌面程式不在本次修改範圍。

## 發現的問題與驗收要求

| 優先級 | 原有問題 | 應通過的回歸情境 |
| --- | --- | --- |
| 高 | 第一個看板會先下載文章並耗完 Jina 額度，後面的看板尚未取列表 | 先完成各看板最新列表，再取得較舊頁面和文章；以最新文章優先 |
| 高 | 勾選包含已售出，標題含已售出的文章仍在前置篩選被移除 | 包含售出開關同時控制標題與內文判斷；求購、公告及討論不混入 |
| 高 | 時間按英文日期字串排序；沒有時區的日期依執行電腦解讀 | 跨日、跨月仍依時間先後排序，網頁與 Excel 一律呈現台灣時間 |
| 高 | 售價前的原價、板規數字、保固年分或多商品價格可能造成誤判 | 實際售價欄位優先；不明確價格保持未知；保留候選資訊供確認 |
| 高 | 後續頁面失敗可能丟棄前面已取得的文章，404 可能讀回舊鏡像 | 保存已完成的部分結果；不存在的文章不從備援復活 |
| 中 | 每次 18 請求不等於每分鐘限流，連續或同時搜尋可能反覆 429 | 執行個體內限制連續請求，尊重上游冷卻；額度用完顯示部分結果提示 |
| 中 | 僅檢查 HTML 標記，可能把來源阻擋頁當成成功空列表 | 驗證看板／文章結構；區分來源失敗、空結果與使用者取消 |
| 中 | 原始 JSON 格式錯誤回傳 500；輸入大小與記憶體映射沒有明確界線 | 無效 JSON 回 400，過大請求回 413，過期快取及限流紀錄會清除 |
| 中 | 較舊搜尋的回應及 finally 可能覆蓋較新的搜尋狀態 | 停止後重查時，只有目前請求能更新畫面 |
| 中 | 零筆搜尋顯示尚未搜尋；清除未同步重設統計與提示 | 完成但零筆、取消、失敗及清除，各有正確狀態 |
| 中 | Excel 匯出全部未篩選資料，且立即回收下載 URL | 匯出與畫面篩選、排序一致，保留來源及台灣時間，下載流程不提前回收 URL |

## 維護時的驗證方式

```powershell
npm test
npm run lint
npm run build
npm audit --audit-level=moderate
git diff --check
```

測試應使用固定 HTML 與模擬網路回應，涵蓋成功、403、404、429、逾時、取消及部分完成，避免把每日會變的文章當成固定斷言。

正式站另以少量人工／API 查詢確認：多看板可取得資料、文章時間及來源可見、價格與 PTT 原文一致、篩選後 Excel 列數一致。上游流量額度有限，避免為了驗收大量重複查詢。

## 能力界線

- Jina 無快取請求代表要求重新取得來源，不保證 PTT 本身或第三方永遠同步、永不阻擋。
- 執行個體內限流無法協調 Vercel 多個 instance 共用的上游 IP；若未來擴大使用，需要共享限流服務。
- 規則解析無法保證把多商品混售文中的每個型號精準對應至價格；有疑義時應顯示未知並由使用者開啟原文確認。
- PTTweb 是可能延遲的來源，不能把舊文發文時間當成資料擷取時間，也不能用它宣稱已驗證最新庫存狀態。
