@echo off
rem 用法：deploy.bat [commit 訊息]。題庫有更新時會先詢問密碼並重新加密。
chcp 65001 >nul
cd /d "%~dp0"

python scripts\encrypt_data.py --if-changed || exit /b 1
git add -A || exit /b 1

rem 明文或 PDF 出現在暫存區就中止
git ls-files | findstr /i /c:".pdf" /c:"data/questions.json" /c:"data/explanations_ai.json" /c:"scripts/disputes.json" /c:"scripts/ai_explanations/" >nul && goto :unsafe

git diff --cached --quiet && (
  echo 沒有變更需要部署。
  exit /b 0
)

set "MESSAGE=%~1"
if "%MESSAGE%"=="" set "MESSAGE=Update site"
git commit -m "%MESSAGE%" || exit /b 1
git push || exit /b 1
echo 已推送，GitHub Pages 約一分鐘後更新。
exit /b 0

:unsafe
echo 已中止：暫存區有明文題庫或 PDF，沒有 commit。
exit /b 1
