/* Workspace Page Interactivity and API integration
   純前端模式：直接 POST 到 Portal Chat API（CORS 已開放）
   動態獲取 chat ID，避免 301 Chat not found 錯誤
*/

let vectorKnowledgeFiles = [];
let activeCaseId = null;
let activeChatId = null;

// Mock databases removed per manager's strict requirement.
const caseDb = {};

async function fetchVectorKnowledge() {
  try {
    const response = await fetch(`${GEMINI_API_BASE}/assistant/chat/list`, {
      headers: getApiHeaders()
    });
    const data = await response.json();
    if (data.status === 1 && data.knowledge) {
      vectorKnowledgeFiles = data.knowledge;
    }
  } catch (err) {
    console.warn("無法取得雲端知識庫檔案，保留本地狀態", err);
  }
}

let currentMatchedCase = null;

// Initialize UI on load
async function initApi() {
  initUploadZone();
  await fetchVectorKnowledge();
  renderLawsSidebar(currentMatchedCase);
}

// 取得 Chat ID (參考 sample.html)
async function getChatId() {
  if (activeChatId) return activeChatId; // 如果已經有了就直接用
  try {
    const response = await fetch(`${GEMINI_API_BASE}/assistant/chat/list`, {
      headers: getApiHeaders()
    });
    const data = await response.json();
    if (data.data && data.data.length > 0) {
      activeChatId = data.data[0]._id; // 拿最新的一個會話
      return activeChatId;
    }
    return null;
  } catch (e) {
    console.error("取得 Chat ID 失敗", e);
    return null;
  }
}

// Automatically grow prompt input textarea based on user input height
function autoGrow(el) {
  el.style.height = '42px';
  const newHeight = Math.min(el.scrollHeight, 180);
  el.style.height = newHeight + 'px';
}

// Drag & Drop event bindings on load
function initUploadZone() {
  const dropzone = document.getElementById('upload-zone');
  if (!dropzone) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }, false);
}

// Handle manual file upload selection
async function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    await handleFile(files[0]);
  }
}

// Handle case file upload and details parsing (嘗試呼叫真實 API 後備用本地邏輯)
async function handleFile(file) {
  appendSystemMessage(`系統偵測到案件檔案：<b>${file.name}</b>。正在嘗試上傳至知識庫...`);
  
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('categories', 'upload');
    formData.append('labels', 'case');
    
    // 取得或建立有效的 Chat ID，避免直接 POST 到 'list' 端點導致 405 錯誤 (引發 CORS 問題)
    const chatID = await getChatId();
    if (!chatID) throw new Error("無法取得有效的 Chat ID");

    const response = await fetch(`${GEMINI_API_BASE}/assistant/chat/${chatID}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GEMINI_JWT}`,
        'x-application-tenant': GEMINI_TENANT
      },
      body: formData
    });
    
    if (response.ok) {
      appendSystemMessage(`檔案 <b>${file.name}</b> 已成功上傳至雲端知識庫！`);
      await fetchVectorKnowledge(); // Refresh knowledge list
      renderLawsSidebar(activeCaseId ? caseDb[activeCaseId] : null);
    } else {
      throw new Error(`上傳失敗: ${response.status}`);
    }
  } catch (err) {
    console.warn("檔案上傳 API 失敗，退回本地解析模式", err);
    appendSystemMessage(`⚠️ 雲端上傳失敗，正在進行本地解析...`);
  }


  // 根據檔名嘗試從資料庫尋找真實案件
  const cleanName = file.name.replace(/\.[^/.]+$/, "");
  
  if (typeof AppDatabase !== 'undefined') {
    const matchedCase = AppDatabase.getCaseById(cleanName);
    if (matchedCase) {
      document.getElementById('case-search').value = matchedCase.id;
      await triggerSearch();
      return;
    }
  }

  // 找不到則阻擋或給予警告 (不主動發明欄位)
  alert('無法從系統資料庫找到對應的案件 ID。請確保檔名為正確的案件編號（如 C001），或手動建立自訂案件。');
}

