// Vision Pitch Version of Risk Command Center
const $ = id => document.getElementById(id);

let activeInsight = null;
let activeInsightTarget = null;
let insightPinned = false;
let insightHideTimer = null;
let dashboardChatId = null;
let dashboardChatTitle = '';
let dashboardPayload = null;
let dashboardRequestSerial = 0;
let insightControlsBound = false;

function setDashboardApiStatus(state, title, detail) {
  const status = document.querySelector('.data-status');
  if (!status) return;
  status.className = `data-status ${state}`;
  status.innerHTML = `<span class="status-dot"></span><div><strong>${title}</strong><small>${detail}</small></div>`;
}

async function loadDashboardChatSession() {
  const response = await fetch('/api/chat/session', {headers: {Accept: 'application/json'}});
  const payload = await response.json();
  if (!response.ok || payload.status !== 'ok' || payload.mode !== 'live' || !payload.chat_id) {
    throw new Error(payload.message || `Chat Session API ${response.status}`);
  }
  dashboardChatId = payload.chat_id;
  dashboardChatTitle = payload.chat_title || '';
  return payload;
}

async function askDashboardJson(prompt, expectedFeature) {
  if (!dashboardChatId) await loadDashboardChatSession();
  const response = await fetch(`/api/chat/${encodeURIComponent(dashboardChatId)}`, {
    method: 'POST',
    headers: {'Accept':'text/event-stream','Content-Type':'application/json'},
    body: JSON.stringify({q: prompt, streaming: true, expected_feature: expectedFeature})
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try { detail = (await response.json()).message || detail; } catch (_) { /* no JSON error */ }
    throw new Error(detail);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let result = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.value) buffer += decoder.decode(chunk.value, {stream: !chunk.done});
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const eventText = line.slice(5).trim();
      if (!eventText || eventText === '[DONE]') continue;
      try {
        const event = JSON.parse(eventText);
        if (typeof event.result === 'string') result = event.result;
      } catch (_) { /* malformed SSE event is ignored; final JSON is still validated */ }
    }
    if (chunk.done) break;
  }
  return parseAndValidateAiJson(result, expectedFeature);
}

function formatMoneyRange(value) {
  if (!value || !Number.isFinite(Number(value.min)) || !Number.isFinite(Number(value.max))) return '—';
  const currency = value.currency === 'TWD' ? 'NT$' : (value.currency || '');
  const min = Number(value.min);
  const max = Number(value.max);
  const amount = min === max
    ? min.toLocaleString('zh-TW')
    : `${min.toLocaleString('zh-TW')}–${max.toLocaleString('zh-TW')}`;
  return `${currency} ${amount}`.trim();
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
}

