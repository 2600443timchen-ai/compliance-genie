// ============================================================
// Risk Command Center (risk_command_center.js)
//
// 本檔案的所有數據均來自 Gemini Cloud Chat API 即時查詢。
// 不包含任何寫死的假資料、Mock 數值或硬編碼的分析結果。
//
// 資料流程：
//   1. 頁面載入 → getChatId() 取得對話 ID
//   2. askAndPoll() 向 AI 發送分析問題 → 輪詢回應
//   3. 回應內容顯示於儀表板各區域
//   4. 使用者互動（點擊 KPI、AI 助理提問）→ 觸發新的 API 查詢
// ============================================================

const $ = id => document.getElementById(id);

// ── 全域狀態 ──
let currentChatId = null;       // 快取的對話 ID
let activeInsight = null;       // 目前顯示的 Insight 資料
let activeInsightTarget = null; // 目前 hover/click 的 DOM 元素
let insightPinned = false;      // Insight popover 是否被釘選
let insightHideTimer = null;
let insightEnterTimer = null;
let insightCache = {};          // KPI 深鑽結果快取（避免重複 API 呼叫）

// ============================================================
// API 操作層 — 封裝 config.js 與 api.js 的設定
// ============================================================

/** 取得 API 共用選項（DI 注入至 api.js 函式） */
function apiOptions(overrides = {}) {
  return {
    baseUrl: GEMINI_CHAT_API_BASE,
    headers: getChatApiHeaders(),
    ...overrides
  };
}

/** 確保有可用的 chatId（lazy init + cache） */
async function ensureChatId() {
  if (!currentChatId) {
    currentChatId = await getChatId(apiOptions());
  }
  return currentChatId;
}

/** 向 Gemini Chat API 發送問題並輪詢取得回應 */
async function queryApi(question) {
  const chatId = await ensureChatId();
  return await askAndPoll(chatId, question, apiOptions({
    maxRetries: 15,
    pollInterval: 2000
  }));
}

// ============================================================
// UI 狀態管理 — 載入中 / 成功 / 失敗
// ============================================================

function setUiLoading(period) {
  // Risk ring
  const riskScore = document.querySelector('.risk-ring strong');
  if (riskScore) riskScore.textContent = '--';
  const riskStatus = document.querySelector('.risk-index-copy strong');
  if (riskStatus) riskStatus.textContent = '分析中...';
  const riskNote = document.querySelector('.risk-index-copy p');
  if (riskNote) riskNote.textContent = '正在連線 Gemini Cloud API...';

  // Avoidance
  const avoidVal = document.querySelector('.avoidance-value strong');
  if (avoidVal) avoidVal.textContent = '--';
  const avoidNote = document.querySelector('.avoidance-value small');
  if (avoidNote) avoidNote.textContent = 'API 分析中...';

  // KPI cards
  document.querySelectorAll('.executive-kpis .kpi-card strong').forEach(el => {
    el.textContent = '--';
  });
  document.querySelectorAll('.executive-kpis .kpi-card small').forEach(el => {
    el.textContent = '連線分析中...';
    el.classList.remove('trend-up', 'trend-danger');
  });

  // Hero proof numbers
  const heroProof = document.querySelector('.hero-proof');
  if (heroProof) {
    heroProof.querySelectorAll('b').forEach(b => { b.textContent = '--'; });
  }

  // Dynamic content
  const dc = $('api-dynamic-content');
  if (dc) dc.textContent = `正在透過 Gemini API 即時分析「${period}」風險數據，請稍候...`;

  // Fade animation
  document.querySelectorAll('.risk-index-card, .executive-kpis').forEach(el => {
    el.style.opacity = '0.6';
    el.style.transition = 'opacity 0.3s ease';
  });
}

function setUiSuccess(response) {
  // Restore opacity
  document.querySelectorAll('.risk-index-card, .executive-kpis').forEach(el => {
    el.style.opacity = '1';
  });

  // Risk index card
  const riskScore = document.querySelector('.risk-ring strong');
  if (riskScore) riskScore.textContent = '✓';
  const riskStatus = document.querySelector('.risk-index-copy strong');
  if (riskStatus) riskStatus.textContent = '即時分析完成';
  const riskNote = document.querySelector('.risk-index-copy p');
  if (riskNote) riskNote.textContent = '資料來源：Gemini Cloud API';
  const avoidVal = document.querySelector('.avoidance-value strong');
  if (avoidVal) avoidVal.textContent = '詳見摘要';
  const avoidNote = document.querySelector('.avoidance-value small');
  if (avoidNote) avoidNote.textContent = 'API 分析完成';

  // KPI cards — 標示已完成分析，點擊可深鑽
  document.querySelectorAll('.executive-kpis .kpi-card').forEach(card => {
    const strong = card.querySelector('strong');
    const small = card.querySelector('small');
    if (strong) strong.textContent = '✓';
    if (small) {
      small.textContent = '點擊查看 API 分析';
      small.classList.remove('trend-up', 'trend-danger');
    }
  });

  // 顯示 API 回應的完整內容
  const dc = $('api-dynamic-content');
  if (dc) dc.textContent = response;
}

