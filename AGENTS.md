# AI 維護規則

本 repository 的任何已提交變更（程式、測試、文件或部署設定）都必須重新建立一次 Vercel production deployment；不能只完成 `git push` 就宣稱上線。完整指令、憑證處理、驗證方式與失敗排查請先閱讀 [`WEB_DEPLOYMENT.md`](WEB_DEPLOYMENT.md) 的「每次變更必做：提交、推送、重新部署」章節。

維護時要保留既有 `main`、Vercel project `owen123/ptt-phone-finder`、正式網址 `https://ptt-phone-finder.vercel.app` 及 `hkg1` region。不要把 Vercel token、環境變數或 `.vercel/` 識別檔 commit 進 repository。
