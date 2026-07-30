/* ============================================================
   Global Configuration — Pure Frontend Mode
   直接由瀏覽器呼叫 GeminiData Portal API（已開放 CORS）
   無需 Python FastAPI 後端代理
   ============================================================ */

// ✅ 基礎 API 端點 (Portal API 1.0)
const GEMINI_API_BASE = 'https://cloud.geminidata.com/api/portal/api10';

// JWT Token
const GEMINI_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhNjE5ZjFiMDc2M2RlMDAyZDJmNjJmNiIsImlzQVBJIjp0cnVlLCJnX3VpZCI6IjZhNDNhMGVmMDc2M2RlMDAyZDI3ZTVjYyIsImdfYWRtaW4iOmZhbHNlLCJnX2RlbW9hZG1pbiI6ZmFsc2UsImdfYWNjb3VudGFkbWluIjpmYWxzZSwiZ190aWQiOiI2YTQzOWU2NzA3NjNkZTAwMmQyN2Q2YmQ6cHJvZHVjZXIiLCJnX3RpZF9wZXJtaXNzaW9uIjpbIm1ldGE6dXBkYXRlIiwic291cmNlOnJlYWQiLCJzb3VyY2U6dXBkYXRlIiwic291cmNlOmRlbGV0ZSIsImdyYXBoOnJlYWQiLCJncmFwaDp1cGRhdGUiLCJncmFwaDpkZWxldGUiLCJncmFwaDpleHBsb3JlIiwiZ3JhcGg6ZXhwb3J0IiwiY2FudmFzOmFubm90YXRlIiwiY2FudmFzOnBlcnNvbmFsaXplIiwiZGFzaGJvYXJkOnJlYWQiLCJkYXNoYm9hcmQ6dXBkYXRlIiwiY2FudmFzOnNoYXBlIl0sImdfdGlkX3BhcnNlcl9zb3VyY2UiOiJjc3YiLCJnX3RpZF9mZWF0dXJlX2FkZF9vbnMiOlsiYXNzaXN0YW50Il0sImdfYXZhdGFyIjoiMDIiLCJpc3MiOiJodHRwczovL2Nsb3VkLmdlbWluaWRhdGEuY29tIiwic3ViIjoiNmE0M2EwZWYwNzYzZGUwMDJkMjdlNWNjIiwiYXVkIjoiaHR0cHM6Ly9jbG91ZC5nZW1pbmlkYXRhLmNvbSIsImV4cCI6NDg2NjcwNTI4MiwiaWF0IjoxNzg0NzgyNjE5LCJuaWNrbmFtZSI6Im1lbWJlcjMzQDIwMjZzZWkuY29tIiwiZW1haWwiOiJtZW1iZXIzM0AyMDI2c2VpLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjpmYWxzZX0.DJJY-GARRczejSVR2ZaX93iUcLrGxUizZ8lvaoqiAZU';

// Tenant / Project ID
const GEMINI_TENANT = '6a439e670763de002d27d6bd';

// 帶有鑑權的 Request Headers
const getApiHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${GEMINI_JWT}`
});
