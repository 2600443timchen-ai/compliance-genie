// Vision Pitch Version of Risk Command Center
// AI 對話透過同源後端代理，統一聊天室與追蹤，離線時退回本地模擬。
const $ = id => document.getElementById(id);

const benchmarkState = {mode: 'snapshot', source: null, item: null};
let activeInsight = null;
let activeInsightTarget = null;
let insightPinned = false;
let insightHideTimer = null;

// ── Dashboard AI Chat 後端代理狀態 ──
let _dashboardChatId = null;
let _workingChatApiBase = null;

function dashboardChatApiBase() {
  return typeof GEMINI_CHAT_API_BASE !== 'undefined'
    ? GEMINI_CHAT_API_BASE
    : 'http://127.0.0.1:8765/api/chat';
}

function dashboardChatApiHeaders() {
  return typeof getChatApiHeaders === 'function'
    ? getChatApiHeaders()
    : { 'Content-Type': 'application/json' };
}

function normalizeDashboardAssistantReply(reply, question) {
  const text = String(reply || '').trim();
  const isGreeting = /^(你好|您好|嗨|哈囉|hello|hi)[!！。,.\s]*$/i.test(String(question || '').trim());
  const isOutOfScopeRefusal = /not relevant to this project|unable to answer question/i.test(text);
  if (isGreeting && isOutOfScopeRefusal) {
    return '你好，我是 Genie 合規助理。我可以協助查詢金融消費者保護法相關案件、分析風險指標，或整理主管決策摘要。';
  }
  return text;
}

async function getDashboardChatId() {
  if (_dashboardChatId) return _dashboardChatId;

  const candidates = [
    _workingChatApiBase,
    typeof GEMINI_CHAT_API_BASE !== 'undefined' ? GEMINI_CHAT_API_BASE : null,
    '/api/chat',
    'http://127.0.0.1:8765/api/chat',
    'http://localhost:8765/api/chat'
  ].filter(Boolean);

  const uniqueCandidates = Array.from(new Set(candidates));
  let lastError = null;

  for (const baseUrl of uniqueCandidates) {
    try {
      const resp = await fetch(`${baseUrl}/session`, {
        headers: dashboardChatApiHeaders()
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && (data.chat_id || data._id)) {
          _dashboardChatId = data.chat_id || data._id;
          _workingChatApiBase = baseUrl;
          console.log('[Dashboard Chat] 成功對接 Chat API. ID:', _dashboardChatId, 'Base:', baseUrl);
          return _dashboardChatId;
        }
      } else {
        lastError = new Error(`HTTP ${resp.status}`);
      }
    } catch (err) {
      lastError = err;
      console.warn(`[Dashboard Chat] 嘗試對接 ${baseUrl}/session 失敗:`, err);
    }
  }

  throw new Error(`無法連線至後端 Chat API (已試: ${uniqueCandidates.join(', ')}). 原因: ${lastError ? lastError.message : '無回應'}`);
}

function formatSourceDate(value) {
  const text = String(value || '');
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}/${text.slice(4, 6)}/${text.slice(6)}` : text;
}

function normalizeLiveSource(snapshot, rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('來源沒有可用資料列');
  const dispute = Object.prototype.hasOwnProperty.call(rows[0], '合計');
  const countColumn = dispute ? '合計' : (Object.prototype.hasOwnProperty.call(rows[0], '申請評議件數') ? '申請評議件數' : '申訴件數');
  const ratioColumn = Object.keys(rows[0]).find(key => /案件比率|申請評議比率|申訴率/.test(key));
  const nameColumn = dispute ? '爭議類型' : '爭議對象';
  const number = value => Number(String(value || '0').replace(/,/g, '')) || 0;
  const items = rows.map(row => ({
    name: row[nameColumn],
    complaints: dispute ? number(row['申訴件數']) : number(row[countColumn]),
    mediation: dispute ? number(row['評議件數']) : null,
    total: number(row[countColumn]),
    ratio: row[ratioColumn] || '—'
  })).filter(item => item.name).sort((a, b) => b.total - a.total).slice(0, 5);
  if (!items.length) throw new Error('來源欄位不符合預期');
  return {...snapshot, rows: rows.length, start: rows[0]['日期(起)'], end: rows[0]['日期(迄)'], kind: dispute ? 'dispute' : 'company', items};
}

async function fetchLiveSource(snapshot) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 16000);
  try {
    const response = await fetch(`/api/analytics/sources/${encodeURIComponent(snapshot.id)}`, {
      headers: {Accept: 'application/json'},
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Dashboard API ${response.status}`);
    const payload = await response.json();
    if (payload.status !== 'ok' || payload.mode !== 'live' || payload.source_id !== snapshot.id || !Array.isArray(payload.rows)) {
      throw new Error('後端回應未通過資料契約驗證');
    }
    return {...normalizeLiveSource(snapshot, payload.rows), fetchedAt: payload.fetched_at, cache: payload.cache};
  } finally {
    clearTimeout(timer);
  }
}