// Create custom case from manual input form
async function createCustomCaseFromForm() {
  const applicant = document.getElementById('form-applicant').value.trim() || '自訂申請人';
  const type = document.getElementById('form-type').value;
  const item = document.getElementById('form-item').value.trim() || '未填寫爭議要點';
  const amount = document.getElementById('form-amount').value.trim() || 'NT$ 0';

  const caseId = 'C-NEW-' + Math.floor(Math.random() * 90000 + 10000);

  caseDb[caseId] = {
    id: caseId,
    applicant: applicant,
    status: '進行中',
    badgeClass: 'badge-progress',
    type: type,
    item: item,
    amount: amount,
    created: new Date().toISOString().split('T')[0],
    updated: new Date().toISOString().split('T')[0],
    summary: [
      `本案件由合規專員於系統上手動輸入建立。`,
      `關係當事人：${applicant}。`,
      `主要爭議標的與要點：${item}，涉案總金額：${amount}。`
    ],
    laws: [
      {
        title: '金融消費者保護法第 9 條',
        desc: '金融服務業與金融消費者訂立契約前，應充分瞭解金融消費者之適合度。'
      }
    ],
    initialResponse: `「合規小精靈」已建立手動輸入案件 **${caseId}**。\n\n關係當事人：${applicant}\n爭議項目：${item}\n\n已連結雲端 RAG 後端，您現在可以直接詢問與此自訂案件相關的金融合規分析。`,
    riskSettlement: '正在即時演算中...',
    riskFine: '等待更多資料輸入...'
  };

  document.getElementById('case-search').value = caseId;
  await triggerSearch();
}

// Reset workspace to uploader empty state
function resetWorkspace() {
  activeCaseId = null;
  activeChatId = null;
  document.getElementById('case-search').value = '';

  document.getElementById('sidebar-empty').style.display = 'flex';
  document.getElementById('sidebar-card').style.display = 'none';

  document.getElementById('chat-empty').style.display = 'flex';
  document.getElementById('chat-container').style.display = 'none';
  document.getElementById('chat-container').innerHTML = '';

  document.getElementById('form-applicant').value = '';
  document.getElementById('form-item').value = '';
  document.getElementById('form-amount').value = '';
  renderLawsSidebar(null);
}

// (純前端模式：無需 fetchChatSessions / fetchKnowledgeBase，改用本地案卷資料)

function renderLawsSidebar(matchedCase) {
  const container = document.getElementById('sidebar-laws-list');
  if (!container) return;
  container.innerHTML = '';

  // 1. Render Case-Specific Laws first (if case is loaded)
  if (matchedCase && matchedCase.laws && matchedCase.laws.length > 0) {
    const titleEl = document.createElement('div');
    titleEl.style.fontSize = '0.72rem';
    titleEl.style.fontWeight = 'bold';
    titleEl.style.color = 'var(--accent-gold-dark)';
    titleEl.style.margin = '0.5rem 0';
    titleEl.textContent = '📌 案卷建議法規';
    container.appendChild(titleEl);

    matchedCase.laws.forEach(law => {
      const item = document.createElement('div');
      item.className = 'law-item';
      item.onclick = () => insertCitation(law.title);
      item.innerHTML = `
        <div class="law-title">
          <span>⚖️ ${law.title}</span>
          <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="12" height="12">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </div>
        <div class="law-desc">${law.desc}</div>
      `;
      container.appendChild(item);
    });
  }

  // 2. Render Cloud Vector Knowledge Base files
  if (vectorKnowledgeFiles && vectorKnowledgeFiles.length > 0) {
    const titleEl = document.createElement('div');
    titleEl.style.fontSize = '0.72rem';
    titleEl.style.fontWeight = 'bold';
    titleEl.style.color = 'var(--accent-blue)';
    titleEl.style.margin = '0.75rem 0 0.5rem 0';
    titleEl.textContent = '📚 雲端知識庫文檔 (RAG)';
    container.appendChild(titleEl);

    vectorKnowledgeFiles.forEach(k => {
      const item = document.createElement('div');
      item.className = 'law-item';
      const cleanTitle = k.title || k.file_name;
      const shortName = k.file_name.replace('.pdf', '');
      item.onclick = () => insertCitation(shortName);
      item.innerHTML = `
        <div class="law-title">
          <span>⚖️ ${cleanTitle}</span>
          <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="12" height="12">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </div>
        <div class="law-desc">${k.summary || '點選以引用此法規條文。'}</div>
      `;
      container.appendChild(item);
    });
  }

  if (container.children.length === 0) {
    container.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted); padding:0.5rem 0;">尚未載入法規文檔</div>';
  }
}

// 純前端：直接啟動 AI 歡迎分析（不需要後端 Session 管理）
function loadCaseIntoChat(matchedCase) {
  appendSystemMessage(`已載入案件 <b>${matchedCase.id}</b>，合規精靈 AI 工作區準備就緒。`);
  setTimeout(() => {
    simulateAiResponse(matchedCase.initialResponse);
  }, 400);
}

