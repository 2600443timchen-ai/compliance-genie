# Compliance Genie 架構文件 (Architecture)

## 系統演進
本系統已從初期的「靜態 Mock 資料展示 (High-Density Domain Mock Analytics)」轉型為「動態 API 驅動 (Dynamic API-Driven)」。所有核心風險指標與摘要，皆直接向 Gemini Cloud 發送即時分析請求取得。

## 資料流 (Data Flow)
1. **觸發層 (Trigger Layer)**: 使用者透過 UI 切換時間區間 (例如「近 14 天」) 觸發 `handlePeriodChange`。
2. **組態與提詞層 (Configuration & Prompt Layer)**: 前端從 `config.js` 載入定義好的 LLM 提詞模板 (`PROMPT_TEMPLATES`)，避免業務邏輯與 UI 視圖過度耦合。
3. **API 互動層 (API Interaction Layer)**:
   - `POST /assistant/chat/list` 取得當前可用的對話 ID。
   - `POST /assistant/chat/{chat_id}` 提交組裝好的風險分析問題 (Prompt)。
   - **輪詢機制 (Polling Mechanism)**: 以非同步方式定期呼叫 `GET /assistant/chat/summary?chat_id={chat_id}&type=markdown`，直到取得最終報告或達最大超時限制。
4. **渲染層 (Rendering Layer)**: 將取得的 Markdown 報告注入到 `api-dynamic-content` 區塊，並更新周圍 KPI 標籤狀態。

## 錯誤處理與邊界條件 (Error Handling & Edge Cases)
- **API 逾時 / 網路異常**: 若輪詢超過最大次數，或發生網路斷線，將在 UI 顯示 `[API 錯誤]` 提示，並退回安全狀態。
- **資料庫快取 (Mock Data)**: 本專案嚴格禁止任何寫死的 Mock 資料。所有 `.html` 預設呈現 `--` 或 `載入中`。

## 測試策略 (Testing Strategy)
- 由於是純靜態前端，主要的非同步輪詢機制 (Polling) 已抽離為純函式，並透過 `js/tests/api_polling.test.js` 進行獨立的單元測試驗證邊界條件 (如重試次數與錯誤拋出)。