function snapshotItems(source) {
  return source.items.map(item => Array.isArray(item) ? ({name:item[0], complaints:item[1], mediation:item[2], total:item[3], ratio:item[4]}) : item);
}

let INSIGHT_DEFINITIONS = {};

async function initLiveDashboardApis() {
  // 0. 預先嘗試連線並初始化 Chat ID Session
  try {
    const chatId = await getDashboardChatId();
    console.log('[Dashboard] Gemini Chat Session 初始化成功. Chat ID:', chatId);
  } catch (e) {
    console.warn('[Dashboard] 預先初始化 Chat Session 警告:', e.message || e);
  }

  // 0.5 Fetch Insights API
  try {
    const insightsResp = await fetch('/api/insights');
    if (insightsResp.ok) {
      const insightsData = await insightsResp.json();
      if (insightsData.status === 'success' && insightsData.data) {
        INSIGHT_DEFINITIONS = insightsData.data;
        console.log('[Dashboard] Insights API loaded successfully');
      }
    }
  } catch (e) {
    console.warn('[Dashboard] 無法連線至 /api/insights', e);
  }

  // 1. 檢查 Gemini Data 後端健康狀態與 API 設定
  try {
    const healthResp = await fetch('/api/health');
    if (healthResp.ok) {
      const health = await healthResp.json();
      const statusEl = document.querySelector('.data-status');
      if (statusEl) {
        statusEl.className = 'data-status ready';
        const now = new Date();
        const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        statusEl.innerHTML = `<span class="status-dot"></span><div><strong>Gemini Data API 已連線</strong><small>${timeStr} (即時數據已對接)</small></div>`;
      }
    }
  } catch (e) {
    console.warn('[Dashboard] 無法連線至 /api/health', e);
  }

  // 2. 獲取 Gemini Data 允許的資料源清單 API
  try {
    const sourcesResp = await fetch('/api/analytics/sources');
    if (sourcesResp.ok) {
      const sourcesData = await sourcesResp.json();
      console.log('[Dashboard] Gemini Data Sources Catalog Loaded:', sourcesData.sources?.length || 0, 'sources');
    }
  } catch (e) {
    console.warn('[Dashboard] 無法讀取 /api/analytics/sources 目錄', e);
  }

  // 3. 載入外部基準與行業爭議 API 並同步 UI 指標
  await loadExternalBenchmark();
}

async function loadExternalBenchmark() {
  const snapshot = window.ANALYTICAL_SOURCE_SNAPSHOTS?.find(source => source.id === '6a59d1880904f50013826d6e');
  if (!snapshot) return;
  let source = snapshot;
  try {
    source = await fetchLiveSource(snapshot);
    benchmarkState.mode = 'live';
  } catch (error) {
    benchmarkState.mode = 'snapshot';
  }
  const item = snapshotItems(source).find(entry => entry.name === '業務招攬爭議') || snapshotItems(source)[0];
  benchmarkState.source = source;
  benchmarkState.item = item;
  const modeTag = benchmarkState.mode === 'live' ? ' (Gemini Data API 即時)' : ' (已驗證快照)';
  $('benchmark-value').textContent = `業務招攬爭議 ${item.total} 件 · 占 ${item.ratio}${modeTag}`;
  INSIGHT_DEFINITIONS.benchmark.metric = `${item.total} 件 · 占 ${item.ratio}`;
  INSIGHT_DEFINITIONS.benchmark.evidence = `${item.complaints} 件申訴 + ${item.mediation} 件評議；${formatSourceDate(source.start)}–${formatSourceDate(source.end)}；Source ${source.id}；${benchmarkState.mode === 'live' ? '正式 Gemini Data API 即時對接' : '已驗證快照'}。`;
}

