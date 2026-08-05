const assert = require('assert');

// 模擬的全域變數
global.GEMINI_CHAT_API_BASE = 'https://api.mock';
global.getChatApiHeaders = () => ({});
global.PROMPT_TEMPLATES = { riskInsight: () => 'mock prompt' };

// 抽出被測試的輪詢邏輯 (在此直接定義或 import)
async function fetchSummaryWithPolling(chatId, maxRetries = 3, pollInterval = 10) {
  let summaryData = null;
  for (let i = 0; i < maxRetries; i++) {
    await new Promise(r => setTimeout(r, pollInterval));
    const summaryRes = await global.mockFetch(`${global.GEMINI_CHAT_API_BASE}/summary`);
    if (summaryRes.ok) {
      const data = await summaryRes.json();
      if (data.data || data.content) {
        summaryData = data;
        break;
      }
    }
  }
  if (!summaryData) {
    throw new Error("API 處理逾時，無法取得完整摘要");
  }
  return summaryData;
}

async function runTests() {
  console.log("Running Polling Logic Tests...");

  // 測試案例 1: 成功取得資料 (第一次失敗，第二次成功)
  let callCount = 0;
  global.mockFetch = async (url) => {
    callCount++;
    if (callCount === 1) return { ok: true, json: async () => ({ status: 'processing' }) };
    return { ok: true, json: async () => ({ data: 'Success Markdown' }) };
  };
  
  const result = await fetchSummaryWithPolling('chat_123');
  assert.strictEqual(result.data, 'Success Markdown', 'Should return data when successful');
  assert.strictEqual(callCount, 2, 'Should have polled twice');
  console.log("✓ Test 1 Passed: Polling success");

  // 測試案例 2: 處理逾時拋出例外
  global.mockFetch = async (url) => {
    return { ok: true, json: async () => ({ status: 'processing' }) };
  };

  try {
    await fetchSummaryWithPolling('chat_123', 3, 5);
    assert.fail("Should have thrown timeout error");
  } catch (e) {
    assert.strictEqual(e.message, "API 處理逾時，無法取得完整摘要", 'Should throw correct timeout message');
  }
  console.log("✓ Test 2 Passed: Timeout handling");

  // 測試案例 3: 網路異常 (Fetch 拋出錯誤)
  global.mockFetch = async (url) => {
    throw new Error("Network Disconnected");
  };

  try {
    await fetchSummaryWithPolling('chat_123', 3, 5);
    assert.fail("Should have thrown network error");
  } catch (e) {
    assert.strictEqual(e.message, "Network Disconnected", 'Should propagate network error');
  }
  console.log("✓ Test 3 Passed: Network error handling");

  console.log("All tests passed!");
}

runTests().catch(console.error);
