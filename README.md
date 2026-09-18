# PTT 二手手機搜尋工具

這是一個 Windows 桌面 GUI 工具。預設使用純 Python 關鍵字搜尋 PTT 看板，下載命中文章內文後整理價格、容量、顏色與售出狀態，完全不需要 Gemini；結果可直接匯出 Excel。

本版本是手動單次搜尋，不包含定時監控、LINE、Email 或其他通知。

## 建議安裝位置

將整個 `PTTPhoneFinder` 資料夾放到：

```text
C:\WORK\tool\PTTPhoneFinder
```

請勿只複製 `main.py`，資料夾內的其他檔案也要保留。

## 第一次安裝

1. 安裝 Python 3.11 或更新版本。安裝時請勾選 `Add Python to PATH`。
2. 雙擊 `setup_windows.bat`。
3. 等待虛擬環境與必要套件安裝完成。

## 啟動程式

完成第一次安裝後，雙擊：

```text
run_windows.bat
```

## 使用方式

1. 「搜尋模式」預設選擇「純 Python 關鍵字搜尋」，不需要 API Key。
2. 輸入手機型號或關鍵字、看板、頁數等條件。
3. 按下「開始搜尋」，程式會下載命中文章並用 Python 規則整理價格、容量、顏色與售出狀態。
4. 雙擊結果列，可用瀏覽器開啟 PTT 原文；按「匯出 Excel」保存目前結果與文章內容。

若要使用 Gemini 自動分析：切換「搜尋模式」為 Gemini，輸入 API Key，再選擇模型即可。

Gemini 模式下，多個型號及地區請使用逗號分隔，例如：

```text
iPhone 16 Pro, iPhone 16 Pro Max
台北, 新竹
```

## 專案檔案

- `main.py`：主程式。
- `requirements.txt`：Python 套件清單。
- `setup_windows.bat`：第一次安裝用。
- `run_windows.bat`：日後啟動程式用。
- `.gitignore`：排除虛擬環境與暫存檔。
- `PROJECT_OVERVIEW.md`：供 AI / 開發者閱讀的系統架構與功能規格說明書。

## 已讀紀錄

Gemini 模式會把已完成分析的文章記錄在 Windows 使用者資料目錄下的 `seen_articles.json`。純 Python 模式每次會依目前頁數重新抓取與分類。

## 常見問題

### Gemini 模式提示缺少 API Key

只有 Gemini 模式需要 API Key。程式不會把 Key 顯示在 Log；若勾選「記住 Key」，下次啟動會自動載入 Windows 加密保存的 Key。

### 找不到看板

確認輸入的是 PTT 網址中的實際看板名稱，例如 `MacShop` 或 `mobilesales`，不要輸入完整網址。

### 沒有顯示結果

確認關鍵字出現在文章標題中，並嘗試增加搜尋頁數。純 Python 模式會直接列出標題命中的文章，讓使用者自行判斷內容。

### 套件安裝失敗

確認電腦可連線至網際網路，並重新執行 `setup_windows.bat`。
