# DocuSnap 一键打包脚本 (PowerShell)
# 此脚本会自动编译并打包扩展为 .vsix 文件

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "DocuSnap 扩展打包工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查 node_modules 是否存在
if (-not (Test-Path "node_modules")) {
    Write-Host "[1/3] 安装依赖..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "错误: 依赖安装失败" -ForegroundColor Red
        Read-Host "按任意键退出"
        exit 1
    }
} else {
    Write-Host "[1/3] 依赖已存在，跳过安装" -ForegroundColor Green
}

Write-Host ""
Write-Host "[2/3] 编译 TypeScript..." -ForegroundColor Yellow
npm run compile
if ($LASTEXITCODE -ne 0) {
    Write-Host "错误: 编译失败" -ForegroundColor Red
    Read-Host "按任意键退出"
    exit 1
}

Write-Host ""
Write-Host "[3/3] 打包扩展..." -ForegroundColor Yellow
npm run package
if ($LASTEXITCODE -ne 0) {
    Write-Host "错误: 打包失败" -ForegroundColor Red
    Read-Host "按任意键退出"
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "打包成功！" -ForegroundColor Green
Write-Host "生成的 .vsix 文件位于当前目录" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

$vsixFiles = Get-ChildItem -Path . -Filter "*.vsix" -ErrorAction SilentlyContinue
if ($vsixFiles) {
    $vsixFiles | ForEach-Object { Write-Host $_.Name -ForegroundColor Cyan }
    Write-Host ""
    Write-Host "可以通过以下方式安装:" -ForegroundColor Yellow
    Write-Host "1. 在 VS Code 中: 扩展 > ... > 从 VSIX 安装" -ForegroundColor White
    Write-Host "2. 命令行: code --install-extension $($vsixFiles[0].Name)" -ForegroundColor White
} else {
    Write-Host "警告: 未找到 .vsix 文件" -ForegroundColor Yellow
}

Write-Host ""
Read-Host "按任意键退出"