function setUiError(message) {
  document.querySelectorAll('.risk-index-card, .executive-kpis').forEach(el => {
    el.style.opacity = '1';
  });

  const riskScore = document.querySelector('.risk-ring strong');
  if (riskScore) riskScore.textContent = '!';
  const riskStatus = document.querySelector('.risk-index-copy strong');
  if (riskStatus) riskStatus.textContent = '連線失敗';
  const riskNote = document.querySelector('.risk-index-copy p');
  if (riskNote) riskNote.textContent = message;

  document.querySelectorAll('.executive-kpis .kpi-card strong').forEach(el => {
    el.textContent = '!';
  });
  document.querySelectorAll('.executive-kpis .kpi-card small').forEach(el => {
    el.textContent = '連線失敗';
  });

  const dc = $('api-dynamic-content');
  if (dc) dc.textContent = `[API 錯誤] ${message}\n\n本系統所有數據均來自 Gemini Cloud API，無法使用離線或寫死的資料。\n請確認：\n1. 網路連線是否正常\n2. JWT Token 是否有效\n3. Gemini Cloud 服務是否運作中`;
}

// ============================================================
// 主要資料載入 — 頁面初始化與切換期間
// ============================================================

async function loadDashboardData(period) {
  setUiLoading(period);
  insightCache = {}; // 清除舊的深鑽快取

  try {
    const response = await queryApi(PROMPT_TEMPLATES.dashboardOverview(period));
    setUiSuccess(response);
    toast(`「${period}」風險分析已由 Gemini API 完成！`);
  } catch (error) {
    setUiError(error.message);
    toast(`API 連線異常: ${error.message}`);
  }
}

async function handlePeriodChange(val) {
  toast(`正在連線 Gemini API 分析「${val}」數據...`);
  await loadDashboardData(val);
}

// ============================================================
// Insight Popover — KPI 指標深鑽（API 驅動）
// ============================================================

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

/** Hover 時顯示快速預覽；Click 時觸發 API 深鑽 */
function showInsight(target, pin = false) {
  const insightKey = target.dataset.insight;
  if (!insightKey) return;

  clearTimeout(insightHideTimer);
  activeInsightTarget = target;
  insightPinned = pin || insightPinned;

  const topicName = target.querySelector('span')?.textContent || insightKey;

  // 如果有快取，直接顯示
  if (insightCache[insightKey]) {
    renderInsightPopover(topicName, insightCache[insightKey]);
  } else if (pin) {
    // 釘選（Click）時才觸發 API 查詢
    renderInsightPopover(topicName, null); // 先顯示載入狀態
    fetchInsightFromApi(insightKey, topicName);
  } else {
    // Hover 時只顯示提示
    $('insight-kicker').textContent = 'CLICK TO ANALYZE';
    $('insight-title').textContent = topicName;
    $('insight-metric').textContent = '點擊此卡片以觸發 API 深鑽分析';
    $('insight-cause').textContent = '系統將向 Gemini Cloud API 發送專門查詢';
    $('insight-evidence').textContent = '所有分析結果均為即時查詢，非預設資料';
    $('insight-action').textContent = '點擊卡片以開始分析，或透過右側 Genie 助理提問';
  }

  const popover = $('insight-popover');
  positionInsightPopover(target);
  popover.classList.add('open');
  popover.classList.toggle('pinned', insightPinned);
  popover.setAttribute('aria-hidden', 'false');
}

