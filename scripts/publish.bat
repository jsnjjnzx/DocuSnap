@echo off
chcp 65001 >nul
echo ========================================
echo DocuSnap Extension Publish Tool
echo ========================================
echo.

REM Change to project root directory
cd ..

echo Checking publisher credentials...
call vsce ls-publishers >nul 2>&1
if errorlevel 1 (
    echo.
    echo Error: Publisher credentials not found
    echo.
    echo Please login first:
    echo   vsce login jsnjjnzx
    echo.
    echo You need a Personal Access Token (PAT)
    echo Get it from: https://dev.azure.com/ ^> User Settings ^> Personal Access Tokens
    echo Required permission: Marketplace ^> Manage
    echo.
    pause
    exit /b 1
)

echo.
echo Current publisher: jsnjjnzx
echo Extension name: docusnap-assets
echo Version: 1.0.0
echo.
echo WARNING: This will publish the extension to VS Code Marketplace
echo This action cannot be undone. Please confirm:
echo   1. Version number is correct (package.json)
echo   2. CHANGELOG.md is updated
echo   3. README.md is complete
echo   4. Code has been tested
echo.
set /p confirm="Confirm publish? (Type YES to continue): "

if /i not "%confirm%"=="YES" (
    echo.
    echo Publish cancelled
    pause
    exit /b 0
)

echo.
echo [1/3] Compiling TypeScript...
call npm run compile
if errorlevel 1 (
    echo Error: Compilation failed
    pause
    exit /b 1
)

echo.
echo [2/3] Packaging extension...
call npm run package
if errorlevel 1 (
    echo Error: Packaging failed
    pause
    exit /b 1
)

echo.
echo [3/3] Publishing to VS Code Marketplace...
call npm run publish
if errorlevel 1 (
    echo.
    echo Error: Publish failed
    echo.
    echo Common issues:
    echo   1. Not logged in: Run vsce login jsnjjnzx
    echo   2. Token expired: Generate new PAT and login again
    echo   3. Version conflict: Check if version already exists
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo Publish successful!
echo ========================================
echo.
echo Extension published to VS Code Marketplace
echo Marketplace link: https://marketplace.visualstudio.com/items?itemName=jsnjjnzx.docusnap-assets
echo.
echo Note: Marketplace review may take a few minutes to hours
echo You can check the publish status at the link above
echo.
pause
