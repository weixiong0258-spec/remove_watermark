@echo off
echo ==========================================
echo  ZhangZhang Watermark Remover - Web UI
echo ==========================================
echo.
echo Checking dependencies...
python -m pip install -r requirements.txt -q
if errorlevel 1 (
    echo Failed to install dependencies. Please check your network.
    pause
    exit /b 1
)
echo.
echo Starting web server...
echo Open http://127.0.0.1:5000 in your browser after startup.
echo.
python app.py
if errorlevel 1 (
    echo Failed to start server.
    pause
    exit /b 1
)
