// Vision Pitch Version of Risk Command Center
const $ = id => document.getElementById(id);

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
  
  // Mock progress sequence for the vision demo.
  setTimeout(() => { progressText.textContent = '彙整風險指標...'; }, 1000);
  setTimeout(() => { progressText.textContent = '核對來源與行動狀態...'; }, 2500);
  setTimeout(() => { progressText.textContent = '排版管理報告...'; }, 4000);
  
  setTimeout(() => {
    progressContainer.style.display = 'none';
    btn.style.display = 'flex';
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:middle;">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      下載報告 (.pdf)
    `;
    btn.style.background = 'var(--green)';
    btn.onclick = () => {
      toast('正在下載報告...');
    };
    toast('管理報告已準備完成（展示）');
  }, 5000);
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
  document.body.classList.toggle('ai-drawer-open', shouldOpen);
  drawer.setAttribute('aria-hidden', String(!shouldOpen));
  drawer.inert = !shouldOpen;
  if (shouldOpen) setTimeout(() => $('ai-question')?.focus(), 280);
  else $('ai-drawer-trigger')?.focus();
}

function getDashboardAnswer(question) {
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

function askDashboardAssistant(question) {
  const value = String(question || '').trim();
  if (!value) return;
  toggleAiDrawer(true);
  $('ai-welcome').style.display = 'none';
  appendAssistantMessage('user', value);
  const typing = appendAssistantMessage('assistant typing', '正在整理此頁資料…');
  setTimeout(() => {
    typing.classList.remove('typing');
    typing.textContent = getDashboardAnswer(value);
    $('ai-drawer-body').scrollTop = $('ai-drawer-body').scrollHeight;
  }, 550);
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
  if (event.key === 'Escape' && document.body.classList.contains('ai-drawer-open')) {
    toggleAiDrawer(false);
  } else if (event.key === 'Escape' && document.body.classList.contains('signal-drilldown-active')) {
    toggleSignalDrilldown(false);
  }
});
