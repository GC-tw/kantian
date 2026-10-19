# 看天爬山

看天氣，找出最適合造訪的山。依交通部中央氣象署預報，比較 235 座山（百岳、小百岳、其他山岳）的天氣燈號。

網站每天在氣象署發布後（台灣時間約 06:07、12:07、18:07、00:07）自動抓資料、更新網頁，不需要手動操作。

---

## 第一次設定（約 15 分鐘）

### 1. 申請氣象署授權碼
1. 打開 <https://opendata.cwa.gov.tw/index>，按右上角「登入／註冊」。
2. 選「氣象會員登入」→「加入會員」，填寫電子郵件與密碼，到信箱收確認信。
3. 登入後點「API 授權碼」→「取得授權碼」，會出現一串像 `CWA-XXXXXXXX-XXXX-...` 的文字。
4. **這串授權碼不要貼在對話、文件或程式碼裡**，下一步只貼進 GitHub 的秘密設定。

### 2. 建立 GitHub 帳號與專案
1. 到 <https://github.com/signup> 註冊帳號。
2. 登入後按右上角「＋」→「New repository」。
3. Repository name 填 `kantian`（可自訂），選 **Public**，按「Create repository」。
4. 把「帳號名稱／專案名稱」告訴 Claude，由 Claude 把程式放進專案。

### 3. 貼上授權碼
1. 在專案頁面點「Settings」→ 左側「Secrets and variables」→「Actions」。
2. 按「New repository secret」。
3. Name 填 `CWA_API_KEY`，Secret 貼上授權碼，按「Add secret」。

### 4. 開啟網站
1. 「Settings」→ 左側「Pages」→「Build and deployment」的 Source 選 **GitHub Actions**。
2. 上方點「Actions」→ 左側「更新天氣資料」→ 右側「Run workflow」→「Run workflow」。
3. 等 2–3 分鐘出現綠色勾勾，網站就在 `https://帳號名稱.github.io/kantian/`。
4. 第一次成功後告訴 Claude，Claude 會檢查 `data/samples` 裡的資料樣本，確認氣象署的格式讀取正確。

---

## 檔案說明

| 位置 | 內容 |
| --- | --- |
| `data/mountains.json` | 235 座山與對應的氣象署預報點、鄉鎮 |
| `data/mountains_235.csv` | 同上，方便用試算表檢視 |
| `data/datasets.json` | 第一次執行時自動探查到的氣象署資料集代碼 |
| `data/last-run.json` | 最近一次執行是否成功、失敗原因與資料摘要 |
| `data/samples/` | 每種資料各存一小段樣本，用來核對格式 |
| `scripts/fetch.mjs` | 抓氣象署資料、整理成 `forecast.json` |
| `scripts/build.mjs` | 組合網頁 `index.html` |
| `site/` | 網頁本體（版面與程式） |
| `.github/workflows/update.yml` | 自動排程 |
| `test/` | 測試資料與網頁測試 |

## 使用的氣象署資料
- 登山預報：F-B0053-035（3 天逐 3 小時）、F-B0053-033（一週逐 12 小時），從檔案下載介面取得；代碼記在 `data/datasets.json`，刪掉這個檔案就會重新探查
- 鄉鎮預報：各縣市資料集 F-D0047-001～087（3 天逐 3 小時、一週逐 12 小時）
- 天氣警特報：W-C0033-001
- 每次執行的結果與摘要：`data/last-run.json`

資料來源：交通部中央氣象署開放資料，依政府資料開放授權條款使用。本站只依預報數值比對與排序，不是氣象預報。

## 本機測試（開發用）
```bash
python3 test/make_fixtures.py                                  # 產生測試資料
node scripts/fetch.mjs --fixtures test/fixtures --out dist/forecast.json
node scripts/build.mjs
cd test && npm i jsdom@24.1.3 && TZ=Asia/Taipei node page.test.js
```