function clearDashboardValues({preserveBenchmark = false} = {}) {
  setText('.risk-ring strong', '—');
  setText('.risk-index-copy strong', '載入中');
  setText('.risk-index-copy p', '正在非同步查詢並驗證資料…');
  ['.kpi-alert strong','.kpi-exposure strong','.kpi-sla strong','.kpi-reg strong'].forEach(selector => setText(selector, '—'));
  ['.kpi-alert small','.kpi-exposure small','.kpi-sla small','.kpi-reg small'].forEach(selector => setText(selector, '載入中…'));
  setText('.brief-lead', '正在取得重大風險訊號…');
  setText('.chart-labels strong', '—');
  setText('.priority-header h2', '載入中…');
  document.querySelectorAll('.evidence-list dd').forEach(element => {
    const nestedValue = element.querySelector('#benchmark-value');
    if (nestedValue) {
      if (!preserveBenchmark) nestedValue.textContent = '載入中…';
    }
    else element.textContent = '—';
  });
  document.querySelectorAll('.bar-set i').forEach(bar => { bar.style.height = '0%'; });
  const rankingList = document.querySelector('.source-ranking-list');
  if (rankingList) rankingList.textContent = '正在取得正式來源排行…';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function warningText(warnings) {
  return (Array.isArray(warnings) ? warnings : [])
    .map(item => typeof item === 'string' ? item : (item?.message || item?.code || JSON.stringify(item)))
    .filter(Boolean)
    .join('；');
}

function renderDashboardCollections(data) {
  setText('.priority-header h2', data.primary_signal?.title);
  const evidence = document.querySelectorAll('.evidence-list dd');
  if (evidence[0]) evidence[0].textContent = data.primary_signal?.industry || '—';
  if (evidence[1]) evidence[1].textContent = '外部彙總資料不能推論內部成因';
  if (evidence[2]) evidence[2].textContent = '不適用';

  const rankedItems = [
    ...(Array.isArray(data.top_disputes) ? data.top_disputes.slice(0, 3).map(item => ({...item, kind:'爭議分類'})) : []),
    ...(Array.isArray(data.company_benchmarks) ? data.company_benchmarks.slice(0, 2).map(item => ({...item, kind:item.metric || '機構統計'})) : [])
  ];
  setText('.source-ranking-panel .tag-warning', `${rankedItems.length} 項`);
  const rankingList = document.querySelector('.source-ranking-list');
  if (rankingList) {
    rankingList.innerHTML = rankedItems.length ? rankedItems.map((item, index) => {
      const insightId = `source-ranking-${index}`;
      INSIGHT_DEFINITIONS[insightId] = {
        kicker:'VERIFIED SOURCE ITEM',
        title:`${item.industry || '未分類'}－${item.name || '未命名'}`,
        metric:`${Number(item.total || 0).toLocaleString('zh-TW')} 件`,
        cause:`依正式來源的「${item.kind}」欄位排序，未加入模型估算。`,
        evidence:`Source ${item.source_id || '未提供'}${item.ratio ? `；來源比率 ${item.ratio}` : ''}`,
        action:'可作為外部產業比較與檢索入口；不得直接視為本公司內部風險。'
      };
      return `<article class="insight-target source-ranking-item" data-insight="${insightId}" tabindex="0"><div class="approval-top"><span class="action-meta">${escapeHtml(item.kind)}</span><span>${escapeHtml(item.industry || '未分類')}</span></div><h3>${escapeHtml(item.name || '未命名')}</h3><div class="owner-row"><span>Source ${escapeHtml(item.source_id || '未提供')}</span><strong>${Number(item.total || 0).toLocaleString('zh-TW')} 件</strong></div></article>`;
    }).join('') : '正式來源沒有可排名資料。';
  }

  setText('.drilldown-head h2', data.primary_signal?.title);
  setText('.drilldown-head p', data.primary_signal?.summary);
  const flow = document.querySelectorAll('.drilldown-flow article');
  if (flow[0]) { flow[0].querySelector('strong').textContent = data.primary_signal?.category || '—'; flow[0].querySelector('small').textContent = data.primary_signal?.source_id || '—'; }
  if (flow[1]) { flow[1].querySelector('strong').textContent = data.primary_signal?.industry || '—'; flow[1].querySelector('small').textContent = '外部產業範圍'; }
  if (flow[2]) { flow[2].querySelector('strong').textContent = '未連接'; flow[2].querySelector('small').textContent = '需要內部逐案資料'; }
  if (flow[3]) { flow[3].querySelector('strong').textContent = '未連接'; flow[3].querySelector('small').textContent = '需要治理台帳'; }
  initInsightInteractions();
}

function renderDashboardOverview(payload) {
  if (payload.feature !== 'dashboard_source_overview' || !['success','partial'].includes(payload.status)) throw new Error('Dashboard 回應契約不符');
  if (!payload.data || typeof payload.data !== 'object') throw new Error('Dashboard 回應缺少 data');
  const data = payload.data;
  const summary = data.summary || {};
  const kpis = data.kpis || {};
  const total = kpis.external_total || {};
  const coverage = kpis.source_coverage || {};
  const highRisk = kpis.new_high_risk_events || {};
  const exposure = kpis.financial_exposure || {};
  setText('.risk-ring strong', coverage.loaded);
  setText('.risk-index-copy strong', summary.label);
  setText('.risk-index-copy p', summary.primary_driver);
  setText('.kpi-alert strong', Number.isFinite(Number(highRisk.value)) ? Number(highRisk.value).toLocaleString('zh-TW') : '—');
  setText('.kpi-alert small', Number.isFinite(Number(highRisk.threshold)) ? `Q3 門檻 NT$ ${Math.round(Number(highRisk.threshold)).toLocaleString('zh-TW')} 以上` : '案件金額資料不足');
  setText('.kpi-exposure strong', formatMoneyRange(exposure));
  setText('.kpi-exposure small', `${exposure.case_count || 0} 筆已揭露金額案件加總`);
  setText('.kpi-sla strong', '尚未連接');
  setText('.kpi-sla small', '需要內部案件管理系統的 SLA 時鐘資料');
  setText('.brief-lead', data.primary_signal?.summary);
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  setText('.priority-brief > .source-note > span', `資料來源：Gemini Data Source API（${sources.length} 個）`);
  const topDisputes = Array.isArray(data.top_disputes) ? data.top_disputes.slice(0, 4) : [];
  const benchmark = topDisputes.find(item => item.industry === '人壽保險') || topDisputes[0] || null;
  setText('#benchmark-value', benchmark
    ? `${benchmark.industry}－${benchmark.name} ${Number(benchmark.total || 0).toLocaleString('zh-TW')} 件${benchmark.ratio ? ` · ${benchmark.ratio}` : ''}`
    : '正式來源未提供外部基準');
  const trendValues = topDisputes.map(item => Number(item.total)).filter(Number.isFinite);
  setText('.chart-labels strong', topDisputes.length ? `TOP ${topDisputes.length}` : '—');
  setText('.chart-labels span', '外部爭議分類件數');
  const bars = document.querySelectorAll('.bar-set i');
  if (bars.length && trendValues.length) {
    const max = Math.max(...trendValues, 1);
    bars.forEach((bar, index) => { bar.style.height = trendValues[index] === undefined ? '0%' : `${Math.max(4, trendValues[index] / max * 100)}%`; });
  }
  document.querySelectorAll('.week-labels span').forEach((label, index) => { label.textContent = topDisputes[index]?.industry || '—'; });
  setText('.hero-proof span:nth-of-type(1) b', sources.length);
  setText('.hero-proof span:nth-of-type(2) b', Number(total.value || 0).toLocaleString('zh-TW'));
  setText('.hero-proof span:nth-of-type(3) b', payload.cache_status === 'last_known_good' ? '快取' : '即時');
  if (typeof INSIGHT_DEFINITIONS !== 'undefined') {
    INSIGHT_DEFINITIONS.events = {kicker:'HIGH-RISK EVENTS (Q3)',title:'新增高風險事件',metric:Number.isFinite(Number(highRisk.value)) ? Number(highRisk.value).toLocaleString('zh-TW') : '—',cause:'依案件資料庫已揭露金額計算 Q3（上四分位數）門檻，金額達門檻以上的案件計為高風險事件。',evidence:`樣本 ${highRisk.sample_size || 0} 筆案件，其中 ${highRisk.amount_count || 0} 筆有揭露金額；門檻 NT$ ${Number.isFinite(Number(highRisk.threshold)) ? Math.round(Number(highRisk.threshold)).toLocaleString('zh-TW') : '—'}。`,action:'門檻採統計上的離群值判斷法（Q3），不是正式風險分級；如需業務分級標準，需另訂規則。'};
    INSIGHT_DEFINITIONS.exposure = {kicker:'DISCLOSED CASE AMOUNTS',title:'潛在財務曝險',metric:formatMoneyRange(exposure),cause:'案件資料庫中已揭露涉案金額的直接加總，屬確定性運算，不是 AI 估算的和解或罰鍰金額。',evidence:`${exposure.case_count || 0} 筆案件有揭露金額。`,action:'此數字只代表已知爭議金額總和；實際財務曝險需再納入理賠、和解折讓等因素。'};
    INSIGHT_DEFINITIONS.sla = {kicker:'NOT CONNECTED',title:'SLA 逾期風險',metric:'尚未連接',cause:'需要內部案件管理／工單系統的處理期限與承辦人資料，目前沒有任何已連接來源提供期限欄位。',evidence:'外部申訴/評議統計與案件資料庫均未包含 SLA 或期限資訊。',action:'需先串接內部案件管理系統才能計算此指標，目前誠實留白，不使用估算值填補。'};
    INSIGHT_DEFINITIONS.regulatory = {kicker:'REGULATORY GAP SCAN', title:'待完成法規缺口', metric:'分析中', cause:'正在對隨機抽樣的案件進行 AI 缺口分析…', evidence:'請稍候。', action:'完成後會標示為抽樣估算，並附上案號明細。'};
    INSIGHT_DEFINITIONS.signal = {kicker:'TOP EXTERNAL CATEGORY',title:data.primary_signal?.title || '—',metric:topDisputes[0] ? `${Number(topDisputes[0].total).toLocaleString('zh-TW')} 件` : '—',cause:'依外部爭議分類合計件數排序。',evidence:data.primary_signal?.source_id || '來源未提供',action:'僅作產業訊號，不直接推論本公司成因或違規。'};
    INSIGHT_DEFINITIONS.benchmark = benchmark
      ? {kicker:'EXTERNAL BENCHMARK',title:`${benchmark.industry}－${benchmark.name}`,metric:`${Number(benchmark.total || 0).toLocaleString('zh-TW')} 件`,cause:'直接取自 Dashboard 正式來源聚合結果。',evidence:`Source ${benchmark.source_id || '未提供'}${benchmark.ratio ? `；來源比率 ${benchmark.ratio}` : ''}`,action:'只作外部產業比較，不代表本公司案件量。'}
      : {kicker:'EXTERNAL BENCHMARK',title:'外部產業基準',metric:'—',cause:'正式來源未提供可顯示項目。',evidence:'無',action:'不提供推論。'};
  }
  renderDashboardCollections(data);
}

async function loadDashboardOverview(period) {
  const serial = ++dashboardRequestSerial;
  clearDashboardValues({preserveBenchmark:true});
  setDashboardApiStatus('loading', '正在查詢 Dashboard', '正式 Source 聚合與契約驗證中…');
  const response = await fetch(`/api/dashboard/overview?period=${encodeURIComponent(period)}`, {headers:{Accept:'application/json'}});
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const bodyPreview = (await response.text()).replace(/\s+/g, ' ').slice(0, 80);
    throw new Error(`Dashboard API ${response.status} 回傳 ${contentType || '未知格式'}；後端版本可能過舊，請完整停止後重新啟動。${bodyPreview ? ` 回應：${bodyPreview}` : ''}`);
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || `Dashboard API ${response.status}`);
  if (serial !== dashboardRequestSerial) return;
  renderDashboardOverview(payload);
  dashboardPayload = payload;
  const time = payload.as_of || new Date().toISOString();
  if (payload.status === 'success' && payload.cache_status === 'live') {
    setDashboardApiStatus('ready', 'Dashboard 資料已驗證', `${time} · Gemini Data Source API`);
  } else {
    setDashboardApiStatus('partial', payload.cache_status === 'last_known_good' ? '顯示最近成功資料' : '部分正式來源可用', warningText(payload.warnings));
  }
}

