# Compliance Genie — Architecture Document

## 系統概覽

Compliance Genie 合規精靈是一套透過 Gemini Cloud Chat API 驅動的合規風險洞察儀表板。
**本系統不包含任何寫死的假資料、Mock 數值或硬編碼的分析結果。**
所有顯示於頁面上的數據均來自即時的 API 查詢。

## 資料流架構

```
[使用者開啟頁面]
      │
      ▼
[config.js] ── API 端點、JWT、Prompt 模板
      │
      ▼
[api.js] ── API Service Module (Dependency Injection)
  │  getChatId()      → GET  /assistant/chat/list
  │  askQuestion()    → POST /assistant/chat/{chatId}
  │  fetchSummaryWithPolling() → GET /assistant/chat/summary
  │  askAndPoll()     → 完整的「發問 → 輪詢」封裝
      │
      ▼
[risk_command_center.js] ── 儀表板業務邏輯
  │  loadDashboardData()  → 頁面載入時呼叫 API
  │  handlePeriodChange() → 切換期間時呼叫 API
  │  showInsight()        → KPI 深鑽時呼叫 API
  │  askDashboardAssistant() → AI 助理對話呼叫 API
      │
      ▼
[v2_workspace_analytical_finance.html] ── UI 渲染
```

## API 端點對照

| 功能 | 端點 | 方法 | 說明 |
|------|------|------|------|
| 取得對話列表 | `/assistant/chat/list` | GET | 取得可用的 Chat ID |
| 發送問題 | `/assistant/chat/{chatId}` | POST | 向 AI 發送分析問題 |
| 輪詢摘要 | `/assistant/chat/summary` | GET | 等待 AI 處理完成並取得回覆 |

Base URL: `https://cloud.geminidata.com/api/portal/api10`
認證: Bearer JWT + x-application-tenant Header

## 設計原則

### 依賴注入 (Dependency Injection)
`api.js` 中的所有函式均接受 `options` 物件，其中包含 `baseUrl`、`headers`、`fetchFn`。
- 生產環境：由 `risk_command_center.js` 注入真實的 `fetch` 與設定
- 測試環境：由 `api_polling.test.js` 注入 mock 函式

### 零假資料原則
- HTML 中所有數值欄位的預設值為 `--` 或「載入中」
- 頁面載入時立即觸發 API 呼叫
- 任何 API 失敗都會顯示明確的錯誤訊息，不會回退到假資料
- `INSIGHT_DEFINITIONS` 等寫死的 Mock 物件已被徹底移除

### Prompt 集中管理
所有送至 Chat API 的提詞均定義於 `config.js` 的 `PROMPT_TEMPLATES`：
- `dashboardOverview(period)` — 頁面載入時的綜合分析
- `insightDrill(topic)` — KPI 點擊深鑽時的專題分析
