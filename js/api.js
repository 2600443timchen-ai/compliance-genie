// ============================================================
// API Service Module (api.js)
// 所有對 Gemini Cloud Chat API 的呼叫均透過此模組。
// 使用依賴注入 (Dependency Injection) 確保可測試性。
// ============================================================

/**
 * 取得第一個可用的 Chat ID。
 * @param {Object} options - { baseUrl, headers, fetchFn }
 * @returns {Promise<string>} chatId
 */
async function getChatId(options = {}) {
  const { baseUrl, headers = {}, fetchFn = fetch } = options;
  if (!baseUrl) throw new Error('baseUrl is required');

  const res = await fetchFn(`${baseUrl}/list`, { headers });
  if (!res.ok) throw new Error(`Chat list API 回應異常 (HTTP ${res.status})`);
  const data = await res.json();
  const chatId = data.data?.[0]?._id;
  if (!chatId) throw new Error('目前無可用的分析對話，請先至 Gemini 平台建立對話。');
  return chatId;
}

/**
 * 向指定對話發送問題。
 * @param {string} chatId
 * @param {string} question
 * @param {Object} options - { baseUrl, headers, fetchFn }
 * @returns {Promise<{status: number, ok: boolean}>}
 */
async function askQuestion(chatId, question, options = {}) {
  const { baseUrl, headers = {}, fetchFn = fetch } = options;
  if (!baseUrl) throw new Error('baseUrl is required');

  const res = await fetchFn(`${baseUrl}/${chatId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ question, streaming: false })
  });
  return { status: res.status, ok: res.ok };
}

/**
 * 輪詢取得摘要回應 (Polling for summary)。
 * POST 送出問題後，透過 GET summary 輪詢等待 AI 處理完成。
 * @param {string} chatId
 * @param {Object} options - { baseUrl, headers, fetchFn, maxRetries, pollInterval }
 * @returns {Promise<Object>} summaryData
 */
async function fetchSummaryWithPolling(chatId, options = {}) {
  const maxRetries = options.maxRetries || 15;
  const pollInterval = options.pollInterval || 2000;
  const { baseUrl, headers = {}, fetchFn = fetch } = options;

  if (!baseUrl) throw new Error('baseUrl is required');
  if (!fetchFn) throw new Error('fetchFn is required');

  for (let i = 0; i < maxRetries; i++) {
    await new Promise(r => setTimeout(r, pollInterval));
    const url = `${baseUrl}/summary?chat_id=${chatId}&type=markdown`;
    const res = await fetchFn(url, { headers });
    if (res.ok) {
      const data = await res.json();
      if (data.data || data.content) {
        return data;
      }
    }
  }

  throw new Error('API 處理逾時，無法取得完整摘要。請確認 Gemini Cloud 服務狀態。');
}

/**
 * 完整的「發送問題 → 輪詢回應」流程。
 * 將 askQuestion + fetchSummaryWithPolling 封裝為單一操作。
 * @param {string} chatId
 * @param {string} question
 * @param {Object} options - { baseUrl, headers, fetchFn, maxRetries, pollInterval }
 * @returns {Promise<string>} AI 回覆的文字內容
 */
async function askAndPoll(chatId, question, options = {}) {
  await askQuestion(chatId, question, options);
  const summary = await fetchSummaryWithPolling(chatId, options);
  return summary.data || summary.content || '';
}

// Node.js 環境匯出 (供單元測試使用)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getChatId, askQuestion, fetchSummaryWithPolling, askAndPoll };
}