const INSIGHT_DEFINITIONS = {
  events: {kicker:'EXTERNAL COMPLAINTS', title:'外部申訴件數', metric:'載入中', cause:'等待正式 Source 聚合結果。', evidence:'尚未取得資料。', action:'載入完成前不提供推論。'},
  exposure: {kicker:'EXTERNAL MEDIATIONS', title:'外部評議件數', metric:'載入中', cause:'等待正式 Source 聚合結果。', evidence:'尚未取得資料。', action:'不以外部件數推算內部財務曝險。'},
  sla: {kicker:'EXTERNAL TOTAL', title:'申訴與評議合計', metric:'載入中', cause:'等待正式 Source 聚合結果。', evidence:'尚未取得資料。', action:'不以外部統計推算內部 SLA。'},
  regulatory: {kicker:'SOURCE COVERAGE', title:'正式來源覆蓋率', metric:'載入中', cause:'等待來源健康狀態。', evidence:'尚未取得資料。', action:'單一來源失敗不應清空其他資料。'},
  signal: {kicker:'TOP EXTERNAL CATEGORY', title:'外部主要爭議分類', metric:'載入中', cause:'等待正式 Source 排序結果。', evidence:'尚未取得資料。', action:'外部分類不能直接證明內部成因。'},
  benchmark: {kicker:'EXTERNAL BENCHMARK', title:'人壽保險業外部基準', metric:'載入中', cause:'等待正式 Source 資料。', evidence:'尚未取得資料。', action:'只作外部產業比較。'}
};

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

