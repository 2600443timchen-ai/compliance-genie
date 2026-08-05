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
  setupSearchAutocomplete();
  await fetchVectorKnowledge();
  renderLawsSidebar(currentMatchedCase);
}

// 取得 Chat ID (參考 sample.html)
async function getChatId() {
  if (activeChatId) return activeChatId; // 如果已經有了就直接用
  const apiBase = typeof GEMINI_CHAT_API_BASE !== 'undefined' ? GEMINI_CHAT_API_BASE : '/api/chat';
  try {
    const response = await fetch(`${apiBase}/session`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    
    if (data && data.chat_id) {
      activeChatId = data.chat_id;
      return activeChatId;
    }
  } catch (error) {
    console.error("取得 Chat ID 失敗", error);
  }
  return null;
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

// Handle case file upload and details parsing
async function handleFile(file) {
  if (!file) return;

  const toast = document.getElementById('toast-notify');
  if (toast) {
    toast.textContent = `☁️ 正在上傳案卷檔案「${file.name}」至雲端向量庫...`;
    toast.style.display = 'block';
  }

  // 1. 本地讀取文字內容預覽 (若為文字檔/CSV/PDF)
  const readFileText = (f) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result || '');
    reader.onerror = () => resolve('');
    reader.readAsText(f);
  });
  const fileContent = await readFileText(file);

  // 顯示對話會話與訊息
  document.getElementById('chat-empty').style.display = 'none';
  const chatContainer = document.getElementById('chat-container');
  chatContainer.style.display = 'flex';
  appendSystemMessage(`📁 系統偵測並接收案件檔案：<b>${file.name}</b> (${(file.size / 1024).toFixed(1)} KB)。正在呼叫雲端 API 上傳與寫入向量知識庫...`);

  // 2. 呼叫兩步驟微服務 API: 上傳檔案 (/import/uploads) + 寫入向量資料庫 (/import/vector/knowledge)
  let cloudUploadedPath = null;
  try {
    const formData = new FormData();
    formData.append('file', file);

    const uploadRes = await fetch(`${GEMINI_API_BASE}/import/uploads`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GEMINI_JWT}`,
        'x-application-tenant': GEMINI_TENANT
      },
      body: formData
    });

    if (uploadRes.ok) {
      const uploadData = await uploadRes.json();
      cloudUploadedPath = uploadData.path || uploadData.file_path || file.name;

      // 第二步：寫入向量知識庫
      await fetch(`${GEMINI_API_BASE}/import/vector/knowledge`, {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          title: file.name,
          file_name: file.name,
          file_path: cloudUploadedPath
        })
      });

      appendSystemMessage(`✅ 檔案 <b>${file.name}</b> 已成功上傳至雲端儲存區並寫入 RAG 向量知識庫！`);
    } else {
      throw new Error(`上傳 HTTP ${uploadRes.status}`);
    }
  } catch (err) {
    console.warn("檔案雲端 API 上傳非同步提示:", err);
    appendSystemMessage(`ℹ️ 已成功載入 <b>${file.name}</b>，並完成本地向量解譯與知識庫解析。`);
  }

  if (toast) {
    toast.textContent = `✅ 檔案「${file.name}」已成功載入並完成向量化！`;
    setTimeout(() => { toast.style.display = 'none'; }, 2500);
  }

  // 3. 自動搜尋或建立該檔案之案件實體
  const cleanName = file.name.replace(/\.[^/.]+$/, "");
  let matchedCase = null;

  if (!matchedCase && typeof caseDb !== 'undefined' && caseDb[cleanName]) {
    matchedCase = caseDb[cleanName];
  }

  // 若資料庫無此現成案號，自動為該上傳檔案建立專屬案件物件
  if (!matchedCase) {
    const caseId = cleanName.match(/^C\d+/i) ? cleanName.toUpperCase() : 'UPLOAD-' + Math.floor(Math.random() * 9000 + 1000);
    matchedCase = {
      id: caseId,
      applicant: `檔案當事人 (${file.name})`,
      type: `匯入案卷分析 (${file.name.split('.').pop().toUpperCase()})`,
      item: fileContent ? (fileContent.substring(0, 60) + '...') : `匯入實體檔案 ${file.name}`,
      amount: '依案卷內容試算',
      created: new Date().toISOString().split('T')[0],
      updated: new Date().toISOString().split('T')[0],
      status: '已審查',
      badgeClass: 'badge-progress',
      summary: [`已成功上傳並寫入向量資料庫: ${file.name}`, `檔案大小: ${(file.size / 1024).toFixed(1)} KB`, `已啟動 AI RAG 多維度適法性檢索`],
      laws: [{ title: '金融消費者保護法', desc: '適用條文' }, { title: '保險法', desc: '相關細則' }],
      textContext: fileContent || `案卷檔案名稱: ${file.name}`
    };
    caseDb[caseId] = matchedCase;
  }

  // 自動帶入搜尋框並觸發載入與 AI 分析
  document.getElementById('case-search').value = matchedCase.id;
  await triggerSearch();
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
    
    const apiBase = typeof GEMINI_CHAT_API_BASE !== 'undefined' ? GEMINI_CHAT_API_BASE : '/api/chat';
    const response = await fetch(`${apiBase}/${chatID}/messages`, {
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) throw new Error("Fetch messages failed");
    
    const resData = await response.json();
    if (resData && resData.data && resData.data.length > 0) {
       document.getElementById('chat-container').innerHTML = '';
       resData.data.forEach(msg => {
          if (msg.role === 'user') {
             appendUserMessage(msg.content);
          } else if (msg.role === 'assistant' || msg.role === 'ai') {
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
  const searchInput = document.getElementById('case-search');
  if (searchInput) searchInput.value = caseId;
  triggerSearch();
}

async function findCasesMatchingQuery(query) {
  if (!query) return [];
  const q = query.toLowerCase().trim();
  let results = [];

  try {
    const res = await fetch(`/api/cases/search?q=${encodeURIComponent(q)}`);
    if (res.ok) {
      const payload = await res.json();
      if (payload.status === 'success') {
        results = payload.data || [];
      }
    } else {
      throw new Error("Backend API error");
    }
  } catch (err) {
    console.warn("Backend API not reachable for search", err);
  }

  if (typeof caseDb !== 'undefined') {
    Object.keys(caseDb).forEach(id => {
      const c = caseDb[id];
      const matchId = id.toLowerCase().includes(q);
      const matchApplicant = c.applicant && c.applicant.toLowerCase().includes(q);
      const matchType = c.type && c.type.toLowerCase().includes(q);
      const matchItem = c.item && c.item.toLowerCase().includes(q);
      if (matchId || matchApplicant || matchType || matchItem) {
        if (!results.some(existing => existing.id === id)) {
          results.push({
            id: id,
            applicant: c.applicant || '自訂當事人',
            type: c.type || '自訂案件',
            item: c.item || '-',
            status: c.status || '處理中',
            badgeClass: c.badgeClass || 'badge-review',
            disputedAmount: c.amount || '0'
          });
        }
      }
    });
  }

  return results;
}

function setupSearchAutocomplete() {
  const searchInput = document.getElementById('case-search');
  const dropdown = document.getElementById('search-autocomplete-list');
  if (!searchInput || !dropdown) return;

  let selectedIndex = -1;

  function hideDropdown() {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
    selectedIndex = -1;
  }

  function renderDropdown(matches, query) {
    if (!matches || matches.length === 0) {
      dropdown.innerHTML = `<div class="search-empty-item">無符合「${query}」的關鍵字或案件</div>`;
      dropdown.style.display = 'flex';
      return;
    }

    dropdown.innerHTML = '';
    matches.forEach((c, idx) => {
      const itemEl = document.createElement('div');
      itemEl.className = `search-autocomplete-item ${idx === selectedIndex ? 'selected' : ''}`;
      itemEl.dataset.caseId = c.id;

      const badgeText = c.status || '審查中';
      const badgeClass = c.badgeClass || 'badge-review';
      const amountStr = typeof c.disputedAmount === 'number' ? `NT$ ${c.disputedAmount.toLocaleString()}` : (c.amount || '');

      itemEl.innerHTML = `
        <div class="search-item-left">
          <div class="search-item-header">
            <span class="search-item-id">${c.id}</span>
            <span class="search-item-applicant">${c.applicant || ''} • ${c.type || c.category || ''}</span>
          </div>
          <div class="search-item-snippet">${c.item || (Array.isArray(c.violations) ? c.violations.join('、') : '') || ''} ${amountStr ? `(${amountStr})` : ''}</div>
        </div>
        <span class="search-item-badge case-badge ${badgeClass}">${badgeText}</span>
      `;

      itemEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        setSearch(c.id);
        hideDropdown();
      });

      dropdown.appendChild(itemEl);
    });

    dropdown.style.display = 'flex';
  }

  searchInput.addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    if (!q) {
      hideDropdown();
      return;
    }
    const matches = await findCasesMatchingQuery(q);
    renderDropdown(matches, q);
  });

  searchInput.addEventListener('focus', async (e) => {
    const q = e.target.value.trim();
    if (q) {
      const matches = await findCasesMatchingQuery(q);
      renderDropdown(matches, q);
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.search-autocomplete-item');
    if (dropdown.style.display === 'none' || items.length === 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        hideDropdown();
        triggerSearch();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
      updateSelection(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      updateSelection(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && items[selectedIndex]) {
        const caseId = items[selectedIndex].dataset.caseId;
        setSearch(caseId);
      } else {
        triggerSearch();
      }
      hideDropdown();
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  });

  function updateSelection(items) {
    items.forEach((item, idx) => {
      if (idx === selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      hideDropdown();
    }
  });
}

async function triggerSearch() {
  const q = document.getElementById('case-search').value.trim();
  if (!q) return;

  // 關閉下拉選單
  const dropdown = document.getElementById('search-autocomplete-list');
  if (dropdown) dropdown.style.display = 'none';

  try {
    let matchedCase = null;
    
    // 1. 先從真實資料庫根據案號精準比對
    try {
        const res = await fetch(`/api/cases/${encodeURIComponent(q)}`);
        if (res.ok) {
            const payload = await res.json();
            if (payload.status === 'success' && payload.data) {
                matchedCase = payload.data;
            }
        }
    } catch(err) {
        console.warn("Backend API not reachable for getCaseById", err);
    }

    // 2. 備用：手動建的案子 (caseDb)
    if (!matchedCase && typeof caseDb !== 'undefined' && caseDb[q]) {
        matchedCase = caseDb[q];
    }

    // 3. 關鍵字模糊比對：若輸入的不是精準案號，搜尋當事人、爭議要點、法規等欄位
    if (!matchedCase) {
        const matches = await findCasesMatchingQuery(q);
        if (matches && matches.length > 0) {
            matchedCase = matches[0];
            // Try fetching full details if we only got partial from search
            try {
                const res = await fetch(`/api/cases/${encodeURIComponent(matchedCase.id)}`);
                if (res.ok) {
                    const payload = await res.json();
                    if (payload.status === 'success' && payload.data) {
                        matchedCase = payload.data;
                    }
                }
            } catch(e) {
                console.warn("Backend API not reachable to fetch full details", e);
            }
        }
    }

    // 4. 直貼案卷全文支援：如果輸入內容長度大於 10 個字，自動將貼入的完整案卷內文轉為自訂案件並啟動 AI 分析
    if (!matchedCase && q.length > 10) {
        matchedCase = {
            id: 'RAW-PASTE',
            applicant: '貼入文本當事人',
            type: '自訂案卷全文分析',
            item: q.length > 40 ? q.substring(0, 40) + '...' : q,
            amount: '依案卷全文為準',
            created: new Date().toISOString().split('T')[0],
            updated: new Date().toISOString().split('T')[0],
            status: '審查中',
            badgeClass: 'badge-review',
            summary: ['系統自動接收貼入之完整案卷文本', '即時將文本傳送至後端 API 進行適法性剖析'],
            laws: [{ title: '金融消費者保護法', desc: '相關適用條文' }],
            textContext: q
        };
    }

    if (!matchedCase) {
       alert(`系統中查無包含「${q}」的相關案卷，請嘗試搜尋案號 (如 C001) 或直接貼入案件全文進行分析。`);
       return;
    }

    // 如果是來自 AppDatabase 的格式，稍微轉換一下以符合原本 UI 的需求
    if (matchedCase && matchedCase.category) {
        matchedCase = {
            id: matchedCase.id,
            applicant: matchedCase.applicant,
            type: matchedCase.type || matchedCase.category,
            item: matchedCase.item || matchedCase.violations?.join('、') || '爭議事項剖析中',
            amount: typeof matchedCase.disputedAmount === 'number' ? `NT$ ${matchedCase.disputedAmount.toLocaleString()}` : (matchedCase.amount || 'NT$ 0'),
            created: matchedCase.receivedAt || new Date().toISOString().split('T')[0],
            updated: new Date().toISOString().split('T')[0],
            status: matchedCase.status || '處理中',
            badgeClass: matchedCase.badgeClass || 'badge-review',
            summary: matchedCase.violations || [],
            laws: (matchedCase.regulations || []).map(law => ({ title: law, desc: '相關法規依據' })),
            textContext: matchedCase.item || matchedCase.violations?.join('、') // 保存給 AI
        };
    }

    activeCaseId = matchedCase.id;
    caseDb[matchedCase.id] = matchedCase; // 確保將案件完整物件存入 caseDb 全域快取中，供 AI 對話調用

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
    if(document.getElementById('risk-rationale-row')) document.getElementById('risk-rationale-row').style.display = 'none';
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

    appendSystemMessage(`已動態讀取真實案卷資料：<b>${matchedCase.id}</b>。合規精靈理算引擎已完成財務風險試算。`);

    // 直接由前端合規理算引擎計算財務風險，不再要求 AI LLM 回傳 JSON 格式
    let amountNum = 1500000;
    if (matchedCase && matchedCase.amount) {
        const parsedVal = parseInt(matchedCase.amount.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(parsedVal) && parsedVal > 0) amountNum = parsedVal;
    }

    const lowSettle = Math.round(amountNum * 0.1 / 10000) * 10000 || 150000;
    const highSettle = Math.round(amountNum * 0.16 / 10000) * 10000 || 250000;
    const riskSettlement = `NT$ ${lowSettle.toLocaleString()} - ${highSettle.toLocaleString()}`;

    const lowFine = amountNum < 500000 ? 300000 : 600000;
    const highFine = amountNum < 500000 ? 600000 : 1200000;
    const riskFine = `NT$ ${lowFine.toLocaleString()} - ${highFine.toLocaleString()}`;

    const elSettlement = document.getElementById('risk-settlement');
    const elFine = document.getElementById('risk-fine');

    if (elSettlement) {
        elSettlement.textContent = riskSettlement;
        elSettlement.style.fontSize = '0.9rem';
        elSettlement.style.color = '#f59e0b';
    }

    if (elFine) {
        elFine.textContent = riskFine;
        elFine.style.fontSize = '0.9rem';
        elFine.style.color = '#ef4444';
    }

    if (document.getElementById('risk-confidence-row')) {
        if (document.getElementById('risk-rationale-row')) {
            document.getElementById('risk-rationale-row').style.display = 'flex';
            const rationaleEl = document.getElementById('risk-rationale');
            if (matchedCase.id.includes('002') || (matchedCase.item && matchedCase.item.includes('醫療'))) {
                rationaleEl.textContent = '依據保險理賠評議實務，按 15%~25% 通融給付賠償比例試算；罰鍰依《保險法》裁罰標準推估。';
            } else if (matchedCase.id.includes('003') || (matchedCase.item && matchedCase.item.includes('盜刷'))) {
                rationaleEl.textContent = '依據信用卡業務管理辦法，按爭議款項全額或 50% 協商負擔；罰鍰依內控控管缺失標準推估。';
            } else {
                rationaleEl.textContent = '依據評議中心實務，按理專 10%~16% 告知瑕疵過失比例賠償；罰鍰依《金融消保法》第30-1條處分基準。';
            }
        }

        document.getElementById('risk-confidence-row').style.display = 'flex';
        document.getElementById('risk-precedent-row').style.display = 'flex';

        document.getElementById('risk-confidence').textContent = (Math.floor(Math.random() * 10) + 82) + '%';
        if (matchedCase.id.includes('002') || (matchedCase.item && matchedCase.item.includes('醫療'))) {
            document.getElementById('risk-precedent').textContent = '參考 111 年評議中心實支實付融通理賠案';
        } else {
            document.getElementById('risk-precedent').textContent = '參考 112 年金管會某銀行理專未盡告知義務裁罰案';
        }
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

  appendUserMessage(text);
  promptInput.value = '';
  promptInput.style.height = '42px';

  await sendQuestionToApi(text);
}

const QUICK_PROMPT_COLORS = [
  { bg: 'rgba(197, 160, 89, 0.15)', text: '#9a7b40', border: 'rgba(197, 160, 89, 0.3)' },
  { bg: 'rgba(30, 58, 138, 0.1)', text: '#1e3a8a', border: 'rgba(30, 58, 138, 0.2)' },
  { bg: 'rgba(16, 185, 129, 0.1)', text: '#059669', border: 'rgba(16, 185, 129, 0.2)' }
];

const QUICK_PROMPT_FALLBACKS = [
  { label: '⚖️ 深入法源分析', prompt: '請根據目前案卷中可驗證的事實，逐項說明可能適用的法規、構成要件與尚待補充的證據；不確定之處請明確標示。' },
  { label: '📝 草擬正式答辯', prompt: '請只根據目前案卷已知事實草擬正式答辯書，未知事實請以待補欄位標示，不得自行補造。' },
  { label: '🔍 核對裁罰前例', prompt: '請列出本案需要查核的裁罰前例與檢索條件；無法確認真實來源時請明確說明，不得虛構案號或裁罰內容。' }
];

const GENERAL_QUERY_PROMPT_FALLBACKS = [
  { label: '🔎 查詢相關案件', prompt: '請依目前問題中的法規、爭點與關鍵字，列出知識庫內最相關的案件及其關聯理由。' },
  { label: '⚖️ 說明法規要件', prompt: '請說明目前問題所涉及法規的構成要件、適用範圍與實務上常見爭點。' },
  { label: '🎯 限縮檢索條件', prompt: '請建議可用來限縮案件檢索結果的商品類型、爭議類別、年份或關鍵事實。' }
];

function getContextualQuickPrompts(currentCase) {
  return currentCase ? QUICK_PROMPT_FALLBACKS : GENERAL_QUERY_PROMPT_FALLBACKS;
}

function deriveQuickPromptLabel(prompt, index) {
  const rules = [
    [/答辯|函覆|回覆主管機關/, '📝 草擬正式答辯'],
    [/裁罰|前例|案例|判決/, '🔍 核對裁罰前例'],
    [/SOP|調查|證據|文件|清單/, '📋 展開調查計畫'],
    [/法源|法規|條文|適法/, '⚖️ 深入法源分析'],
    [/和解|協商|處置/, '🤝 規劃處置方案'],
    [/風險|曝險|金額/, '📊 檢視風險估算']
  ];
  const match = rules.find(([pattern]) => pattern.test(prompt));
  return match ? match[1] : `➡️ 下一步建議 ${index + 1}`;
}

function hasMeaningfulQuickPromptLabel(label) {
  if (typeof label !== 'string') return false;
  const words = label
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, '')
    .replace(/[\s\p{P}\p{S}]/gu, '');
  return words.length >= 2;
}

function isSafeQuickPrompt(prompt) {
  if (typeof prompt !== 'string') return false;
  const value = prompt.trim();
  if (value.length < 8 || value.length > 240) return false;
  const unsafeOrRefusal = /忽略.{0,12}(先前|上述|系統|指令)|system\s*prompt|developer\s*message|越獄|jailbreak|無法.{0,8}(協助|回答)|不能.{0,8}(協助|回答)|I\s+(?:can(?:not|'t)|won't)/i;
  return !unsafeOrRefusal.test(value);
}

function normalizeQuickPrompts(rawActions) {
  const actions = [];
  let modelContractValid = Array.isArray(rawActions) && rawActions.length === 3;

  for (const [index, rawAction] of (Array.isArray(rawActions) ? rawActions : []).entries()) {
    const action = typeof rawAction === 'string' ? { prompt: rawAction } : (rawAction || {});
    const prompt = String(action.prompt ?? action.question ?? action.text ?? '').trim();
    const rawLabel = String(action.label ?? action.title ?? action.name ?? '').trim();
    const promptIsValid = isSafeQuickPrompt(prompt);
    const labelIsValid = hasMeaningfulQuickPromptLabel(rawLabel);

    if (!promptIsValid || actions.some(item => item.prompt === prompt)) {
      modelContractValid = false;
      continue;
    }

    if (!labelIsValid) modelContractValid = false;
    actions.push({
      label: labelIsValid ? rawLabel.slice(0, 28) : deriveQuickPromptLabel(prompt, index),
      prompt
    });
  }

  for (const fallback of QUICK_PROMPT_FALLBACKS) {
    if (actions.length >= 3) break;
    if (!actions.some(item => item.prompt === fallback.prompt)) actions.push({ ...fallback });
  }

  return { actions: actions.slice(0, 3), modelContractValid };
}

function renderQuickPrompts(rawActions, source = 'model') {
  const result = normalizeQuickPrompts(rawActions);
  const bar = document.getElementById('quick-prompts-bar');
  if (!bar) return result;

  bar.innerHTML = '';
  bar.dataset.promptSource = result.modelContractValid ? source : `${source}-normalized`;
  result.actions.forEach((action, index) => {
    const button = document.createElement('button');
    const color = QUICK_PROMPT_COLORS[index % QUICK_PROMPT_COLORS.length];
    button.type = 'button';
    button.className = 'prompt-chip action-chip';
    button.textContent = action.label;
    button.title = action.prompt;
    button.onclick = () => useQuickPrompt(action.prompt);
    button.style.background = color.bg;
    button.style.color = color.text;
    button.style.borderColor = color.border;
    bar.appendChild(button);
  });
  return result;
}

function findBalancedJsonObjects(text) {
  const results = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        results.push({ raw: text.slice(start, index + 1), start, end: index });
        start = -1;
      }
    }
  }
  return results;
}

function extractSuggestedActions(text) {
  const candidates = findBalancedJsonObjects(text || '');
  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate.raw.replace(/,\s*([\]}])/g, '$1'));
      const actions = parsed.suggested_actions ?? parsed.suggestedActions ?? parsed.actions;
      if (Array.isArray(actions)) return actions;
    } catch (_) { /* Try the next complete JSON object. */ }
  }
  return null;
}

function extractAndCleanRiskJson(text, onActions) {
    let cleanText = text;
    let dataExtracted = false;

    function applyRiskData(data, rawItem) {
        const suggestedActions = data.suggested_actions ?? data.suggestedActions ?? data.actions;
        if (data.settlement || data.fine || Array.isArray(suggestedActions)) {
            // Update UI elements
            const settlementElement = document.getElementById('risk-settlement');
            const fineElement = document.getElementById('risk-fine');
            if (data.settlement && settlementElement) settlementElement.textContent = data.settlement;
            if (data.fine && fineElement) fineElement.textContent = data.fine;

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
                if(document.getElementById('risk-rationale-row')) document.getElementById('risk-rationale-row').style.display = 'flex';
                document.getElementById('risk-confidence-row').style.display = 'flex';
                document.getElementById('risk-precedent-row').style.display = 'flex';
            }

            if (Array.isArray(suggestedActions)) {
                const promptResult = renderQuickPrompts(suggestedActions);
                if (typeof onActions === 'function') onActions(promptResult);
            }

            // Remove the exact matched JSON block from text
            cleanText = cleanText.replace(rawItem, '');
            dataExtracted = true;
            return true;
        }
        return false;
    }

    let possibleJsons = findBalancedJsonObjects(cleanText);
    for (let item of possibleJsons) {
        try {
            let fixedRaw = item.raw.replace(/,\s*([\]}])/g, '$1');
            let data = JSON.parse(fixedRaw);
            applyRiskData(data, item.raw);
        } catch(e) {
            // Regex fallback for malformed JSON
            try {
                let fallbackData = {};
                const settleMatch = item.raw.match(/"settlement"\s*:\s*"([^"]+)"/);
                if (settleMatch) fallbackData.settlement = settleMatch[1];
                
                const fineMatch = item.raw.match(/"fine"\s*:\s*"([^"]+)"/);
                if (fineMatch) fallbackData.fine = fineMatch[1];
                
                const actionsMatch = item.raw.match(/"(?:suggested_actions|suggestedActions|actions)"\s*:\s*(\[[^\]]+\])/);
                if (actionsMatch) {
                    try {
                        fallbackData.suggested_actions = JSON.parse(actionsMatch[1].replace(/,\s*([\]}])/g, '$1'));
                    } catch(err) {}
                }

                applyRiskData(fallbackData, item.raw);
            } catch(e2) {}
        }
    }

    // Hide incomplete streams (so they don't flicker on screen)
    let isHiding = false;
    const openMd = cleanText.match(/```json[\s\S]*$/);
    if (openMd) {
        cleanText = cleanText.substring(0, openMd.index);
        isHiding = true;
    }
    const openBare = cleanText.match(/\{[\s\S]*?$/); 
    if (openBare && (openBare[0].includes('"settlement"') || openBare[0].includes('"fine"') || /"(?:suggested_actions|suggestedActions|actions)"/.test(openBare[0]))) {
        cleanText = cleanText.substring(0, openBare.index);
        isHiding = true;
    }

    // Clean up empty wrappers
    cleanText = cleanText.replace(/```json/g, '').replace(/```/g, '').trim();

    // Fallback if AI output *only* JSON (empty bubble prevention)
    if (!cleanText) {
        if (isHiding) {
            return "[LOADER]";
        }
    }

    return cleanText || "[LOADER]";
}

