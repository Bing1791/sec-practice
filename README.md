# CEH v13 練習網頁

純前端的 CEH 練習工具（HTML + CSS + 原生 JavaScript ES modules），不需要建置。所有紀錄都存在瀏覽器的 localStorage。

## 本機啟動

ES modules 和 `fetch` 無法在 `file://` 下運作，不能直接雙擊 `index.html`：

```
python -m http.server 8000
```

然後開啟 <http://localhost:8000/>。

## 部署到 GitHub Pages

網址：`https://bing1791.github.io/sec-practice/`（`main` 分支、`/` 根目錄）。

題庫來自第三方，repo 和網站上只放密文 `data/questions.enc.json`，開網站時輸入密碼才在瀏覽器內解密（AES-GCM，金鑰由 PBKDF2-SHA256 推導）。密碼請只留給自己，分享密碼就等於公開題庫。

改完網頁後更新：

```
deploy.bat "更新說明"
```

它會在明文題庫比密文新時要求輸入密碼並重新加密，再執行 add、commit、push。需要先 `pip install cryptography`。只想重新加密（例如換密碼）時執行 `python scripts/encrypt_data.py`，密碼至少 12 字元，不會寫進任何檔案。

以下檔案被 `.gitignore` 排除，**只存在這台電腦，請自行備份**：原始 PDF、`data/questions.json`、`data/explanations_ai.json`、`scripts/ai_explanations/`、`scripts/disputes.json`。

本機只要 `data/` 裡有明文 JSON，網站就直接載入、略過解密，所以 `http://區網IP` 也能測試。沒有明文時需要 HTTPS 或 localhost，因為其他網址沒有 Web Crypto。

## 重建題庫

只有改動 PDF 或裁決時才需要：

```
pip install pymupdf
python scripts/parse_pdf.py
python scripts/build_ai_explanations.py
python scripts/validate.py
```

重建後執行 `deploy.bat` 就會重新加密。

| 檔案 | 用途 |
|---|---|
| `scripts/parse_pdf.py` | 解析 PDF，輸出 `data/questions.json` |
| `scripts/duplicates.json` | 重複題：被隱藏的 id → 保留的 id |
| `scripts/disputes.json` | 答案裁決：`corrected` 改答案、`confirmed` 確認 PDF 正確 |
| `scripts/similar_groups.json` | 相似題群組，同一次考試或同一輪刷題只抽一題 |
| `scripts/ai_explanations/` | AI 補充解析原稿，由 `build_ai_explanations.py` 合併成 `data/explanations_ai.json` |
| `scripts/validate.py` | 檢查題庫並產生報告 |

題目 id 固定為「檔號-原始題號」（如 `03-101`），重跑解析不會改變，錯題庫紀錄不會失效。

## 測試

```
pip install playwright
python tests/e2e.py
```

使用已安裝的 Chrome，不需另外下載瀏覽器。