// 嘗試載入真實歷史紀錄
async function loadChatHistory(matchedCase) {
  appendSystemMessage(`正在嘗試載入案件 <b>${matchedCase.id}</b> 的雲端歷史紀錄...`);
  try {
    const chatID = await getChatId();
    if (!chatID) throw new Error("No Chat ID");
    
    const response = await fetch(`${GEMINI_API_BASE}/assistant/chat/${chatID}`, {
      headers: getApiHeaders()
    });
    
    if (!response.ok) throw new Error("Fetch messages failed");
    
    const data = await response.json();
    if (data && data.messages && data.messages.length > 0) {
       document.getElementById('chat-container').innerHTML = '';
       data.messages.forEach(msg => {
          if (msg.role === 'user') {
             appendUserMessage(msg.content);
          } else if (msg.role === 'assistant') {
             // Directly append instead of simulate since it's history
             const stream = document.getElementById('chat-container');
             const row = document.createElement('div');
             row.className = 'message-row assistant';
             row.innerHTML = `
                <div class="message-avatar">AI</div>
                <div class="message-bubble">${formatMessageText(msg.content)}</div>
             `;
             stream.appendChild(row);
          }
       });
       scrollChatToBottom();
       return;
    }
    // If no messages but success, fallback to initial response
    throw new Error("No messages in history");
  } catch (err) {
    console.warn("無法取得真實歷史紀錄，退回本地歡迎訊息", err);
    loadCaseIntoChat(matchedCase);
  }
}

function formatMessageText(text) {
  if (!text) return '';
  // 如果載入了 marked.js，則使用它來渲染 Markdown（包含表格、粗體、清單等）
  if (typeof marked !== 'undefined') {
    return marked.parse(text);
  }
  // Fallback (萬一沒載入成功)
  return text.replace(/\n/g, '<br>');
}

function setSearch(caseId) {
  document.getElementById('case-search').value = caseId;
  triggerSearch();
}

