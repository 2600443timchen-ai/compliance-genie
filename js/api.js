// 抽離的 API 模組 (API Service Module)

async function fetchSummaryWithPolling(chatId, options = {}) {
  const maxRetries = options.maxRetries || 10;
  const pollInterval = options.pollInterval || 1000;
  const baseUrl = options.baseUrl;
  const headers = options.headers || {};
  const fetchFn = options.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);

  if (!baseUrl) throw new Error("baseUrl is required");
  if (!fetchFn) throw new Error("fetchFn is required");

  let summaryData = null;

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
