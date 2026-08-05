// Vision Pitch Version of Risk Command Center
const $ = id => document.getElementById(id);

const benchmarkState = {mode: 'snapshot', source: null, item: null};
let activeInsight = null;
let activeInsightTarget = null;
let insightPinned = false;
let insightHideTimer = null;
let dashboardChatId = null;
let dashboardChatTitle = '';

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

const INSIGHT_DEFINITIONS = {
  events: {kicker:'RISK SIGNAL', title:'新增高風險事件', metric:'12 件 · 較前 14 天 +35%', cause:'投資型保單爭議集中於高齡客群，且適合度評估與風險說明紀錄同時缺漏，使事件被提升為高風險。', evidence:'31 → 42 件；65 歲以上占 82%；8 個分行、17 位理專受影響。', action:'48 小時內先提高 8 個異常分行的主管覆核層級，再抽查 KYC 與通聯紀錄。'},
  exposure: {kicker:'FINANCIAL EXPOSURE', title:'潛在財務曝險', metric:'NT$ 680–1,020 萬', cause:'27 件高風險案件依爭議金額、責任比例與可能裁罰情境形成區間估算，不代表確定罰鍰。', evidence:'其中 3 件 SIGNAL 01 關聯案件曝險約 155–265 萬；整體估算信心 76%。', action:'優先核對金額最高且期限最近的案件，再由法遵覆核責任比例與裁罰依據。'},
  sla: {kicker:'SERVICE LEVEL', title:'SLA 逾期風險', metric:'27 件 · 3 件須於 48 小時內介入', cause:'信用卡部平均處理時間拉長至 28 天，加上高風險案件文件補正反覆，形成期限壓力。', evidence:'信用卡部達標率 64%；財富管理處 95%；3 件關聯案件剩餘 2、4、7 天。', action:'今日指定案件負責人與升級門檻，先處理剩餘 2 天的 C001-INV。'},
  regulatory: {kicker:'REGULATORY GAP', title:'待完成法規缺口', metric:'4 項 · 最近期限 14 天', cause:'公平待客與高齡客戶錄音覆核流程尚未完成內控文件、系統規則與教育訓練同步。', evidence:'公平待客作業調整完成度 68%；實質受益人機制完成度 92%。', action:'本週核准流程責任人及驗收證據，避免只完成制度文件而未落實系統控制。'},
  signal: {kicker:'SIGNAL 01', title:'投資型保單 × 高齡客群', metric:'42 件 · 近 14 天 +35%', cause:'風險並非只由件數上升造成，而是高齡集中度、KYC 缺漏與錄音證據不足同時出現。', evidence:'65 歲以上占 82%；8 個分行；17 位理專；判定信心 82%。', action:'先針對異常分行提高銷售覆核層級，不直接全面停售；7 天內完成專案抽查。'},
  benchmark: {kicker:'EXTERNAL BENCHMARK', title:'人壽保險業外部基準', metric:'載入中', cause:'外部統計用來確認招攬類爭議是否具產業普遍性，但不能直接證明本公司案件成因。', evidence:'Gemini Data 正式 Source API／已驗證快照。', action:'將外部占比與本公司同口徑指標比較；確認顯著偏離後再決定是否擴大抽查。'},
  'wealth-sla': {kicker:'DEPARTMENT SLA', title:'財富管理處', metric:'142 件 · 12 天 · 95%', cause:'整體達標率良好，但 SIGNAL 01 集中於此部門，使少數高風險案件需要額外覆核。', evidence:'8 個異常分行、17 位理專；3 件高風險關聯案件。', action:'維持既有 SLA，同時為高齡與投資型保單案件加上第二層覆核。'},
  'consumer-sla': {kicker:'DEPARTMENT SLA', title:'消費金融處', metric:'89 件 · 18 天 · 82%', cause:'文件補正與跨單位確認拉長處理時間，但尚未進入立即介入門檻。', evidence:'達標率比財富管理處低 13 個百分點。', action:'檢查補正次數最高的案件類型，設定一次性補件清單。'},
  'card-sla': {kicker:'DEPARTMENT SLA', title:'信用卡部', metric:'215 件 · 28 天 · 64%', cause:'案件量最高，且消費款與催收爭議需要跨系統調閱，造成平均處理時間上升。', evidence:'達標率為三部門最低；另有 C142-CRD 僅剩 3 天。', action:'今日建立紅色案件清單並安排每日主管覆核，先排除可快速補證的案件。'},
  'case-c001': {kicker:'CASE DRILL', title:'C001-INV · 適合度評估', metric:'剩 2 天 · 曝險 90–150 萬', cause:'KYC 風險屬性與商品風險等級的對應證據不足，且客戶屬高齡族群。', evidence:'SIGNAL 01 主要案件；負責人林專員。', action:'24 小時內補齊 KYC、銷售錄音與主管覆核紀錄，逾時即升級法遵主管。'},
  'case-c077': {kicker:'CASE DRILL', title:'C077-INV · 高齡客群揭露', metric:'剩 4 天 · 曝險 40–70 萬', cause:'高齡客戶的風險揭露與理解確認紀錄不足。', evidence:'SIGNAL 01 關聯案件；負責人李襄理。', action:'補做錄音逐字稿抽查，確認關鍵風險是否以可理解方式說明。'},
  'case-c104': {kicker:'CASE DRILL', title:'C104-INV · KYC 文件缺漏', metric:'剩 7 天 · 曝險 25–45 萬', cause:'關鍵 KYC 欄位或版本留存不完整，無法還原銷售當時判斷。', evidence:'SIGNAL 01 關聯案件；負責人王專員。', action:'比對 CRM、紙本掃描與簽核紀錄，確認是資料遺失或流程未執行。'},
  'case-c142': {kicker:'CASE DRILL', title:'C142-CRD · 不當催收', metric:'剩 3 天 · 曝險 45–75 萬', cause:'催收通聯內容與聯繫時段需要人工覆核，且案件已接近處理期限。', evidence:'信用卡部案件；負責人陳副理。', action:'立即封存通聯證據並由法遵抽聽，確認是否觸及不當催收紅線。'},
  'case-c088': {kicker:'CASE DRILL', title:'C088-INS · 風險說明', metric:'剩 5 天 · 曝險 20–40 萬', cause:'商品風險說明與客戶理解確認的證據完整度不足。', evidence:'保險爭議案件；負責人張專員。', action:'先核對要保文件與錄音時間軸，再決定是否需要客戶補充訪談。'}
};

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
  const sourceLabel = benchmarkState.mode === 'live' ? 'Gemini Data API 即時' : '已驗證快照';
  $('benchmark-value').textContent = `業務招攬爭議 ${item.total} 件 · 占 ${item.ratio} (${sourceLabel})`;
  INSIGHT_DEFINITIONS.benchmark.metric = `${item.total} 件 · 占 ${item.ratio}`;
  INSIGHT_DEFINITIONS.benchmark.evidence = `${item.complaints} 件申訴 + ${item.mediation} 件評議；${formatSourceDate(source.start)}–${formatSourceDate(source.end)}；Source ${source.id}；${benchmarkState.mode === 'live' ? '正式 API 即時取得' : '已驗證快照'}。`;
  return {mode: benchmarkState.mode, source};
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
  const response = await fetch(`/api/chat/${encodeURIComponent(dashboardChatId)}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({q: question, streaming: true})
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
  output.textContent = answer;
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
  setDashboardApiStatus('loading', '正在連線 Gemini Data API', '初始化聊天室與正式資料來源…');
  const [chatResult, sourceResult] = await Promise.allSettled([
    loadDashboardChatSession(),
    loadExternalBenchmark()
  ]);
  const chatReady = chatResult.status === 'fulfilled';
  const sourceReady = sourceResult.status === 'fulfilled' && sourceResult.value?.mode === 'live';
  const time = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date());
  if (chatReady && sourceReady) {
    setDashboardApiStatus('ready', 'Gemini Data API 已連線', `${time} · ${dashboardChatTitle || 'Chat'} · 正式資料`);
    return;
  }
  const errors = [chatResult, sourceResult]
    .filter(result => result.status === 'rejected')
    .map(result => result.reason?.message || String(result.reason));
  setDashboardApiStatus('error', 'Gemini Data API 部分功能無法載入', errors.join('；') || '正式資料來源未通過驗證');
}

document.addEventListener('DOMContentLoaded', () => {
  initInsightInteractions();
  initializeDashboardApis();
});