async function handlePeriodChange(val) {
  try {
    await loadDashboardOverview(val);
  } catch (error) {
    dashboardPayload = null;
    clearDashboardValues({preserveBenchmark:true});
    setDashboardApiStatus('error', 'Dashboard 資料無法使用', error.message || String(error));
    toast(`Dashboard 載入失敗：${error.message || error}`);
  }
}

function showInsight(target, pin = false) {
  const targetId = target.dataset.insight;
  const insight = INSIGHT_DEFINITIONS[targetId] || null;
  clearTimeout(insightHideTimer);
  activeInsight = insight || {kicker:'LIVE ANALYSIS',title:target.textContent.trim(),metric:'載入中…',cause:'正在查詢後端資料…',evidence:'回應完成後將執行 JSON 契約驗證。',action:'請稍候。'};
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
  if (!dashboardPayload) {
    $('insight-cause').textContent = 'Dashboard 尚無已驗證資料，無法深鑽。';
  } else if (!insight) {
    $('insight-cause').textContent = '此卡片沒有對應的正式來源說明。';
  }
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
    if (target.dataset.insightBound === 'true') return;
    target.dataset.insightBound = 'true';
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
  if (insightControlsBound) return;
  insightControlsBound = true;
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
  const shouldOpen = typeof active === 'boolean'
    ? active
    : !document.body.classList.contains('signal-drilldown-active');
  if (shouldOpen && !dashboardPayload) {
    toast('Dashboard 尚無已驗證資料，無法深鑽');
    return;
  }

  document.body.classList.toggle('signal-drilldown-active', shouldOpen);
  panel.setAttribute('aria-hidden', String(!shouldOpen));
  panel.inert = !shouldOpen;
  trigger.setAttribute('aria-expanded', String(shouldOpen));
  trigger.textContent = shouldOpen ? '深鑽已套用 ✓' : '深鑽關聯案件 →';

  if (shouldOpen) {
    requestAnimationFrame(() => {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    toast('已顯示風險訊號的關聯證據鏈');
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
  message.textContent = text;
  conversation.appendChild(message);
  $('ai-drawer-body').scrollTop = $('ai-drawer-body').scrollHeight;
  return message;
}

function normalizeDashboardReply(reply, question) {
  const text = String(reply || '').trim();
  const greeting = /^(你好|您好|嗨|哈囉|hello|hi)[!！。,.\s]*$/i.test(String(question || '').trim());
  if (greeting && /not relevant to this project|unable to answer question/i.test(text)) {
    return '你好，我是 Genie 合規助理。我可以協助查詢金融消費者保護法相關案件、分析風險指標，或整理主管決策摘要。';
  }
  return text;
}

async function askDashboardAssistantViaApi(question, output) {
  if (!dashboardChatId) await loadDashboardChatSession();
  if (!dashboardPayload) throw new Error('Dashboard 尚無已驗證資料');
  const verifiedPayload = await askDashboardJson(
    PROMPT_TEMPLATES.dashboardAssistant(question, dashboardPayload),
    'dashboard_assistant'
  );
  if (verifiedPayload.status !== 'success' || typeof verifiedPayload.answer !== 'string' || !verifiedPayload.answer.trim()) {
    throw new Error(formatAiWarnings(verifiedPayload.warnings) || 'AI 回覆資料不足');
  }
  output.classList.remove('typing');
  output.textContent = verifiedPayload.answer.trim();
  $('ai-drawer-body').scrollTop = $('ai-drawer-body').scrollHeight;
  return verifiedPayload;
  /* Legacy text response flow retained below for reference; unreachable after validated JSON return. */

  const augmentedQuestion = `${question}

【系統強制指令：因顯示介面為極窄側邊欄，請嚴格遵守以下排版規則】
1. 若系統預設有設定【合規審查分析報告模板】等結構化輸出要求，請在此次回答中「忽略該模板格式」。
2. 絕對禁止使用 Markdown 語法（禁用表格、粗體、標題、分隔線）。
3. 絕對禁止使用條列式清單或換行列表。
4. 請將原本模板中的資訊（如：案號、爭議項目、法條、建議），融合成「流暢的對話散文」來描述。
5. 請將答案濃縮成 1~3 個簡短段落，直接回答即可。`;

  const response = await fetch(`/api/chat/${encodeURIComponent(dashboardChatId)}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({q: augmentedQuestion, streaming: true})
  });
  if (!response.ok) {
    let message = `Chat API ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.message || message;
    } catch (_) { /* Keep the HTTP error. */ }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let answer = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.value) {
      buffer += decoder.decode(chunk.value, {stream: !chunk.done});
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const eventText = line.slice(5).trim();
        if (!eventText || eventText === '[DONE]') continue;
        try {
          const event = JSON.parse(eventText);
          if (typeof event.result === 'string') answer = normalizeDashboardReply(event.result, question);
        } catch (_) { /* Ignore a malformed SSE event. */ }
      }
    }
    if (chunk.done) break;
  }
  if (!answer) throw new Error('Chat API 未回傳可顯示內容');
  output.classList.remove('typing');
  // 移除常見的 Markdown 符號，確保純文字顯示
  let cleanAnswer = answer
    .replace(/\*{1,2}/g, '')       // 移除粗體、斜體星號
    .replace(/#{1,6}\s?/g, '')     // 移除標題井字號
    .replace(/\|/g, ' ')           // 將表格分隔線轉為空白
    .replace(/-{3,}/g, '')         // 移除水平線
    .replace(/`{1,3}/g, '')        // 移除程式碼區塊標記
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // 移除連結，只保留文字
    .replace(/^\s*-\s+/gm, '• ')   // 將清單符號轉為圓點
    .replace(/^\s*\d+\.\s+/gm, match => match) // 保留數字清單，可依需求調整
    .replace(/\s{2,}/g, ' ')       // 將多個空白替換為單一空白，避免因移除符號造成過多空白
    .trim();

  output.textContent = cleanAnswer;
  $('ai-drawer-body').scrollTop = $('ai-drawer-body').scrollHeight;
  return answer;
}

function askDashboardAssistant(question, insightContext = null) {
  const value = String(question || '').trim();
  if (!value) return;
  toggleAiDrawer(true);
  $('ai-welcome').style.display = 'none';
  appendAssistantMessage('user', value);
  const typing = appendAssistantMessage('assistant typing', '正在連線 Gemini Data API…');
  askDashboardAssistantViaApi(value, typing).catch(error => {
    typing.classList.remove('typing');
    typing.style.color = '#ef4444';
    typing.textContent = `API 連線失敗：${error.message || error}`;
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

async function initializeDashboardApis() {
  setDashboardApiStatus('loading', '正在連線 Gemini Data API', '初始化正式資料來源…');
  const period = document.querySelector('select[onchange*="handlePeriodChange"]')?.value || 'latest';
  const [overviewResult, chatResult] = await Promise.allSettled([
    loadDashboardOverview(period),
    loadDashboardChatSession()
  ]);
  if (overviewResult.status === 'fulfilled') {
    if (chatResult.status === 'rejected') {
      console.warn('Dashboard assistant session unavailable:', chatResult.reason);
      // Chat session failed, so the sampled gap-scan (which needs it) will never
      // run — leave the card in a clear failure state instead of stuck "載入中…".
      setText('.kpi-reg strong', '—');
      setText('.kpi-reg small', 'AI 對話連線失敗，無法完成缺口抽樣分析');
    } else {
      loadRegulatoryGapScan();
    }
    return;
  }
  clearDashboardValues();
  setDashboardApiStatus('error', 'Dashboard 正式資料無法載入', overviewResult.reason?.message || String(overviewResult.reason));
}

// 「待完成法規缺口」是抽樣估算：隨機抽 10 筆案件交給 AI 逐筆判斷缺口，
// 不是全量案件的正式盤點；卡片與 insight popover 都必須誠實標示是抽樣。
async function loadRegulatoryGapScan() {
  setText('.kpi-reg strong', '分析中');
  setText('.kpi-reg small', '正在抽樣分析中…');
  try {
    const sampleResponse = await fetch('/api/dashboard/case-sample?count=10', {headers: {Accept: 'application/json'}});
    const sampleData = await sampleResponse.json();
    if (!sampleResponse.ok || sampleData.status !== 'ok' || !Array.isArray(sampleData.data) || !sampleData.data.length) {
      throw new Error(sampleData.message || '無法取得案件抽樣');
    }
    const prompt = PROMPT_TEMPLATES.regulatoryGapScan(sampleData.data);
    const result = await askDashboardJson(prompt, 'regulatory_gap_scan');
    if (result.status !== 'success' || !result.data) throw new Error('AI 回傳資料不足');
    const total = Number(result.data.total_gap_count);
    const sampleSize = result.data.sample_size || sampleData.data.length;
    setText('.kpi-reg strong', Number.isFinite(total) ? total : '—');
    setText('.kpi-reg small', `抽樣 ${sampleSize} 筆案件推估`);
    if (typeof INSIGHT_DEFINITIONS !== 'undefined') {
      const caseGaps = Array.isArray(result.data.cases) ? result.data.cases : [];
      INSIGHT_DEFINITIONS.regulatory = {
        kicker: 'REGULATORY GAP SCAN (SAMPLED)',
        title: '待完成法規缺口',
        metric: Number.isFinite(total) ? `${total} 項` : '—',
        cause: `隨機抽樣 ${sampleSize} 筆案件，由 AI 逐筆判斷缺少的證據或法規依據並加總；非全量案件盤點。`,
        evidence: caseGaps.slice(0, 3).map(c => `${c.case_id}：${(c.missing_evidence || []).join('、') || '無缺口'}`).join('｜') || '無明細',
        action: '需要更高信心時應擴大抽樣數或改為全量批次分析；目前數字僅供趨勢參考。',
      };
    }
  } catch (error) {
    setText('.kpi-reg strong', '—');
    setText('.kpi-reg small', '抽樣分析暫時無法完成');
    console.warn('待完成法規缺口抽樣分析失敗', error);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  clearDashboardValues();
  initInsightInteractions();
  initializeDashboardApis();
});
