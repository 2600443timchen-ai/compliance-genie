// 抽離的 API 模組 (API Service Module)

async function fetchSummaryWithPolling(chatId, maxRetries = 10, pollInterval = 1000) {
  let summaryData = null;
  const baseUrl = typeof GEMINI_CHAT_API_BASE !== 'undefined' ? GEMINI_CHAT_API_BASE : global.GEMINI_CHAT_API_BASE;
  const headers = typeof getChatApiHeaders !== 'undefined' ? getChatApiHeaders() : global.getChatApiHeaders();
  const fetchFn = (typeof global !== 'undefined' && global.mockFetch) ? global.mockFetch : fetch;

  for (let i = 0; i < maxRetries; i++) {
    await new Promise(r => setTimeout(r, pollInterval));
    const url = `${baseUrl}/summary?chat_id=${chatId}&type=markdown`;
    const summaryRes = await fetchFn(url, { headers });
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fetchSummaryWithPolling };
}