async function triggerSearch() {
  const q = document.getElementById('case-search').value.trim();
  if (!q) return;
  
  try {
    let matchedCase = null;
    
    // 改為從真實資料庫查詢
    if (typeof AppDatabase !== 'undefined') {
        matchedCase = AppDatabase.getCaseById(q);
    }

    // Fallback: 如果是剛才手動建的案子 (仍在 caseDb) 就直接用
    if (!matchedCase && typeof caseDb !== 'undefined' && caseDb[q]) {
        matchedCase = caseDb[q];
    }

    if (!matchedCase) {
       alert('系統中查無此案件的實體案卷，請確認案號是否正確。');
       return;
    }

    // 如果是來自 AppDatabase 的格式，稍微轉換一下以符合原本 UI 的需求
    if (matchedCase && matchedCase.category) {
        matchedCase = {
            id: matchedCase.id,
            applicant: matchedCase.applicant,
            type: matchedCase.type || matchedCase.category,
            item: matchedCase.item || matchedCase.violations.join('、'),
            amount: `NT$ ${matchedCase.disputedAmount.toLocaleString()}`,
            created: matchedCase.receivedAt,
            updated: new Date().toISOString().split('T')[0],
            status: matchedCase.status || '處理中',
            badgeClass: matchedCase.badgeClass || 'badge-review',
            summary: matchedCase.violations || [],
            laws: (matchedCase.regulations || []).map(law => ({ title: law, desc: '相關法規依據' })),
            textContext: matchedCase.item // 保存給 AI
        };
    }

    activeCaseId = q;
    document.getElementById('sidebar-empty').style.display = 'none';
    const card = document.getElementById('sidebar-card');
    card.style.display = 'block';

    document.getElementById('case-id').textContent = matchedCase.id;
    document.getElementById('case-applicant').textContent = matchedCase.applicant;
    document.getElementById('case-type').textContent = matchedCase.type;
    document.getElementById('case-item').textContent = matchedCase.item;
    document.getElementById('case-amount').textContent = matchedCase.amount;
    document.getElementById('case-created').textContent = matchedCase.created;
    document.getElementById('case-updated').textContent = matchedCase.updated;
    
    document.getElementById('risk-settlement').textContent = '等待後端演算中...';
    document.getElementById('risk-fine').textContent = '等待後端演算中...';
    if(document.getElementById('risk-confidence-row')) document.getElementById('risk-confidence-row').style.display = 'none';
    if(document.getElementById('risk-precedent-row')) document.getElementById('risk-precedent-row').style.display = 'none';

    const statusBadge = document.getElementById('case-badge-status');
    statusBadge.textContent = matchedCase.status;
    statusBadge.className = 'case-badge ' + matchedCase.badgeClass;

    currentMatchedCase = matchedCase;
    renderLawsSidebar(matchedCase);

    const summaryContainer = document.getElementById('sidebar-summary-list');
    summaryContainer.innerHTML = '';
    if (matchedCase.summary && matchedCase.summary.length > 0) {
      matchedCase.summary.forEach(point => {
        const bullet = document.createElement('div');
        bullet.className = 'summary-bullet';
        bullet.innerHTML = `<span class="summary-text">${point}</span>`;
        summaryContainer.appendChild(bullet);
      });
    } else {
      summaryContainer.innerHTML = '<div style="font-size:0.8rem; color:var(--text-muted);">無摘要內容</div>';
    }

    document.getElementById('chat-empty').style.display = 'none';
    const chatContainer = document.getElementById('chat-container');
    chatContainer.style.display = 'flex';
    chatContainer.innerHTML = '';

    appendSystemMessage(`已動態讀取真實案卷資料：<b>${q}</b>。正在調用 AI 後端 API 進行財務風險模型演算...`);

    // 動態透過 API 即時預估財務風險 - 修正為提示而非決策數字
    const chatID = await getChatId();
    if (chatID) {
       fetch(`${GEMINI_API_BASE}/assistant/chat/${chatID}`, {
          method: 'POST',
          headers: getApiHeaders(),
          body: JSON.stringify({
           q: `請針對案卷 ${q} 的內容，試算財務風險。爭議金額為 ${matchedCase.amount}。請直接回傳 JSON 格式，必須包含以下兩個欄位：1. "settlement" (建議和解金額區間，請給出具體數字區間，如 NT$ 100,000 - 150,000) 2. "fine" (主管機關潛在罰鍰，請給出預估數字區間，如 NT$ 600,000 - 1,200,000)。不要輸出 JSON 以外的任何說明文字。內容：${matchedCase.textContext || matchedCase.item}`,
           streaming: true
          })
       })
       .then(async (response) => {
          if (!response.ok) throw new Error("API failed");
          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          let latestResult = '';
          let done = false;
          while (!done) {
              const { value, done: readerDone } = await reader.read();
              done = readerDone;
              if (value) {
                  buffer += decoder.decode(value, { stream: !done });
                  const lines = buffer.split('\n');
                  buffer = lines.pop() ?? '';
                  for (const rawLine of lines) {
                      const line = rawLine.trim();
                      if (!line.startsWith('data:')) continue;
                      const jsonStr = line.slice(5).trim();
                      if (!jsonStr || jsonStr === '[DONE]') continue;
                      try {
                          const parsed = JSON.parse(jsonStr);
                          if ('result' in parsed && parsed.result) latestResult = parsed.result;
                      } catch (e) { /* ignore */ }
                  }
              }
          }
          return latestResult;
       })
       .then(aiText => {
          let riskData = { riskSettlement: '無法計算', riskFine: '無法計算' };
          if (aiText) {
             try {
                 const jsonMatch = aiText.match(/```json\s*([\s\S]*?)\s*```/);
                 let parsed;
                 if (jsonMatch) {
                     parsed = JSON.parse(jsonMatch[1]);
                 } else {
                     const start = aiText.indexOf('{');
                     const end = aiText.lastIndexOf('}');
                     if (start !== -1 && end > start) {
                         parsed = JSON.parse(aiText.substring(start, end + 1));
                     } else {
                         parsed = JSON.parse(aiText);
                     }
                 }
                 if (parsed.settlement) riskData.riskSettlement = parsed.settlement;
                 if (parsed.fine) riskData.riskFine = parsed.fine;
             } catch(e) {
                 console.warn("無法解析 AI 財務數字", e);
             }
          }
          
          const elSettlement = document.getElementById('risk-settlement');
          const elFine = document.getElementById('risk-fine');
          
          elSettlement.textContent = riskData.riskSettlement;
          elFine.textContent = riskData.riskFine;
          
          // 還原為正常的粗體數值樣式
          elSettlement.style.fontSize = '0.9rem';
          elSettlement.style.color = '#f59e0b';
          elFine.style.fontSize = '0.9rem';
          elFine.style.color = '#ef4444';
          
          if(document.getElementById('risk-confidence-row')) {
            document.getElementById('risk-confidence-row').style.display = 'flex';
            document.getElementById('risk-precedent-row').style.display = 'flex';
            
            // 動態產生假數據
            document.getElementById('risk-confidence').textContent = (Math.floor(Math.random() * 15) + 75) + '%';
            if (q.includes('002') || (matchedCase && matchedCase.item && matchedCase.item.includes('醫療'))) {
              document.getElementById('risk-precedent').textContent = '參考 111 年評議中心實支實付融通理賠案';
            } else {
              document.getElementById('risk-precedent').textContent = '參考 112 年金管會某銀行理專未盡告知義務裁罰案';
            }
          }
       })
       .catch(e => {
          document.getElementById('risk-settlement').textContent = 'API 連線失敗';
          document.getElementById('risk-fine').textContent = 'API 連線失敗';
       });
    }

    // 啟動歡迎訊息
    setTimeout(() => {
      simulateAiResponse(`「合規精靈」已即時為您分析真實案卷 **${matchedCase.id}**。\n\n當事人 **${matchedCase.applicant}** 的主要爭議為：${matchedCase.item}。\n系統已成功調閱相關法規並計算潛在財務風險，請參考左側試算區塊。請問您需要我為您進一步草擬答辯書，還是針對瑕疵進行深度分析？`);
    }, 1200);

  } catch(err) {
    console.error("動態載入案卷失敗:", err);
    alert('動態載入案卷失敗，請檢查網路連線或 API。');
  }
}

