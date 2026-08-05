/* ============================================================
   Global Configuration
   API 端點、鑑權設定與中央化提詞管理。
   所有資料查詢均透過 Gemini Cloud Chat API 即時取得，
   本系統不包含任何寫死的假資料或 Mock 數值。
   ============================================================ */

// ✅ 基礎 API 端點 (Portal API 1.0)
const GEMINI_API_BASE = 'https://cloud.geminidata.com/api/portal/api10';
const GEMINI_CHAT_API_BASE = `${GEMINI_API_BASE}/assistant/chat`;

// JWT Token
const GEMINI_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhNjE5ZjFiMDc2M2RlMDAyZDJmNjJmNiIsImlzQVBJIjp0cnVlLCJnX3VpZCI6IjZhNDNhMGVmMDc2M2RlMDAyZDI3ZTVjYyIsImdfYWRtaW4iOmZhbHNlLCJnX2RlbW9hZG1pbiI6ZmFsc2UsImdfYWNjb3VudGFkbWluIjpmYWxzZSwiZ190aWQiOiI2YTQzOWU2NzA3NjNkZTAwMmQyN2Q2YmQ6cHJvZHVjZXIiLCJnX3RpZF9wZXJtaXNzaW9uIjpbIm1ldGE6dXBkYXRlIiwic291cmNlOnJlYWQiLCJzb3VyY2U6dXBkYXRlIiwic291cmNlOmRlbGV0ZSIsImdyYXBoOnJlYWQiLCJncmFwaDp1cGRhdGUiLCJncmFwaDpkZWxldGUiLCJncmFwaDpleHBsb3JlIiwiZ3JhcGg6ZXhwb3J0IiwiY2FudmFzOmFubm90YXRlIiwiY2FudmFzOnBlcnNvbmFsaXplIiwiZGFzaGJvYXJkOnJlYWQiLCJkYXNoYm9hcmQ6dXBkYXRlIiwiY2FudmFzOnNoYXBlIl0sImdfdGlkX3BhcnNlcl9zb3VyY2UiOiJjc3YiLCJnX3RpZF9mZWF0dXJlX2FkZF9vbnMiOlsiYXNzaXN0YW50Il0sImdfYXZhdGFyIjoiMDIiLCJpc3MiOiJodHRwczovL2Nsb3VkLmdlbWluaWRhdGEuY29tIiwic3ViIjoiNmE0M2EwZWYwNzYzZGUwMDJkMjdlNWNjIiwiYXVkIjoiaHR0cHM6Ly9jbG91ZC5nZW1pbmlkYXRhLmNvbSIsImV4cCI6NDg2NjcwNTI4MiwiaWF0IjoxNzg0NzgyNjE5LCJuaWNrbmFtZSI6Im1lbWJlcjMzQDIwMjZzZWkuY29tIiwiZW1haWwiOiJtZW1iZXIzM0AyMDI2c2VpLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjpmYWxzZX0.DJJY-GARRczejSVR2ZaX93iUcLrGxUizZ8lvaoqiAZU';

// Tenant / Project ID
const GEMINI_TENANT = '6a439e670763de002d27d6bd';

// 帶有鑑權的 Request Headers
const getApiHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${GEMINI_JWT}`
});

const getChatApiHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${GEMINI_JWT}`,
  'x-application-tenant': GEMINI_TENANT
});

// 中央化提詞管理 (Centralized Prompt Templates)
// 每個 prompt 均會送至 Gemini Chat API，由 AI 根據知識庫即時回覆
const PROMPT_TEMPLATES = {
  /** 儀表板總覽 — 頁面載入時發送 */
  dashboardOverview: (period) =>
    `請針對「${period}」區間，從知識庫中整理合規風險完整分析報告，包含：\n` +
    `1. 新增高風險事件數量與趨勢變化\n` +
    `2. 潛在財務曝險金額估算\n` +
    `3. SLA 逾期風險案件數與部門分布\n` +
    `4. 待完成法規缺口與最近期限\n` +
    `5. 整體企業風險指數評估與建議\n` +
    `請以 Markdown 格式回覆，並標註數據來源。`,

  /** 指標深鑽 — 使用者點擊 KPI 時發送 */
  insightDrill: (topic) =>
    `請深入分析「${topic}」的詳細情況，包含：\n` +
    `- 目前數值與趨勢\n` +
    `- 根因分析\n` +
    `- 判斷依據與資料來源\n` +
    `- 建議主管的下一步行動\n` +
    `請以 Markdown 格式回覆。`
};
