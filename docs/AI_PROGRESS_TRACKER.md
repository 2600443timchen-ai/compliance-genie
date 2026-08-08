# Compliance Genie — AI／人類共同進度追蹤表

> 動態追蹤檔。架構與運作邏輯請見 [`../ARCHITECTURE.md`](../ARCHITECTURE.md)。所有 AI 與使用者都必須以追蹤 ID、驗證證據及 Commit SHA 回報，不接受只有「已修好」的狀態。

## 1. 更新規則

1. 開始前先執行 `git status --short`，避免覆蓋他人工作。
2. 每項工作使用唯一 ID：`CG-<AREA>-NNN`。
3. 狀態只使用：`待處理`、`進行中`、`阻塞`、`待驗收`、`已解決`、`不處理`。
4. `已解決` 必須有可定位的 Commit、測試結果與驗收者。
5. 尚未 push 時只能填本機 SHA 並註明 `not pushed`；需要團隊共享時，push 後才可關閉。
6. 發現 regression 時重開原 ID，或建立新 ID 並在「相依／回歸」欄連回原項目。
7. 不得在本檔貼 token、個資、完整客戶資料或敏感 API response。

## 2. 目前總覽

基準：2026-08-06，分支 `milestone/live-gemini-finance-workspace-2026-08-05`，HEAD `60a4d90294a991197a8edd95de0bc6616defb3df`。

| 狀態 | 數量 |
|---|---:|
| 待處理 | 11 |
| 進行中 | 0 |
| 阻塞 | 0 |
| 待驗收 | 1 |
| 已解決 | 0（此表啟用後） |

> 啟用本表時工作樹已有多個他人／既有未提交變更。這些變更不能在沒有原作者確認與驗收證據的情況下標成已解決。

## 3. 工作項目

| ID | 優先級 | 狀態 | 工作與驗收條件 | 負責者 | 分支／PR | 驗證 | 相依／回歸 | 最後更新 |
|---|---|---|---|---|---|---|---|---|
| CG-DOC-001 | P1 | 待驗收 | 建立完整架構與追蹤制度；文件涵蓋 runtime、資料流、未實作、未驗證、DoD、Commit ledger | Codex | current branch / not committed | 內容檢查通過；`git diff --check` 無 whitespace error | 等待使用者驗收與獨立 Commit | 2026-08-06 |
| CG-SEC-001 | P0 | 待處理 | 撤銷並移除 `js/config.js` 明文 JWT；後端只讀 secret；repo 掃描及啟動驗證通過 | 未指派 | — | 待定 | 阻擋正式部署 | 2026-08-06 |
| CG-DATA-001 | P0 | 待處理 | 正式 runtime 移除 `INSIGHT_DEFINITIONS`、`PERIOD_DATA`、規則式回答與假法律結論 fallback | 未指派 | — | JS scan + UI error-path E2E | regression of `b2f5dd9` 的目標 | 2026-08-06 |
| CG-AUTH-001 | P0 | 待處理 | 建立使用者認證、案件授權與 chat ownership；含負向測試 | 未指派 | — | 待定 | 依賴正式部署模型 | 2026-08-06 |
| CG-API-001 | P1 | 待處理 | 統一 `js/api.js`、頁面 client 與 BFF；刪除不可達舊路徑並補現行契約測試 | 未指派 | — | Python + JS contract tests | 無 | 2026-08-06 |
| CG-E2E-001 | P1 | 待處理 | 兩個主頁 happy/error path 自動化，涵蓋搜尋、聊天、深鑽、報告 | 未指派 | — | 瀏覽器 E2E | 依賴可控 upstream fixture | 2026-08-06 |
| CG-CI-001 | P1 | 待處理 | GitHub Actions 在 PR 自動執行 Python、JS、diff/static checks | 未指派 | — | Actions run URL | 依賴測試命令穩定 | 2026-08-06 |
| CG-VAL-001 | P1 | 待處理 | 驗證 validation endpoint 與 UI source preview，記錄真實回傳契約與錯誤狀態 | 未指派 | — | integration + browser | 需有效測試 token | 2026-08-06 |
| CG-SRC-001 | P1 | 待處理 | 逐一驗證 11 個 source ID、schema、日期與 cache/error 行為 | 未指派 | — | 11/11 integration evidence | 需有效測試 token | 2026-08-06 |
| CG-UPLOAD-001 | P1 | 待處理 | 加入 MIME／惡意檔／配額／權限／刪除／retention，真實 PDF/CSV 測試 | 未指派 | — | security + integration | 需產品資料政策 | 2026-08-06 |
| CG-REPORT-001 | P1 | 待處理 | 將預覽／列印升級為有版型、來源快照、版本、覆核與測試的正式報告 | 未指派 | — | golden file + visual QA | 需確認正式輸出格式 | 2026-08-06 |
| CG-OBS-001 | P2 | 待處理 | 加入不洩漏個資的 request ID、structured log、metrics 與 timeout 可觀測性 | 未指派 | — | log tests / runbook | 依賴部署環境 | 2026-08-06 |

