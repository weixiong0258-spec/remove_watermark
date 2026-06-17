@echo off
echo ==========================================
echo  ZhangZhang Watermark Remover
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
echo Processing images in input_images folder...
python remove_watermark.py
if errorlevel 1 (
    echo Error during processing.
    pause
    exit /b 1
)
echo.
echo Done! Results saved to output_images folder.
pause