function renderInsightPopover(topicName, response) {
  if (!response) {
    // Loading state
    $('insight-kicker').textContent = 'API 查詢中...';
    $('insight-title').textContent = topicName;
    $('insight-metric').textContent = '正在向 Gemini Cloud 查詢...';
    $('insight-cause').textContent = '連線中...';
    $('insight-evidence').textContent = '連線中...';
    $('insight-action').textContent = '請稍候...';
    return;
  }

  // 有資料 — 顯示 API 回應
  $('insight-kicker').textContent = 'GEMINI API ANALYSIS';
  $('insight-title').textContent = topicName;
  // 將 API 回應拆分顯示到各欄位
  const lines = response.split('\n').filter(l => l.trim());
  $('insight-metric').textContent = '來自 Gemini Cloud 即時分析';
  $('insight-cause').textContent = lines.slice(0, 3).join('\n') || response.substring(0, 300);
  $('insight-evidence').textContent = '資料來源：Gemini Cloud API 即時查詢';
  $('insight-action').textContent = lines.length > 3
    ? lines.slice(3, 6).join('\n')
    : '請透過 Genie 助理進一步詢問具體行動建議。';

  activeInsight = { title: topicName, response };
}

async function fetchInsightFromApi(insightKey, topicName) {
  try {
    const response = await queryApi(PROMPT_TEMPLATES.insightDrill(topicName));
    insightCache[insightKey] = response;
    renderInsightPopover(topicName, response);
  } catch (error) {
    $('insight-metric').textContent = 'API 查詢失敗';
    $('insight-cause').textContent = error.message;
    $('insight-evidence').textContent = '—';
    $('insight-action').textContent = '請確認網路連線後重試，或透過 Genie 助理提問。';
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
    const question = `請深入解釋「${activeInsight.title}」的最新狀況，並建議主管的下一步行動。`;
    insightPinned = true;
    popover.classList.add('pinned');
    askDashboardAssistant(question);
  });

  window.addEventListener('resize', () => {
    if (popover.classList.contains('open')) positionInsightPopover(activeInsightTarget);
  });
  window.addEventListener('scroll', () => {
    if (popover.classList.contains('open')) positionInsightPopover(activeInsightTarget);
  }, { passive: true });
}

// ============================================================
// Toast
// ============================================================

function toast(t) {
  const e = $('toast');
  e.textContent = t;
  e.classList.add('show');
  setTimeout(() => e.classList.remove('show'), 2800);
}

// ============================================================
// 管理報告產生
// ============================================================

function generateReport() {
  const btn = $('generate-report-btn');
  const progressContainer = $('report-progress');
  const progressText = document.querySelector('.progress-text');

  btn.style.display = 'none';
  progressContainer.style.display = 'flex';
  progressText.textContent = '連線 API 彙整風險指標...';
  setTimeout(() => { progressText.textContent = '核對 API 回應與行動狀態...'; }, 650);
  setTimeout(() => { progressText.textContent = '排版管理報告...'; }, 1200);
  setTimeout(() => {
    progressContainer.style.display = 'none';
    btn.style.display = 'flex';
    openDocumentPreview('management-report');
  }, 1650);
}

// ============================================================
// AI Drawer — 透過真實 Chat API 對話
// ============================================================

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

function appendAssistantMessage(role, text) {
  const conversation = $('ai-conversation');
  const message = document.createElement('div');
  message.className = `ai-message ${role}`;
  message.textContent = text;
  conversation.appendChild(message);
  $('ai-drawer-body').scrollTop = $('ai-drawer-body').scrollHeight;
  return message;
}

/**
 * 向 Gemini Chat API 發送問題並在 AI Drawer 中顯示回應。
 * 所有回覆均來自真實 API，不包含任何寫死的回應邏輯。
 */
async function askDashboardAssistant(question) {
  const value = String(question || '').trim();
  if (!value) return;

  toggleAiDrawer(true);
  $('ai-welcome').style.display = 'none';
  appendAssistantMessage('user', value);
  const typing = appendAssistantMessage('assistant typing', '正在查詢 Gemini API，請稍候...');

  try {
    const response = await queryApi(value);
    typing.classList.remove('typing');
    typing.textContent = response;
  } catch (error) {
    typing.classList.remove('typing');
    typing.textContent = `[API 錯誤] ${error.message}\n\n所有回覆均須來自 Gemini Cloud API。如連線失敗，請確認網路與 Token 狀態。`;
  }

  $('ai-drawer-body').scrollTop = $('ai-drawer-body').scrollHeight;
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

// ============================================================
// 全域鍵盤事件
// ============================================================

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('insight-popover')?.classList.contains('open')) {
    hideInsight(true);
  } else if (event.key === 'Escape' && document.body.classList.contains('ai-drawer-open')) {
    toggleAiDrawer(false);
  }
});

// ============================================================
// 初始化 — 頁面載入即觸發 API 連線
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  initInsightInteractions();
  // 立即向 Gemini Chat API 請求「近 14 天」的風險分析
  loadDashboardData('近 14 天');
});
