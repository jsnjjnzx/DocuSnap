# DocuSnap 一键发布脚本 (PowerShell)
# 此脚本会将扩展发布到 VS Code 市场

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "DocuSnap 扩展发布工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否已登录
Write-Host "正在检查发布者身份..." -ForegroundColor Yellow
$null = vsce ls-publishers 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "错误: 未找到发布者凭据" -ForegroundColor Red
    Write-Host ""
    Write-Host "请先使用以下命令登录:" -ForegroundColor Yellow
    Write-Host "  vsce login jsnjjnzx" -ForegroundColor White
    Write-Host ""
    Write-Host "您需要一个 Personal Access Token (PAT)" -ForegroundColor Yellow
    Write-Host "获取方式: https://dev.azure.com/ > User Settings > Personal Access Tokens" -ForegroundColor White
    Write-Host "权限要求: Marketplace > Manage" -ForegroundColor White
    Write-Host ""
    Read-Host "按任意键退出"
    exit 1
}

Write-Host ""
Write-Host "当前发布者: jsnjjnzx" -ForegroundColor Green
Write-Host "扩展名称: docusnap-assets" -ForegroundColor Green
Write-Host "版本: 1.0.0" -ForegroundColor Green
Write-Host ""
Write-Host "警告: 此操作将发布扩展到 VS Code 市场" -ForegroundColor Yellow
Write-Host "发布后无法撤销，请确认以下内容:" -ForegroundColor Yellow
Write-Host "  1. 版本号正确 (package.json)" -ForegroundColor White
Write-Host "  2. CHANGELOG.md 已更新" -ForegroundColor White
Write-Host "  3. README.md 内容完整" -ForegroundColor White
Write-Host "  4. 代码已测试通过" -ForegroundColor White
Write-Host ""
$confirm = Read-Host "确认发布? (输入 YES 继续)"

if ($confirm -ne "YES") {
    Write-Host ""
    Write-Host "已取消发布" -ForegroundColor Yellow
    Read-Host "按任意键退出"
    exit 0
}

Write-Host ""
Write-Host "[1/3] 编译 TypeScript..." -ForegroundColor Yellow
npm run compile
if ($LASTEXITCODE -ne 0) {
    Write-Host "错误: 编译失败" -ForegroundColor Red
    Read-Host "按任意键退出"
    exit 1
}

Write-Host ""
Write-Host "[2/3] 打包扩展..." -ForegroundColor Yellow
npm run package
if ($LASTEXITCODE -ne 0) {
    Write-Host "错误: 打包失败" -ForegroundColor Red
    Read-Host "按任意键退出"
    exit 1
}

Write-Host ""
Write-Host "[3/3] 发布到 VS Code 市场..." -ForegroundColor Yellow
npm run publish
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "错误: 发布失败" -ForegroundColor Red
    Write-Host ""
    Write-Host "常见问题:" -ForegroundColor Yellow
    Write-Host "  1. 未登录: 运行 vsce login jsnjjnzx" -ForegroundColor White
    Write-Host "  2. Token 过期: 重新生成 PAT 并登录" -ForegroundColor White
    Write-Host "  3. 版本冲突: 检查版本号是否已存在" -ForegroundColor White
    Write-Host ""
    Read-Host "按任意键退出"
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "发布成功！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "扩展已发布到 VS Code 市场" -ForegroundColor Cyan
Write-Host "市场链接: https://marketplace.visualstudio.com/items?itemName=jsnjjnzx.docusnap-assets" -ForegroundColor Cyan
Write-Host ""
Write-Host "注意: 市场审核可能需要几分钟到几小时" -ForegroundColor Yellow
Write-Host "您可以在上述链接查看发布状态" -ForegroundColor Yellow
Write-Host ""
Read-Host "按任意键退出"