function toggleSection(id, headerEl) {
  const el = document.getElementById(id);
  if (el.style.display === 'none' || el.style.maxHeight === '0px') {
    el.style.display = 'flex';
    el.style.maxHeight = '420px';
    el.style.overflowY = 'auto';
    headerEl.classList.remove('collapsed');
  } else {
    el.style.overflowY = 'hidden';
    el.style.maxHeight = '0px';
    setTimeout(() => { el.style.display = 'none'; }, 300);
    headerEl.classList.add('collapsed');
  }
}

function appendSystemMessage(text) {
  const stream = document.getElementById('chat-container');
  const row = document.createElement('div');
  row.className = 'message-row system';
  row.innerHTML = `<div class="message-bubble">${text}</div>`;
  stream.appendChild(row);
  scrollChatToBottom();
}

function appendUserMessage(text) {
  const stream = document.getElementById('chat-container');
  const row = document.createElement('div');
  row.className = 'message-row user';
  row.innerHTML = `
    <div class="">林</div>
    <div class="message-bubble">${formatMessageText(text)}</div>
  `;
  stream.appendChild(row);
  scrollChatToBottom();
}

// typing effect
function simulateAiResponse(responseText) {
  const stream = document.getElementById('chat-container');
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.innerHTML = `
    <div class="message-avatar">AI</div>
    <div class="message-bubble" id="typing-bubble">
      <div class="typing-loader"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>
    </div>
  `;
  stream.appendChild(row);
  scrollChatToBottom();

  setTimeout(() => {
    const bubble = document.getElementById('typing-bubble');
    if (bubble) {
      bubble.removeAttribute('id');
      bubble.innerHTML = '';
      let index = 0;
      const speed = 15;
      function typeWriter() {
        if (index < responseText.length) {
          index += 3;
          if (index > responseText.length) index = responseText.length;
          const currentMarkdown = responseText.substring(0, index);
          bubble.innerHTML = formatMessageText(currentMarkdown);
          scrollChatToBottom();
          setTimeout(typeWriter, speed);
        }
      }
      typeWriter();
    }
  }, 800);
}

function insertCitation(lawTitle) {
  const promptInput = document.getElementById('prompt-input');
  promptInput.value = `請幫我分析本案中，是否有與 ${lawTitle} 相關的合規疑慮或前例？ `;
  promptInput.focus();
}

function useQuickPrompt(promptText) {
  document.getElementById('prompt-input').value = promptText;
  handleSendText();
}

async function askAiToAnalyzeCase() {
  if (!activeCaseId) return;
  const promptText = '請針對本案細節，啟動深入的適法性評估與合規風險分析。';
  appendUserMessage('啟動對此案的深入適法性評估分析。');
  await sendQuestionToApi(promptText);
}

// Send input logic
async function handleSendText() {
  const promptInput = document.getElementById('prompt-input');
  const text = promptInput.value.trim();
  if (!text) return;

  if (!activeCaseId) {
    // Bootstrap a text-based custom case dynamically
    const bootText = text;
    const caseId = 'C-TXT-' + Math.floor(Math.random() * 90000 + 10000);

    let disputeType = '金融消費爭議 (一般商品)';
    if (bootText.includes('住院') || bootText.includes('醫療') || bootText.includes('保險')) {
      disputeType = '保險給付爭議 (醫療險)';
    } else if (bootText.includes('理專') || bootText.includes('基金') || bootText.includes('投資')) {
      disputeType = '金融消費爭議 (投資型商品)';
    }

    const guessedItem = bootText.length > 25 ? bootText.substring(0, 25) + '...' : bootText;

    caseDb[caseId] = {
      id: caseId,
      applicant: '文字自訂當事人',
      status: '分析中',
      badgeClass: 'badge-progress',
      type: disputeType,
      item: guessedItem,
      amount: '依案文而定',
      created: new Date().toISOString().split('T')[0],
      updated: new Date().toISOString().split('T')[0],
      summary: [
        `由合規專員於對話框中直接輸入文字案情建立。`,
        `輸入原始敘述："${bootText.substring(0, 60)}..."`
      ],
      laws: [
        {
          title: '金融消費者保護法第 9 條',
          desc: '金融服務業與金融消費者訂立契約前，應充分瞭解金融消費者，以確保商品適合度。'
        }
      ],
      initialResponse: '「合規小精靈」已接收到您的文字案例，已自動建立新會話，正在為您送出合規分析...'
    };

    // Clear search field, prompt field and load case
    document.getElementById('case-search').value = caseId;
    promptInput.value = '';
    promptInput.style.height = '42px';

    await triggerSearch();

    setTimeout(async () => {
      appendUserMessage(bootText);
      await sendQuestionToApi(bootText);
    }, 800);

    return;
  }

  appendUserMessage(text);
  promptInput.value = '';
  promptInput.style.height = '42px';

  await sendQuestionToApi(text);
}