function positionInsightPopover(target) {
  if (!target) return;
  const popover = $('insight-popover');
  const rect = target.getBoundingClientRect();
  const width = 370;
  const drawerWidth = document.body.classList.contains('ai-drawer-open')
    ? ($('ai-drawer')?.getBoundingClientRect().width || 400)
    : 0;
  const usableRight = window.innerWidth - drawerWidth - 12;
  const rightPlacement = rect.right + 12;
  const leftPlacement = rect.left - width - 12;
  const preferredLeft = rightPlacement + width <= usableRight ? rightPlacement : leftPlacement;
  const left = Math.max(12, Math.min(preferredLeft, usableRight - width));
  const popoverHeight = popover.offsetHeight || 470;
  const top = Math.min(Math.max(12, rect.top), window.innerHeight - popoverHeight - 12);
  popover.style.left = `${left}px`;
  popover.style.top = `${Math.max(12, top)}px`;
}

let insightEnterTimer = null;

const PERIOD_DATA = {
  '近 14 天': {
    riskIndex: '78',
    riskStatus: '風險升溫',
    riskNote: '投資型保單訊號推升 12 點',
    avoidance: 'NT$ 520–760 萬',
    avoidanceNote: '若 2 項治理措施如期完成 · 信心 76%',
    events: '12',
    eventsTrend: '↑ 較前 14 天 +35%',
    exposure: 'NT$ 680–1,020 萬',
    exposureNote: '27 件高風險案件估算',
    sla: '27 件',
    slaNote: '3 件需於 48 小時內介入',
    reg: '4 項',
    regNote: '最近期限：14 天',
    briefLead: '近 14 天相關爭議由 31 件上升至 42 件，其中 65 歲以上客戶占 82%；主要集中於適合度評估與風險說明紀錄。',
    chartTrend: '+35%',
    bars: ['38%', '48%', '62%', '84%']
  },
  '本月': {
    riskIndex: '84',
    riskStatus: '警戒狀態',
    riskNote: '客訴與評議案件持續累積',
    avoidance: 'NT$ 1,280–1,850 萬',
    avoidanceNote: '若 4 項治理措施如期完成 · 信心 82%',
    events: '28',
    eventsTrend: '↑ 較上月 +48%',
    exposure: 'NT$ 1,450–2,100 萬',
    exposureNote: '42 件高風險案件估算',
    sla: '38 件',
    slaNote: '7 件需於 48 小時內介入',
    reg: '6 項',
    regNote: '最近期限：8 天',
    briefLead: '本月相關爭議累計達 78 件，其中高齡客戶投訴佔比持續攀升至 86%；已觸發全面合規稽核。',
    chartTrend: '+48%',
    bars: ['25%', '42%', '70%', '95%']
  },
  '本季': {
    riskIndex: '71',
    riskStatus: '中度受控',
    riskNote: '季末避險措施開始發揮成效',
    avoidance: 'NT$ 3,400–4,200 萬',
    avoidanceNote: '累積完成 8 項治理措施 · 信心 88%',
    events: '65',
    eventsTrend: '↓ 較上季 -15%',
    exposure: 'NT$ 2,200–3,100 萬',
    exposureNote: '89 件歷史案件回溯',
    sla: '19 件',
    slaNote: '1 件需於 48 小時內介入',
    reg: '2 項',
    regNote: '最近期限：28 天',
    briefLead: '本季累計處理 185 件爭議案件，高齡投資型保單案件在實施冷卻期後顯著下降 15%。',
    chartTrend: '-15%',
    bars: ['85%', '65%', '45%', '30%']
  }
};