## 4. 驗證執行紀錄

| 日期時間（Asia/Taipei） | 執行者 | Commit／工作樹 | 命令 | 結果 | 適用範圍 |
|---|---|---|---|---|---|
| 2026-08-06 | Codex | HEAD `60a4d902` + dirty working tree | `python -m unittest scripts.test_workspace_regressions -v` | PASS 9/9 | 案卷、搜尋、upload mock、dashboard parser、financial risk contract |
| 2026-08-06 | Codex | HEAD `60a4d902` + dirty working tree | `node --test js/tests/api_polling.test.js` | PASS；8 個腳本情境，runner 1 file | `js/api.js`，不代表現行 UI E2E |
| 2026-08-06 | Codex | HEAD `60a4d902` + dirty working tree | `python -m py_compile analytics_server.py` | PASS | 僅 Python 語法 |

## 5. 已解決 Commit Ledger

本區只記錄依本表 Definition of Done 驗收完成的項目。歷史 Commit 對照請見架構書第 12 節；歷史 message 不自動視為本表的 `已解決`。

| 解決日期 | Issue | 完整 Commit SHA | 解決內容 | 驗證證據 | Branch／PR | 驗收者 | 殘餘風險 |
|---|---|---|---|---|---|---|---|
| — | — | — | 尚無 | — | — | — | — |

## 6. 使用者／AI 回報範本

```text
[RESOLVED]
Issue: CG-AREA-000
Commit: 0123456789abcdef0123456789abcdef01234567
Branch/PR: codex/example or https://github.com/.../pull/123
解決內容: 明確描述程式行為與刪除／新增的範圍
驗證命令: python -m unittest ...
驗證結果: PASS 12/12
人工驗收: 王小明，2026-08-06，Windows 11 + Chrome，PASS
殘餘風險: none
```

更新人應核對：

```powershell
git show --stat --oneline <commit>
git branch --contains <commit>
git status --short
```

若 Commit 尚不存在、測試不可重現、未包含該修復，或沒有必要人工驗收，狀態維持 `進行中`／`待驗收`，並把缺口寫回工作項目。

## 7. 新增工作範本

```markdown
| CG-AREA-000 | P0/P1/P2 | 待處理 | 問題、範圍、可量測驗收條件 | 未指派 | — | 預計測試 | 相依 ID | YYYY-MM-DD |
```

建議 AREA：`SEC`、`AUTH`、`DATA`、`API`、`UI`、`E2E`、`CI`、`VAL`、`SRC`、`UPLOAD`、`REPORT`、`OBS`、`DOC`。

## 8. 交接摘要範本

```text
目前目標：<Issue ID + 一句話>
已完成：<檔案與行為>
尚未完成：<明確缺口>
已執行測試：<命令與結果>
未執行測試：<原因>
工作樹注意事項：<不得覆蓋的檔案／其他人的變更>
下一步：<最小可執行動作>
最後 Commit：<SHA 或 not committed>
```