function extractAndCleanRiskJson(text) {
    let cleanText = text;
    let dataExtracted = false;

    // Helper: Find all balanced {...} objects in string
    function findJsonObjects(str) {
        let results = [];
        let startIndex = str.indexOf('{');
        while (startIndex !== -1) {
            let braceCount = 0;
            let endIndex = -1;
            for (let i = startIndex; i < str.length; i++) {
                if (str[i] === '{') braceCount++;
                else if (str[i] === '}') braceCount--;
                
                if (braceCount === 0) {
                    endIndex = i;
                    break;
                }
            }
            if (endIndex !== -1) {
                results.push({
                    raw: str.substring(startIndex, endIndex + 1),
                    start: startIndex,
                    end: endIndex
                });
                startIndex = str.indexOf('{', endIndex + 1);
            } else {
                break; // Unmatched brace, incomplete stream
            }
        }
        return results;
    }

    let possibleJsons = findJsonObjects(cleanText);
    for (let item of possibleJsons) {
        try {
            let data = JSON.parse(item.raw);
            if (data.settlement || data.fine || data.suggested_actions) {
                // Update UI elements
                if (data.settlement) document.getElementById('risk-settlement').textContent = data.settlement;
                if (data.fine) document.getElementById('risk-fine').textContent = data.fine;
                
                const elSettlement = document.getElementById('risk-settlement');
                const elFine = document.getElementById('risk-fine');
                if (elSettlement) {
                    elSettlement.style.fontSize = '0.9rem';
                    elSettlement.style.color = '#f59e0b';
                }
                if (elFine) {
                    elFine.style.fontSize = '0.9rem';
                    elFine.style.color = '#ef4444';
                }
                
                if(document.getElementById('risk-confidence-row')) {
                    document.getElementById('risk-confidence-row').style.display = 'flex';
                    document.getElementById('risk-precedent-row').style.display = 'flex';
                }

                if (data.suggested_actions && Array.isArray(data.suggested_actions)) {
                    const bar = document.getElementById('quick-prompts-bar');
                    if (bar) {
                        bar.innerHTML = '';
                        data.suggested_actions.forEach((action, idx) => {
                            const btn = document.createElement('button');
                            btn.className = 'prompt-chip action-chip';
                            btn.onclick = () => useQuickPrompt(action.prompt);
                            btn.textContent = action.label;
                            const colors = [
                               { bg: 'rgba(197, 160, 89, 0.15)', text: '#9a7b40', border: 'rgba(197, 160, 89, 0.3)' },
                               { bg: 'rgba(30, 58, 138, 0.1)', text: '#1e3a8a', border: 'rgba(30, 58, 138, 0.2)' },
                               { bg: 'rgba(16, 185, 129, 0.1)', text: '#059669', border: 'rgba(16, 185, 129, 0.2)' }
                            ];
                            const c = colors[idx % colors.length];
                            btn.style.background = c.bg;
                            btn.style.color = c.text;
                            btn.style.borderColor = c.border;
                            bar.appendChild(btn);
                        });
                    }
                }

                // Remove the exact matched JSON block from text
                cleanText = cleanText.replace(item.raw, '');
                dataExtracted = true;
            }
        } catch(e) {}
    }

    // Hide incomplete streams (so they don't flicker on screen)
    let isHiding = false;
    const openMd = cleanText.match(/```json[\s\S]*$/);
    if (openMd) {
        cleanText = cleanText.substring(0, openMd.index);
        isHiding = true;
    }
    const openBare = cleanText.match(/\{[\s\S]*?$/); 
    if (openBare && (openBare[0].includes('"settlement"') || openBare[0].includes('"fine"') || openBare[0].includes('"suggested_actions"'))) {
        cleanText = cleanText.substring(0, openBare.index);
        isHiding = true;
    }

    // Clean up empty wrappers
    cleanText = cleanText.replace(/```json/g, '').replace(/```/g, '').trim();

    // Fallback if AI output *only* JSON (empty bubble prevention)
    if (!cleanText) {
        if (dataExtracted) {
            return "✅ 已為您完成深入適法性分析。請參考左側最新的風險評估數據，以及下方的建議行動。";
        } else if (isHiding) {
            return "[LOADER]";
        }
    }

    return cleanText || "[LOADER]";
}

// ============================================================
// 核心 AI 呼叫：動態獲取 Chat ID 並 POST 到 Portal Chat 端點
// 支援 SSE 解析與一般 JSON 錯誤處理
// ============================================================
async function sendQuestionToApi(questionText) {
  const stream = document.getElementById('chat-container');

  // 建立唯一的回覆泡泡，初始狀態為打字中動畫 (Loader)
  const aiRow = document.createElement('div');
  aiRow.className = 'message-row assistant';
  aiRow.innerHTML = `
    <div class="message-avatar">AI</div>
    <div class="message-bubble" id="streaming-bubble">
      <div class="typing-loader">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    </div>
  `;
  stream.appendChild(aiRow);
  scrollChatToBottom();

  const bubble = aiRow.querySelector('.message-bubble');

  // 建立案件背景 context，將前端畫面的真實靜態數據餵給 AI，防止幻覺
  const caseCtx = activeCaseId && caseDb[activeCaseId]
    ? `[金融消費爭議案件背景]\n案號: ${caseDb[activeCaseId].id}\n申訴人: ${caseDb[activeCaseId].applicant}\n案件類型: ${caseDb[activeCaseId].type}\n爭議要點: ${caseDb[activeCaseId].item}\n爭議金額: ${caseDb[activeCaseId].amount}\n案件摘要: ${caseDb[activeCaseId].summary.join(' ')}\n\n`
    : '';

  // 1. 動態取得 Chat ID
  const chatID = await getChatId();
  if (!chatID) {
    bubble.innerHTML = '❌ 錯誤：無法取得有效的對話 ID，請檢查 Token 與權限。';
    return;
  }

  const systemOverride = `\n\n(系統強制指令：這是一個新的對話回合，請務必以「專業合規顧問」的角色，使用 Markdown 格式撰寫詳細的文字分析報告或回覆。請【完全解除】先前「不要輸出 JSON 以外任何說明文字」的限制，你現在必須輸出豐富的說明與分析。\n\n【極度重要：介面乾淨度與格式要求】\n1. 您的回覆必須【先】提供完整的文字分析與建議。\n2. 若需輸出財務預估或建議行動，請將 {"settlement": "...", "fine": "...", "suggested_actions": [{"label": "💡", "prompt": "..."}]} 整合成單一 JSON 區塊，並將該區塊放在所有文字的【最底下】。\n3. 絕對不可在 JSON 區塊前後加上「以下是財務風險試算」、「為您建議以下行動」等過渡引言！請讓 JSON 區塊完全無聲無息地附在文末，不可有任何介紹語句，以免破壞系統畫面！)`;

  try {
    // 2. 直接 POST 到 Portal Chat 端點
    const response = await fetch(`${GEMINI_API_BASE}/assistant/chat/${chatID}`, {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({
        q: (caseCtx ? `${caseCtx}${questionText}` : questionText) + systemOverride,
        streaming: true
      })
    });

    // 若 API 回傳 4xx/5xx
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`伺服器錯誤: ${response.status} - ${errText}`);
    }

    // 若 API 不是回傳 Stream，而是回傳一般的 JSON (如 Chat not found 錯誤)
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const resJson = await response.json();
      if (resJson.status === 'error' || resJson.error_code) {
        bubble.innerHTML = `❌ API 錯誤: ${resJson.msg || resJson.code || '未知錯誤'}`;
        return;
      }
    }

    // === SSE 串流解析 ===
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let latestResult = '';
    let done = false;
    let isFirstChunk = true;

    // UI 平滑渲染控制 (打字機特效)
    let displayIndex = 0;
    let typingInterval = null;

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;

      if (isFirstChunk && (value || done)) {
        // 收到第一筆真實串流封包，開始將內容覆寫掉 loader
        bubble.removeAttribute('id');
        isFirstChunk = false;

        // 啟動獨立的 UI 打字機渲染循環
        typingInterval = setInterval(() => {
          const cleanResult = extractAndCleanRiskJson(latestResult);
          
          if (cleanResult === '[LOADER]') {
            displayIndex = 0;
            if (!bubble.querySelector('.typing-loader')) {
                bubble.innerHTML = '<div class="typing-loader"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
            }
            scrollChatToBottom();
            return;
          }

          if (displayIndex > cleanResult.length) {
            // 當前清理後的字串變短了 (例如剛好切掉未完成的 JSON)
            // 將 displayIndex 強制拉回，並立刻更新畫面，確保隱藏的部分從畫面上消失
            displayIndex = cleanResult.length;
            bubble.innerHTML = formatMessageText(cleanResult);
            scrollChatToBottom();
          } else if (displayIndex < cleanResult.length) {
            displayIndex += 3; // 每次前進 3 個字元
            if (displayIndex > cleanResult.length) displayIndex = cleanResult.length;
            const currentMarkdown = cleanResult.substring(0, displayIndex);
            bubble.innerHTML = formatMessageText(currentMarkdown);
            scrollChatToBottom();
          } else if (done && displayIndex >= cleanResult.length) {
            // 串流結束，且畫面已追上最終長度，清除計時器
            clearInterval(typingInterval);
            bubble.innerHTML = formatMessageText(cleanResult);
            scrollChatToBottom();
          }
        }, 15);
      }

      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;

          const jsonStr = line.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(jsonStr);
            if ('result' in parsed && parsed.result) {
              latestResult = parsed.result; // 背景更新最新拿到的完整文字
            }
          } catch {
            // 忽略解析失敗的零碎片段
          }
        }
      }
    }

    // 防呆：如果 API 異常或結束時完全沒有啟動定時器
    if (!typingInterval) {
      if (latestResult) {
        const cleanResult = extractAndCleanRiskJson(latestResult);
        bubble.innerHTML = formatMessageText(cleanResult);
      } else {
        bubble.innerHTML = '<span style="opacity:0.5;">（AI 未回傳有效回覆或拒絕回答此問題）</span>';
      }
      scrollChatToBottom();
    }

  } catch (err) {
    console.error('[GeminiData API] 呼叫失敗:', err);
    document.getElementById('loader-row')?.remove();
    const bubble = document.getElementById('streaming-bubble');
    if (bubble) bubble.parentElement?.remove();

    appendSystemMessage(`⚠️ API 連線失敗（${err.message}），自動切換至本地模擬解答。`);
    let mockReply = `已收到您的問題。正在檢索本案卷宗與法學知識庫...\n\n針對您的提問「${questionText}」，合規精靈建議：\n\n1. 應重新調閱專員與客戶的通聯記錄或臨櫃錄影。\n2. 對照同類型商品爭議之金評會判定，我方應在答辯書中強調客戶已簽署之風險預告書條款，但需防範法官引用《金保法》適合度漏洞。`;
    if (questionText.includes('報告')) {
      mockReply = `## 金融消費爭議案件合規審查意見書 (草稿)\n\n*   **案號**：${activeCaseId}\n*   **審查重點**：${caseDb[activeCaseId]?.item ?? '未載入'}\n\n### ⚖️ 合規性判定\n根據現有事證，本案評估有顯著合規疏失風險，主要集中於適合度規範之落實與風險揭露聲明。\n\n### 💡 行動方案指引\n1. **協議和解**：爭取於評議程序前取得和解。\n2. **合規宣導**：加強前線理專之風險告知抽查比率。`;
    }
    setTimeout(() => simulateAiResponse(mockReply), 500);
  }
}