function handlePeriodChange(val) {
  toast(`已切換觀察期間至「${val}」`);
  const data = PERIOD_DATA[val] || PERIOD_DATA['近 14 天'];
  
  const riskScore = document.querySelector('.risk-ring strong');
  if (riskScore) riskScore.textContent = data.riskIndex;
  const riskStatus = document.querySelector('.risk-index-copy strong');
  if (riskStatus) riskStatus.textContent = data.riskStatus;
  const riskNote = document.querySelector('.risk-index-copy p');
  if (riskNote) riskNote.textContent = data.riskNote;
  
  const avoidVal = document.querySelector('.avoidance-value strong');
  if (avoidVal) avoidVal.textContent = data.avoidance;
  const avoidNote = document.querySelector('.avoidance-value small');
  if (avoidNote) avoidNote.textContent = data.avoidanceNote;
  
  const kpiAlert = document.querySelector('.kpi-alert strong');
  if (kpiAlert) kpiAlert.textContent = data.events;
  const kpiAlertTrend = document.querySelector('.kpi-alert small');
  if (kpiAlertTrend) kpiAlertTrend.textContent = data.eventsTrend;
  
  const kpiExposure = document.querySelector('.kpi-exposure strong');
  if (kpiExposure) kpiExposure.textContent = data.exposure;
  const kpiExposureNote = document.querySelector('.kpi-exposure small');
  if (kpiExposureNote) kpiExposureNote.textContent = data.exposureNote;
  
  const kpiSla = document.querySelector('.kpi-sla strong');
  if (kpiSla) kpiSla.textContent = data.sla;
  const kpiSlaNote = document.querySelector('.kpi-sla small');
  if (kpiSlaNote) kpiSlaNote.textContent = data.slaNote;
  
  const kpiReg = document.querySelector('.kpi-reg strong');
  if (kpiReg) kpiReg.textContent = data.reg;
  const kpiRegNote = document.querySelector('.kpi-reg small');
  if (kpiRegNote) kpiRegNote.textContent = data.regNote;
  
  const briefLead = document.querySelector('.brief-lead');
  if (briefLead) briefLead.textContent = data.briefLead;
  
  const chartTrend = document.querySelector('.chart-labels strong');
  if (chartTrend) chartTrend.textContent = data.chartTrend;
  
  const bars = document.querySelectorAll('.bar-set i');
  if (bars && bars.length === 4) {
    bars.forEach((bar, index) => {
      bar.style.height = data.bars[index];
    });
  }
  
  const animatedElements = document.querySelectorAll('.risk-index-card, .executive-kpis, .priority-brief');
  animatedElements.forEach(el => {
    el.style.opacity = '0.6';
    el.style.transition = 'opacity 0.18s ease';
    setTimeout(() => { el.style.opacity = '1'; }, 180);
  });
}

function showInsight(target, pin = false) {
  const insight = INSIGHT_DEFINITIONS[target.dataset.insight];
  if (!insight) return;
  clearTimeout(insightHideTimer);
  activeInsight = insight;
  activeInsightTarget = target;
  insightPinned = pin || insightPinned;
  $('insight-kicker').textContent = insight.kicker;
  $('insight-title').textContent = insight.title;
  $('insight-metric').textContent = insight.metric;
  $('insight-cause').textContent = insight.cause;
  $('insight-evidence').textContent = insight.evidence;
  $('insight-action').textContent = insight.action;
  const popover = $('insight-popover');
  positionInsightPopover(target);
  popover.classList.add('open');
  popover.classList.toggle('pinned', insightPinned);
  popover.setAttribute('aria-hidden', 'false');
}

function hideInsight(force = false) {
  if (insightPinned && !force) return;
  insightPinned = false;
  activeInsightTarget = null;
  const popover = $('insight-popover');
  popover.classList.remove('open', 'pinned');
  popover.setAttribute('aria-hidden', 'true');
}