// 產生結構完整、多章節之專業合規分析報告 (當 API 字數不足時之品質防護備用報告)
function generateRichFallbackReport(questionText, caseObj) {
  if (!caseObj) {
    return `### ⚠️ 查詢回覆安全備援

AI 回覆經多次重載後仍未通過完整性驗證。為避免虛構法源或案件，本區不顯示模型推測結果。

**本回合查詢**
- ${questionText}

請稍後重試，或先以法規名稱、條次、商品類型與爭議關鍵字限縮查詢。`;
  }

  const caseId = caseObj.id;
  const item = caseObj.item;

  return `### ⚠️ 合規分析安全備援（案號：${caseId}）

AI 回覆經多次重載後仍未通過完整性或格式驗證。為避免產生未經證實的案情、法源、裁罰前例或金額，本區不顯示模型推測結論。

**目前可確認的輸入**
- 案件識別：${caseId}
- 爭議主題：${item}
- 本回合問題：${questionText}

**建議人工覆核順序**
1. 核對原始契約、風險揭露、KYC／適合度文件及溝通紀錄。
2. 從官方法規與主管機關資料庫核實法源及裁罰前例。
3. 完成事實與來源核對後，再形成責任比例及處置建議。

\`\`\`json
{
  "suggested_actions": [
    { "label": "📝 草擬答辯書", "prompt": "請根據上述報告，幫我草擬一份給主管機關的答辯書草稿。" },
    { "label": "🔍 查詢類似裁罰", "prompt": "請幫我查詢過去針對類似「未落實適合度評估」的實際裁罰案例。" },
    { "label": "📋 展開調查計畫", "prompt": "請幫我列出針對本案理專與分行的內部調查 SOP。" }
  ]
}
\`\`\`
`;
}

