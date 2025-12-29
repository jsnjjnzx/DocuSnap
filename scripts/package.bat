@echo off
chcp 65001 >nul
echo ========================================
echo DocuSnap Extension Package Tool
echo ========================================
echo.

REM Change to project root directory
cd ..

if not exist "node_modules\" (
    echo [1/3] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo Error: Failed to install dependencies
        pause
        exit /b 1
    )
) else (
    echo [1/3] Dependencies already exist, skipping installation
)

echo.
echo [2/3] Compiling TypeScript...
call npm run compile
if errorlevel 1 (
    echo Error: Compilation failed
    pause
    exit /b 1
)

echo.
echo [3/3] Packaging extension...
call npm run package
if errorlevel 1 (
    echo Error: Packaging failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo Package successful!
echo The .vsix file is in the current directory
echo ========================================
echo.

dir /b *.vsix 2>nul
if errorlevel 1 (
    echo Warning: .vsix file not found
) else (
    echo.
    echo You can install it by:
    echo 1. In VS Code: Extensions ^> ... ^> Install from VSIX
    echo 2. Command line: code --install-extension docusnap-assets-1.0.0.vsix
)

echo.
pause