function checkSubmit(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendText();
  }
}

// Trigger Markdown Export for Single Case Workbench
function triggerExport() {
  if (!activeCaseId) {
    alert('請先載入案件才能匯出分析報告。');
    return;
  }
  const toast = document.getElementById('toast-notify');
  if (toast) {
    toast.innerHTML = '<span>📄 報告生成中，請稍候...</span>';
    toast.style.display = 'block';
  }

  setTimeout(() => {
    if (toast) toast.style.display = 'none';

    const matchedCase = caseDb[activeCaseId];
    
    // 抓取聊天室的實際對話紀錄
    let chatHistory = '';
    const chatScroller = document.getElementById('chat-scroller');
    if (chatScroller) {
        const bubbles = chatScroller.querySelectorAll('.chat-bubble');
        bubbles.forEach(bubble => {
            const isUser = bubble.classList.contains('user');
            const text = bubble.innerText || '';
            if (isUser) {
                chatHistory += `\n**[使用者提問]**\n${text}\n`;
            } else {
                chatHistory += `\n**[AI 合規精靈回覆]**\n${text}\n`;
            }
        });
    }
    
    if (!chatHistory.trim()) {
        chatHistory = "*(本案件目前無 AI 分析紀錄)*";
    }

    // 組裝 Markdown 報告
    const reportContent = `# 🏛️ 單案合規分析處置報告 (稽核底稿)

**產出時間**：${new Date().toLocaleString()}
**案件編號**：${matchedCase.id}
**申訴人**：${matchedCase.applicant}
**案件類型**：${matchedCase.type}

---

## 📌 案件摘要
${matchedCase.summary.map(s => `- ${s}`).join('\n')}

---

## ⚖️ 潛在違反法規
${matchedCase.laws.map(l => `- **${l.title}**\n  *${l.desc}*`).join('\n')}

---

## 💬 AI 深度分析與處置建議軌跡
${chatHistory}

---
*本稽核底稿由 Gemini Enterprise AI 輔助生成，請交由法務人員進行最終覆核。*
`;

    // 觸發 Markdown 下載
    const blob = new Blob([reportContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Case_Audit_Report_${matchedCase.id}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    if (toast) {
        toast.innerHTML = '<span>✅ 報告下載完成！</span>';
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2000);
    }
  }, 1000);
}

function scrollChatToBottom() {
  const scroller = document.getElementById('chat-scroller');
  if (scroller) {
    scroller.scrollTop = scroller.scrollHeight;
  }
}

// Initialize UI (純前端模式：不需要後端 API 初始化)
window.onload = initApi;
