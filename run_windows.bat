@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo 尚未安裝執行環境，請先執行 setup_windows.bat。
    pause
    exit /b 1
)

call ".venv\Scripts\activate.bat"
python main.py
if errorlevel 1 (
    echo.
    echo 程式異常結束，請查看上方錯誤訊息。
    pause
)
