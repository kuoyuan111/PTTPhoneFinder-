@echo off
chcp 65001 >nul
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" goto :install_requirements

where py >nul 2>nul
if not errorlevel 1 goto :create_with_py

where python >nul 2>nul
if not errorlevel 1 goto :create_with_python

echo [錯誤] 找不到 Python 3.11 或更新版本。
echo 請先從 https://www.python.org/downloads/ 安裝 Python 3.11 或更新版本。
pause
exit /b 1

:create_with_py
echo 正在建立 Python 虛擬環境...
py -3 -m venv .venv
if errorlevel 1 goto :failed
goto :install_requirements

:create_with_python
echo 正在建立 Python 虛擬環境...
python -m venv .venv
if errorlevel 1 goto :failed

:install_requirements

echo 正在安裝必要套件...
call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 goto :failed

echo.
echo 安裝完成，之後請執行 run_windows.bat。
pause
exit /b 0

:failed
echo.
echo [錯誤] 安裝失敗，請確認網路連線與 Python 安裝是否正常。
pause
exit /b 1
