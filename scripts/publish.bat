@echo off
REM DocuSnap 一键发布脚本
REM 此脚本会将扩展发布到 VS Code 市场

echo ========================================
echo DocuSnap 扩展发布工具
echo ========================================
echo.

REM 检查是否已登录
echo 正在检查发布者身份...
call vsce ls-publishers >nul 2>&1
if errorlevel 1 (
    echo.
    echo 错误: 未找到发布者凭据
    echo.
    echo 请先使用以下命令登录:
    echo   vsce login jsnjjnzx
    echo.
    echo 您需要一个 Personal Access Token (PAT)
    echo 获取方式: https://dev.azure.com/ ^> User Settings ^> Personal Access Tokens
    echo 权限要求: Marketplace ^> Manage
    echo.
    pause
    exit /b 1
)

echo.
echo 当前发布者: jsnjjnzx
echo 扩展名称: docusnap-assets
echo 版本: 1.0.0
echo.
echo 警告: 此操作将发布扩展到 VS Code 市场
echo 发布后无法撤销，请确认以下内容:
echo   1. 版本号正确 (package.json)
echo   2. CHANGELOG.md 已更新
echo   3. README.md 内容完整
echo   4. 代码已测试通过
echo.
set /p confirm="确认发布? (输入 YES 继续): "

if /i not "%confirm%"=="YES" (
    echo.
    echo 已取消发布
    pause
    exit /b 0
)

echo.
echo [1/3] 编译 TypeScript...
call npm run compile
if errorlevel 1 (
    echo 错误: 编译失败
    pause
    exit /b 1
)

echo.
echo [2/3] 打包扩展...
call npm run package
if errorlevel 1 (
    echo 错误: 打包失败
    pause
    exit /b 1
)

echo.
echo [3/3] 发布到 VS Code 市场...
call npm run publish
if errorlevel 1 (
    echo.
    echo 错误: 发布失败
    echo.
    echo 常见问题:
    echo   1. 未登录: 运行 vsce login jsnjjnzx
    echo   2. Token 过期: 重新生成 PAT 并登录
    echo   3. 版本冲突: 检查版本号是否已存在
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo 发布成功！
echo ========================================
echo.
echo 扩展已发布到 VS Code 市场
echo 市场链接: https://marketplace.visualstudio.com/items?itemName=jsnjjnzx.docusnap-assets
echo.
echo 注意: 市场审核可能需要几分钟到几小时
echo 您可以在上述链接查看发布状态
echo.
pause
