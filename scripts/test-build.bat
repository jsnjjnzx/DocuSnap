@echo off
chcp 65001 >nul
echo Testing build process...
echo.

REM Change to project root directory
cd ..

echo Step 1: Check if node_modules exists...
if exist "node_modules\" (
    echo [OK] node_modules found
) else (
    echo [WARN] node_modules not found, installing...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
)

echo.
echo Step 2: Check TypeScript compiler...
where tsc >nul 2>&1
if errorlevel 1 (
    echo [WARN] tsc not found globally, using local version
) else (
    echo [OK] tsc found
)

echo.
echo Step 3: Compile TypeScript...
call npx tsc -p ./
if errorlevel 1 (
    echo [ERROR] Compilation failed
    pause
    exit /b 1
) else (
    echo [OK] Compilation successful
)

echo.
echo Step 4: Check output directory...
if exist "out\extension.js" (
    echo [OK] out/extension.js generated
) else (
    echo [ERROR] out/extension.js not found
    pause
    exit /b 1
)

echo.
echo Step 5: Check if vsce is available...
where vsce >nul 2>&1
if errorlevel 1 (
    echo [WARN] vsce not found globally
    echo Installing vsce locally...
    call npm install -g vsce
    if errorlevel 1 (
        echo [ERROR] Failed to install vsce
        pause
        exit /b 1
    )
) else (
    echo [OK] vsce found
)

echo.
echo ========================================
echo All checks passed!
echo You can now run package.bat or publish.bat
echo ========================================
pause