function initInsightInteractions() {
  document.querySelectorAll('.insight-target').forEach(target => {
    target.addEventListener('mouseenter', () => {
      if (!insightPinned) {
        clearTimeout(insightEnterTimer);
        insightEnterTimer = setTimeout(() => showInsight(target), 220);
      }
    });
    target.addEventListener('mouseleave', () => {
      clearTimeout(insightEnterTimer);
      insightHideTimer = setTimeout(() => hideInsight(), 220);
    });
    target.addEventListener('focus', () => {
      if (!insightPinned) {
        clearTimeout(insightEnterTimer);
        showInsight(target);
      }
    });
    target.addEventListener('click', event => {
      if (event.target.closest('button, a, select, textarea')) return;
      if (event.target.closest('.insight-target') !== target) return;
      clearTimeout(insightEnterTimer);
      insightPinned = false;
      showInsight(target, true);
    });
  });
  const popover = $('insight-popover');
  popover.addEventListener('mouseenter', () => {
    clearTimeout(insightEnterTimer);
    clearTimeout(insightHideTimer);
  });
  popover.addEventListener('mouseleave', () => {
    clearTimeout(insightEnterTimer);
    insightHideTimer = setTimeout(() => hideInsight(), 220);
  });
  $('insight-close').addEventListener('click', () => hideInsight(true));
  $('insight-ask').addEventListener('click', () => {
    if (!activeInsight) return;
    const question = `請解釋「${activeInsight.title}」為什麼是 ${activeInsight.metric}，並告訴主管下一步。`;
    insightPinned = true;
    popover.classList.add('pinned');
    askDashboardAssistant(question, activeInsight);
  });
  window.addEventListener('resize', () => {
    if (popover.classList.contains('open')) positionInsightPopover(activeInsightTarget);
  });
  window.addEventListener('scroll', () => {
    if (popover.classList.contains('open')) positionInsightPopover(activeInsightTarget);
  }, {passive: true});
}

function toast(t) {
  const e = $('toast');
  e.textContent = t;
  e.classList.add('show');
  setTimeout(() => e.classList.remove('show'), 2800);
}

function generateReport() {
  const btn = $('generate-report-btn');
  const progressContainer = $('report-progress');
  const progressText = document.querySelector('.progress-text');

  btn.style.display = 'none';
  progressContainer.style.display = 'flex';
  progressText.textContent = '彙整風險指標...';
  setTimeout(() => { progressText.textContent = '核對來源與行動狀態...'; }, 650);
  setTimeout(() => { progressText.textContent = '排版管理報告...'; }, 1200);
  setTimeout(() => {
    progressContainer.style.display = 'none';
    btn.style.display = 'flex';
    openDocumentPreview('management-report');
  }, 1650);
}

