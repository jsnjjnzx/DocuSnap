@echo off
REM DocuSnap 一键打包脚本
REM 此脚本会自动编译并打包扩展为 .vsix 文件

echo ========================================
echo DocuSnap 扩展打包工具
echo ========================================
echo.

REM 检查 node_modules 是否存在
if not exist "node_modules\" (
    echo [1/3] 安装依赖...
    call npm install
    if errorlevel 1 (
        echo 错误: 依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo [1/3] 依赖已存在，跳过安装
)

echo.
echo [2/3] 编译 TypeScript...
call npm run compile
if errorlevel 1 (
    echo 错误: 编译失败
    pause
    exit /b 1
)

echo.
echo [3/3] 打包扩展...
call npm run package
if errorlevel 1 (
    echo 错误: 打包失败
    pause
    exit /b 1
)

echo.
echo ========================================
echo 打包成功！
echo 生成的 .vsix 文件位于当前目录
echo ========================================
echo.

dir /b *.vsix 2>nul
if errorlevel 1 (
    echo 警告: 未找到 .vsix 文件
) else (
    echo.
    echo 可以通过以下方式安装:
    echo 1. 在 VS Code 中: 扩展 ^> ... ^> 从 VSIX 安装
    echo 2. 命令行: code --install-extension docusnap-assets-1.0.0.vsix
)

echo.
pause
