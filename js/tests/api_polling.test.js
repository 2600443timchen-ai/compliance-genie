const assert = require('assert');
const { getChatId, askQuestion, fetchSummaryWithPolling, askAndPoll } = require('../api.js');

// 所有測試均使用 Dependency Injection，不依賴全域變數或網路

async function runTests() {
  console.log("Running API Module Tests...");

  // ── getChatId Tests ──

  // Test 1: getChatId 成功取得 chatId
  const mockListSuccess = async (url) => ({
    ok: true,
    json: async () => ({ data: [{ _id: 'abc123' }] })
  });
  const chatId = await getChatId({ baseUrl: 'https://api.mock', fetchFn: mockListSuccess });
  assert.strictEqual(chatId, 'abc123', 'Should return first chat ID');
  console.log("✓ Test 1 Passed: getChatId success");

  // Test 2: getChatId 空列表拋出例外
  const mockListEmpty = async (url) => ({
    ok: true,
    json: async () => ({ data: [] })
  });
  try {
    await getChatId({ baseUrl: 'https://api.mock', fetchFn: mockListEmpty });
    assert.fail("Should have thrown");
  } catch (e) {
    assert.ok(e.message.includes('無可用的分析對話'), 'Should throw no-chat error');
  }
  console.log("✓ Test 2 Passed: getChatId empty list");

  // Test 3: getChatId API 失敗拋出例外
  const mockListFail = async (url) => ({ ok: false, status: 401 });
  try {
    await getChatId({ baseUrl: 'https://api.mock', fetchFn: mockListFail });
    assert.fail("Should have thrown");
  } catch (e) {
    assert.ok(e.message.includes('401'), 'Should include status code in error');
  }
  console.log("✓ Test 3 Passed: getChatId API failure");

  // ── askQuestion Tests ──

  // Test 4: askQuestion 發送問題成功
  let capturedBody = null;
  const mockPost = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 200 };
  };
  const postResult = await askQuestion('chat_123', 'test question', {
    baseUrl: 'https://api.mock',
    headers: { 'Content-Type': 'application/json' },
    fetchFn: mockPost
  });
  assert.strictEqual(postResult.ok, true, 'Should return ok: true');
  assert.strictEqual(capturedBody.question, 'test question', 'Should send question in body');
  assert.strictEqual(capturedBody.streaming, false, 'Should set streaming to false');
  console.log("✓ Test 4 Passed: askQuestion success");

  // ── fetchSummaryWithPolling Tests ──

  // Test 5: 成功取得資料 (第一次 processing，第二次成功)
  let pollCount = 0;
  const mockFetchSuccess = async (url) => {
    pollCount++;
    if (pollCount === 1) return { ok: true, json: async () => ({ status: 'processing' }) };
    return { ok: true, json: async () => ({ data: 'Success Markdown' }) };
  };
  const result = await fetchSummaryWithPolling('chat_123', {
    baseUrl: 'https://api.mock',
    pollInterval: 5,
    fetchFn: mockFetchSuccess
  });
  assert.strictEqual(result.data, 'Success Markdown', 'Should return data when successful');
  assert.strictEqual(pollCount, 2, 'Should have polled twice');
  console.log("✓ Test 5 Passed: Polling success");

  // Test 6: 處理逾時拋出例外
  const mockFetchTimeout = async (url) => {
    return { ok: true, json: async () => ({ status: 'processing' }) };
  };
  try {
    await fetchSummaryWithPolling('chat_123', {
      maxRetries: 3,
      pollInterval: 5,
      baseUrl: 'https://api.mock',
      fetchFn: mockFetchTimeout
    });
    assert.fail("Should have thrown timeout error");
  } catch (e) {
    assert.ok(e.message.includes('逾時'), 'Should throw timeout message');
  }
  console.log("✓ Test 6 Passed: Timeout handling");

  // Test 7: 網路異常拋出錯誤
  const mockFetchNetworkErr = async (url) => {
    throw new Error("Network Disconnected");
  };
  try {
    await fetchSummaryWithPolling('chat_123', {
      maxRetries: 3,
      pollInterval: 5,
      baseUrl: 'https://api.mock',
      fetchFn: mockFetchNetworkErr
    });
    assert.fail("Should have thrown network error");
  } catch (e) {
    assert.strictEqual(e.message, "Network Disconnected", 'Should propagate network error');
  }
  console.log("✓ Test 7 Passed: Network error handling");

  // ── askAndPoll Tests ──

  // Test 8: askAndPoll 完整流程
  let askAndPollStep = 0;
  const mockAskAndPoll = async (url, opts) => {
    askAndPollStep++;
    if (opts?.method === 'POST') {
      return { ok: true, status: 200 };
    }
    // Polling GET
    if (askAndPollStep <= 3) return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ({ data: 'Full flow result' }) };
  };
  const fullResult = await askAndPoll('chat_123', 'test', {
    baseUrl: 'https://api.mock',
    pollInterval: 5,
    fetchFn: mockAskAndPoll
  });
  assert.strictEqual(fullResult, 'Full flow result', 'askAndPoll should return response text');
  console.log("✓ Test 8 Passed: askAndPoll full flow");

  console.log("\nAll 8 tests passed!");
}

runTests().catch(console.error);