function toggleSignalDrilldown(active) {
  const panel = $('signal-drilldown');
  const trigger = $('signal-drilldown-btn');
  const filterLabel = $('case-filter-label');
  const shouldOpen = typeof active === 'boolean'
    ? active
    : !document.body.classList.contains('signal-drilldown-active');

  document.body.classList.toggle('signal-drilldown-active', shouldOpen);
  panel.setAttribute('aria-hidden', String(!shouldOpen));
  panel.inert = !shouldOpen;
  trigger.setAttribute('aria-expanded', String(shouldOpen));
  trigger.textContent = shouldOpen ? '深鑽已套用 ✓' : '深鑽 3 筆關聯案件 →';
  filterLabel.textContent = shouldOpen ? 'SIGNAL 01 · 3 件' : '全體';

  if (shouldOpen) {
    requestAnimationFrame(() => {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    toast('已串接 SIGNAL 01 的部門、案件與治理行動');
  } else {
    trigger.focus();
    toast('已清除深鑽，恢復全局視圖');
  }
}

function toggleAiDrawer(open) {
  const drawer = $('ai-drawer');
  const shouldOpen = typeof open === 'boolean'
    ? open
    : !document.body.classList.contains('ai-drawer-open');
  clearTimeout(insightHideTimer);
  document.body.classList.toggle('ai-drawer-open', shouldOpen);
  drawer.setAttribute('aria-hidden', String(!shouldOpen));
  drawer.inert = !shouldOpen;
  if ($('insight-popover')?.classList.contains('open')) {
    positionInsightPopover(activeInsightTarget);
    setTimeout(() => positionInsightPopover(activeInsightTarget), 300);
  }
  if (shouldOpen) setTimeout(() => $('ai-question')?.focus(), 280);
  else $('ai-drawer-trigger')?.focus();
}

function getDashboardAnswer(question, insightContext = null) {
  if (insightContext) {
    return `「${insightContext.title}」目前顯示 ${insightContext.metric}。\n\n為什麼：${insightContext.cause}\n\n判斷依據：${insightContext.evidence}\n\n建議主管下一步：${insightContext.action}\n\n這是依目前儀表板的結構化證據整理，不會補寫畫面與來源中沒有的數字；正式執行前仍需由權責主管覆核。`;
  }
  if (/為什麼|上升|投資型保單/.test(question)) {
    return `目前頁面顯示三個主要訊號：\n\n1. 近 14 天案件由 31 件升至 42 件，增幅 35%。\n2. 65 歲以上客戶占 82%，風險集中度偏高。\n3. 異常主要出現在 KYC 與風險說明紀錄。\n\n建議先核對 8 個異常分行的原始 KYC 與通聯紀錄，再判斷是否擴大治理範圍。`;
  }
  if (/核准|行動|今天|優先/.test(question)) {
    return `今天最需要主管決定的是「提高高齡客戶銷售覆核層級」。\n\n原因：需於 48 小時內處理、預期風險降低效果高，而且先針對 8 個異常分行，不必立即全面停售。第二順位是建立通聯與 KYC 專案抽查工單。`;
  }
  if (/三點|摘要|會議|報告/.test(question)) {
    return `主管會議摘要：\n\n• 投資型保單高齡客群爭議近 14 天增加 35%，涉及 8 個分行。\n• 目前 27 件案件具 SLA 逾期風險，其中 3 件須在 48 小時內介入。\n• 建議先提高異常分行覆核層級並啟動專案抽查，所有措施待權責主管核准。`;
  }
  if (/曝險|金額|罰/.test(question)) {
    return `目前示範估算的潛在財務曝險為 NT$ 680–1,020 萬，來自 27 件高風險案件。若兩項治理措施如期完成，預估可避免曝險為 NT$ 520–760 萬，信心值 76%。兩者都是區間估算而非確定罰鍰；正式決策前仍需逐案核對責任比例、裁罰依據與案件金額。`;
  }
  return `我可以協助比較風險、整理主管摘要或說明目前頁面的估算依據。這是展示模式，我只會使用儀表板上的資訊，不會把未顯示的案情當成已確認事實。`;
}

function appendAssistantMessage(role, text) {
  const conversation = $('ai-conversation');
  const message = document.createElement('div');
  message.className = `ai-message ${role}`;
  if (role.includes('assistant') && typeof marked !== 'undefined') {
    message.innerHTML = marked.parse(text);
  } else {
    message.textContent = text;
  }
  conversation.appendChild(message);
  $('ai-drawer-body').scrollTop = $('ai-drawer-body').scrollHeight;
  return message;
}

// ── 透過後端代理發送問題，解析 SSE 並呈現打字機效果 ──
async function askDashboardAssistantViaApi(question, typingEl) {
  const chatId = await getDashboardChatId();
  if (!chatId) throw new Error('無法取得 Chat ID');

  const apiBase = _workingChatApiBase || (typeof GEMINI_CHAT_API_BASE !== 'undefined' ? GEMINI_CHAT_API_BASE : '/api/chat');
  const resp = await fetch(`${apiBase}/${chatId}`, {
    method: 'POST',
    headers: dashboardChatApiHeaders(),
    body: JSON.stringify({ q: question, streaming: true })
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`伺服器錯誤: ${resp.status} - ${errText}`);
  }

  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const resJson = await resp.json();
    if (resJson.status === 'error') throw new Error(resJson.message || '未知錯誤');
  }

  // 解析 SSE 串流
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let latestResult = '';
  let done = false;
  let displayIndex = 0;
  let typingInterval = null;

  // 啟動打字機渲染
  const startTyping = () => {
    if (typingInterval) return;
    typingEl.classList.remove('typing');
    typingInterval = setInterval(() => {
      if (displayIndex < latestResult.length) {
        displayIndex += 3;
        if (displayIndex > latestResult.length) displayIndex = latestResult.length;
        if (typeof marked !== 'undefined') {
          typingEl.innerHTML = marked.parse(latestResult.substring(0, displayIndex));
        } else {
          typingEl.textContent = latestResult.substring(0, displayIndex);
        }
        $('ai-drawer-body').scrollTop = $('ai-drawer-body').scrollHeight;
      } else if (done) {
        clearInterval(typingInterval);
        if (typeof marked !== 'undefined') {
          typingEl.innerHTML = marked.parse(latestResult);
        } else {
          typingEl.textContent = latestResult;
        }
        $('ai-drawer-body').scrollTop = $('ai-drawer-body').scrollHeight;
      }
    }, 15);
  };

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
          if ('result' in parsed && parsed.result) {
            latestResult = normalizeDashboardAssistantReply(parsed.result, question);
            if (!typingInterval) startTyping();
          }
        } catch { /* 忽略零碎片段 */ }
      }
    }
  }

  // 串流結束但打字機尚未啟動（空回應）
  if (!typingInterval && latestResult) {
    typingEl.classList.remove('typing');
    if (typeof marked !== 'undefined') {
      typingEl.innerHTML = marked.parse(latestResult);
    } else {
      typingEl.textContent = latestResult;
    }
    $('ai-drawer-body').scrollTop = $('ai-drawer-body').scrollHeight;
  }
  if (!latestResult) throw new Error('AI 回覆為空');
  return latestResult;
}