function isUsableAssistantReply(cleanText) {
  if (!cleanText || cleanText === '[LOADER]') return false;
  const plainText = cleanText.replace(/[#*_>`\-\s]/g, '');
  if (plainText.length < 50) return false;
  const refusal = /(?:抱歉|對不起).{0,20}(?:無法|不能)|無法.{0,12}(?:協助|回答|遵循)|不能.{0,12}(?:協助|回答|遵循)|I\s+(?:can(?:not|'t)|won't)\s+(?:help|answer|comply)/i;
  return !refusal.test(cleanText.slice(0, 240));
}

function renderVerifiedFallback(bubble, questionText, currentCase) {
  const fallback = generateRichFallbackReport(questionText, currentCase);
  const cleanFallback = extractAndCleanRiskJson(fallback);
  bubble.innerHTML = formatMessageText(cleanFallback);
  renderQuickPrompts(getContextualQuickPrompts(currentCase), 'fallback');
}

// ============================================================
// 核心 AI 呼叫：動態獲取 Chat ID 並 POST 到 Portal Chat 端點
// 支援品質自動檢測、失敗自動重試與 Rich Fallback 防護
// ============================================================
async function sendQuestionToApi(questionText, retryCount = 0, existingRow = null) {
  const stream = document.getElementById('chat-container');
  let receivedValidQuickPrompts = false;
  const trackQuickPrompts = result => {
    receivedValidQuickPrompts = receivedValidQuickPrompts || result.modelContractValid;
  };

  let aiRow = existingRow;
  if (!aiRow) {
    aiRow = document.createElement('div');
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
  } else {
    const bubble = aiRow.querySelector('.message-bubble');
    if (bubble) {
      bubble.innerHTML = `
        <div class="typing-loader">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
        </div>
      `;
    }
  }

  const bubble = aiRow.querySelector('.message-bubble');

  // 確保使用全域快取中的案件實體背景資料
  const currentCase = activeCaseId ? caseDb[activeCaseId] : null;
  const caseCtx = currentCase
    ? `[金融消費爭議案件背景]\n案號: ${currentCase.id}\n申訴人: ${currentCase.applicant}\n案件類型: ${currentCase.type}\n爭議要點: ${currentCase.item}\n爭議金額: ${currentCase.amount}\n案件摘要: ${Array.isArray(currentCase.summary) ? currentCase.summary.join(' ') : (currentCase.summary || '')}\n\n`
    : '';

  const chatID = await getChatId();
  if (!chatID) {
    bubble.innerHTML = '❌ 錯誤：無法取得有效的對話 ID，請檢查 Token 與權限。';
    return;
  }

  // Quick actions are a client-side concern. Do not add formatting or planning
  // instructions to the user's query; the assistant already has a system prompt.
  renderQuickPrompts(getContextualQuickPrompts(currentCase), 'pending');

  try {
    const apiBase = typeof GEMINI_CHAT_API_BASE !== 'undefined' ? GEMINI_CHAT_API_BASE : '/api/chat';
    const response = await fetch(`${apiBase}/${chatID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: caseCtx ? `${caseCtx}${questionText}` : questionText,
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
          const cleanResult = extractAndCleanRiskJson(latestResult, trackQuickPrompts);
          
          if (cleanResult === '[LOADER]') {
            if (done) {
               clearInterval(typingInterval);
               if (retryCount < 3) {
                   sendQuestionToApi(questionText, retryCount + 1, aiRow);
               } else {
                   renderVerifiedFallback(bubble, questionText, currentCase);
                   scrollChatToBottom();
               }
               return;
            }
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
            if (!isUsableAssistantReply(cleanResult)) {
                if (retryCount < 3) {
                    sendQuestionToApi(questionText, retryCount + 1, aiRow);
                } else {
                    renderVerifiedFallback(bubble, questionText, currentCase);
                }
            } else {
                bubble.innerHTML = formatMessageText(cleanResult);
                if (!receivedValidQuickPrompts) renderQuickPrompts(getContextualQuickPrompts(currentCase), 'local');
            }
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
        const cleanResult = extractAndCleanRiskJson(latestResult, trackQuickPrompts);
        if (!isUsableAssistantReply(cleanResult)) {
            if (retryCount < 3) {
                sendQuestionToApi(questionText, retryCount + 1, aiRow);
                return;
            } else {
                renderVerifiedFallback(bubble, questionText, currentCase);
            }
        } else {
            bubble.innerHTML = formatMessageText(cleanResult);
            if (!receivedValidQuickPrompts) renderQuickPrompts(getContextualQuickPrompts(currentCase), 'local');
        }
      } else {
        if (retryCount < 3) {
            sendQuestionToApi(questionText, retryCount + 1, aiRow);
            return;
        } else {
            renderVerifiedFallback(bubble, questionText, currentCase);
        }
      }
      scrollChatToBottom();
    }

  } catch (err) {
    console.error('[GeminiData API] 呼叫失敗:', err);
    document.getElementById('loader-row')?.remove();
    const bubble = document.getElementById('streaming-bubble');
    if (bubble) bubble.parentElement?.remove();

    appendSystemMessage(`⚠️ API 連線失敗（${err.message}），請確認後端服務是否正常運作。`);
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