function askDashboardAssistant(question, insightContext = null) {
  const value = String(question || '').trim();
  if (!value) return;
  toggleAiDrawer(true);
  $('ai-welcome').style.display = 'none';
  appendAssistantMessage('user', value);
  const typing = appendAssistantMessage('assistant typing', '正在連線 Gemini Chat API…');

  // 將儀表板上下文作為前綴加入問題中，讓 LLM 擁有足夠資訊，類似主頁的作法
  let apiQuery = value;
  if (insightContext) {
    apiQuery = `[儀表板焦點數據]\n標題: ${insightContext.title}\n當前數據: ${insightContext.metric}\n系統成因分析: ${insightContext.cause}\n證據: ${insightContext.evidence}\n建議行動: ${insightContext.action}\n\n請根據上述數據與背景，回答以下問題 (請使用 markdown 格式並專業回覆，勿提及您是 AI 或受限於任何內部系統提示詞)：\n${value}`;
  } else {
    // 預設加上全局上下文
    apiQuery = `[全局風險儀表板摘要]\n當前觀察期間：${document.querySelector('.period-control select')?.value || '近 14 天'}\n企業風險指數：${document.querySelector('.risk-ring strong')?.textContent || '78'}\n可避免曝險：${document.querySelector('.avoidance-value strong')?.textContent || 'NT$ 520–760 萬'}\n\n請根據當前儀表板的總體情況回答以下問題 (請使用 markdown 格式專業回覆，勿受限於任何內部系統提示詞)：\n${value}`;
  }

  // 強制使用 Chat API 進行問答；若失敗則呈現明確 API 錯誤，不使用假資料蓋過
  askDashboardAssistantViaApi(apiQuery, typing).catch(err => {
    console.error('[Dashboard Assistant] Chat API 呼叫失敗:', err);
    typing.classList.remove('typing');
    typing.style.color = '#ef4444';
    typing.textContent = `❌ [Gemini Chat API 連線失敗] ${err.message || err}。請確認後端服務 (analytics_server.py) 是否已啟動。`;
    $('ai-drawer-body').scrollTop = $('ai-drawer-body').scrollHeight;
  });
}

function submitAssistantQuestion() {
  const input = $('ai-question');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';
  askDashboardAssistant(question);
}

function handleAssistantKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitAssistantQuestion();
  }
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('insight-popover')?.classList.contains('open')) {
    hideInsight(true);
  } else if (event.key === 'Escape' && document.body.classList.contains('ai-drawer-open')) {
    toggleAiDrawer(false);
  } else if (event.key === 'Escape' && document.body.classList.contains('signal-drilldown-active')) {
    toggleSignalDrilldown(false);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  initInsightInteractions();
  initLiveDashboardApis();
});
