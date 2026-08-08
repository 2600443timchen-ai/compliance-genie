(function () {
  let currentDocument = null;

  const templates = {
    'official-reply': {
      title: '金融消費爭議官方回覆函', file: 'C001_官方回覆函', type: 'OFFICIAL RESPONSE',
      meta: [['受文者','林先生'],['案件編號','C001-2026'],['發文單位','客戶權益暨法遵處'],['發文日期','2026 年 8 月 4 日']],
      body: `<h2>主旨</h2><p>有關台端反映投資型保單銷售過程及風險說明之爭議，本公司已完成初步查核，謹回覆如下。</p><h2>查核說明</h2><ol><li>本公司已調閱商品說明文件、KYC 適合度評估及相關通聯紀錄。</li><li>目前發現部分風險說明與理解確認紀錄仍待補充核對，已交由權責單位進一步調查。</li><li>在調查完成前，本公司將保留台端之申訴權益，並於七個工作日內提供後續處理進度。</li></ol><div class="doc-highlight"><strong>本公司立場</strong><br>本公司重視金融消費者權益，將依公平待客原則與相關法令審慎處理；本函不影響雙方後續依法主張之權利。</div><h2>聯繫窗口</h2><p>客戶權益專線：（02）2345-6789　承辦人：林專員</p><div class="doc-signature">Compliance Genie 金融服務股份有限公司<br>客戶權益暨法遵處　敬啟</div>`
    },
    'internal-notice': {
      title: '內部調查通報暨資料調閱單', file: 'C001_內部調查通報', type: 'INTERNAL INVESTIGATION',
      meta: [['密等','內部限閱'],['案件編號','C001-2026'],['受文單位','財富管理處／相關分行'],['回覆期限','2026 年 8 月 6 日 17:00']],
      body: `<h2>調查目的</h2><p>釐清投資型保單銷售過程是否完整履行適合度評估、風險揭露及高齡客戶加強確認程序。</p><h2>請調閱資料</h2><table><tr><th>項目</th><th>負責單位</th><th>期限</th></tr><tr><td>KYC 原始表單與版本紀錄</td><td>相關分行</td><td>24 小時</td></tr><tr><td>銷售錄音、逐字稿及通聯索引</td><td>財富管理處</td><td>48 小時</td></tr><tr><td>主管覆核及例外核准紀錄</td><td>分行經理</td><td>48 小時</td></tr></table><h2>調查要求</h2><ol><li>不得修改或覆寫既有紀錄，並保留完整稽核軌跡。</li><li>如發現其他相同態樣案件，應一併列冊通報。</li><li>逾期或資料缺漏應立即向法遵稽核組說明。</li></ol><div class="doc-highlight"><strong>本通報為調查通知，非責任認定。</strong><br>案件結論須經法遵、業務權責單位及核決主管共同覆核。</div>`
    },
    'case-report': {
      title: '金融消費爭議案件分析報告', file: 'C001_案件分析報告', type: 'CASE ANALYSIS REPORT',
      meta: [['案件編號','C001-2026'],['風險等級','高'],['爭議金額','NT$ 1,500,000'],['報告版本','v1.0／待主管覆核']],
      body: `<h2>執行摘要</h2><p>本案涉及高齡客戶購買投資型保單之適合度與風險說明爭議。初步證據顯示 KYC 與錄音紀錄完整度不足，建議列為高風險案件優先處理。</p><h2>關鍵事實</h2><table><tr><th>構面</th><th>目前發現</th><th>證據狀態</th></tr><tr><td>適合度評估</td><td>客戶風險屬性與商品等級需重新比對</td><td>待補強</td></tr><tr><td>風險說明</td><td>錄音索引存在，關鍵段落待抽聽</td><td>調閱中</td></tr><tr><td>高齡程序</td><td>主管覆核紀錄未完整呈現</td><td>待確認</td></tr></table><h2>風險與建議</h2><ul><li>法遵風險：中高；可能涉及適合度及充分說明義務。</li><li>財務曝險：90–150 萬元區間，仍須依責任比例覆核。</li><li>建議：48 小時內完成證據保全，七日內召開跨部門案件會議。</li></ul>`
    },
    'management-report': {
      title: '全局風險管理報告', file: '2026_08_全局風險管理報告', type: 'EXECUTIVE RISK BRIEF',
      meta: [['報告期間','近 14 天'],['企業風險指數','78／100'],['高風險事件','12 件'],['報告狀態','管理階層預覽版']],
      body: `<h2>主管摘要</h2><p>本期主要風險訊號集中於投資型保單高齡客群，相關爭議由 31 件上升至 42 件，影響 8 個分行與 17 位理專。</p><div class="doc-highlight"><strong>潛在財務曝險：NT$ 680–1,020 萬</strong><br>若兩項治理措施如期完成，估計可避免曝險 NT$ 520–760 萬；信心 76%。</div><h2>重大風險與處置</h2><table><tr><th>風險</th><th>現況</th><th>建議決策</th></tr><tr><td>高齡客群銷售</td><td>42 件／+35%</td><td>提高 8 個異常分行覆核層級</td></tr><tr><td>SLA 逾期</td><td>27 件</td><td>3 件於 48 小時內介入</td></tr><tr><td>法規缺口</td><td>4 項</td><td>14 天內完成公平待客調整</td></tr></table><h2>待主管核准</h2><ol><li>啟動高齡客戶銷售第二層覆核。</li><li>建立通聯與 KYC 專案抽查工單。</li></ol>`
    },
    'approval-action': {
      title: '高齡客戶銷售覆核措施核准單', file: '高齡客戶銷售覆核_核准單', type: 'GOVERNANCE APPROVAL',
      meta: [['提案單位','財富管理處'],['核決時限','48 小時內'],['影響範圍','8 個分行／17 位理專'],['預期風險降低','高']],
      body: `<h2>提案目的</h2><p>針對投資型保單高齡客群風險升溫，於異常分行導入銷售前主管第二層覆核。</p><h2>執行範圍</h2><ul><li>限定 8 個異常分行，不直接全面停售。</li><li>適用 65 歲以上客戶及投資型保單。</li><li>覆核 KYC、商品適配、風險揭露及錄音完整性。</li></ul><h2>核准條件</h2><table><tr><th>條件</th><th>驗收證據</th></tr><tr><td>系統規則上線</td><td>測試紀錄與規則版本</td></tr><tr><td>主管覆核落實</td><td>簽核軌跡與例外清單</td></tr></table><div class="doc-signature">核准：＿＿＿＿　覆核：＿＿＿＿　日期：＿＿＿＿</div>`
    },
    'investigation-order': {
      title: '通聯與 KYC 專案抽查工單', file: '通聯_KYC_專案抽查工單', type: 'INVESTIGATION WORK ORDER',
      meta: [['負責單位','法遵稽核組'],['完成期限','7 天內'],['影響案件','42 件'],['優先層級','高']],
      body: `<h2>工作範圍</h2><p>抽查高風險理專近三個月之 KYC、銷售錄音與主管覆核紀錄，確認問題是否具系統性。</p><h2>抽查步驟</h2><ol><li>依風險分數選取樣本並封存原始證據。</li><li>比對 KYC 版本、商品適配結果與錄音關鍵段落。</li><li>彙整缺失態樣、影響範圍與改善責任人。</li></ol><h2>交付成果</h2><table><tr><th>成果</th><th>驗收標準</th></tr><tr><td>抽查底稿</td><td>每筆樣本具來源與判定依據</td></tr><tr><td>缺失清單</td><td>依嚴重度、部門與原因分類</td></tr><tr><td>改善方案</td><td>明列責任人、期限與追蹤指標</td></tr></table>`
    }
  };

  function ensureModal() {
    if (document.getElementById('document-preview-overlay')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="document-preview-overlay" id="document-preview-overlay" aria-hidden="true"><section class="document-preview-shell" role="dialog" aria-modal="true" aria-labelledby="document-preview-heading"><header class="document-preview-toolbar"><div class="document-preview-title"><span id="document-preview-type">DOCUMENT PREVIEW</span><strong id="document-preview-heading">文件預覽</strong></div><div class="document-preview-controls"><span class="document-format-badge">PDF</span><button class="document-save-button" id="document-save-button" type="button">儲存為 PDF</button><button class="document-preview-close" id="document-preview-close" type="button" aria-label="關閉文件預覽">×</button></div></header><div class="document-preview-main"><div class="document-loading" id="document-loading"><div><i></i><strong>正在整理案件資料</strong><span>核對欄位與排版文件…</span></div></div><div class="document-canvas"><article class="document-page" id="document-page"></article></div><aside class="document-sidebar"><h3>文件完成檢查</h3><div class="document-check"><i>✓</i><span>案件編號、日期與權責單位已帶入</span></div><div class="document-check"><i>✓</i><span>重要數字保留來源與覆核語句</span></div><div class="document-check"><i>✓</i><span>生成過程不顯示內部技術細節</span></div><div class="document-check"><i>✓</i><span>匯出前可先檢查完整文件內容</span></div><div class="document-export-note" id="document-export-note">PDF 將開啟系統列印視窗，請選擇「另存為 PDF」。</div></aside></div></section></div>`);
    document.getElementById('document-save-button').addEventListener('click', exportCurrentDocument);
    document.getElementById('document-preview-close').addEventListener('click', closeDocumentPreview);
    document.getElementById('document-preview-overlay').addEventListener('click', event => { if (event.target.id === 'document-preview-overlay') closeDocumentPreview(); });
  }

  function renderDocument(documentDefinition) {
    const meta = documentDefinition.meta.map(([label,value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
    return `<div class="doc-brand"><strong>Compliance Genie 合規精靈</strong><span>CONFIDENTIAL · MANAGEMENT REVIEW</span></div><h1>${documentDefinition.title}</h1><div class="doc-subtitle">本文件為展示預覽，正式發送或執行前須經權責主管覆核</div><div class="doc-meta">${meta}</div>${documentDefinition.body}`;
  }

  function escapeDocumentText(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }

  function renderGeneratedDocument(data) {
    const metadata = Array.isArray(data.metadata) ? data.metadata : [];
    const sections = Array.isArray(data.sections) ? data.sections : [];
    const metaHtml = metadata.map(item => `<div><span>${escapeDocumentText(item.label)}</span><strong>${escapeDocumentText(item.value ?? '待補')}</strong></div>`).join('');
    const sectionHtml = sections.map(section => {
      const paragraphs = (Array.isArray(section.paragraphs) ? section.paragraphs : []).map(text => `<p>${escapeDocumentText(text)}</p>`).join('');
      const items = (Array.isArray(section.items) ? section.items : []).map(text => `<li>${escapeDocumentText(text)}</li>`).join('');
      const table = section.table && Array.isArray(section.table.headers) && section.table.headers.length
        ? `<table><thead><tr>${section.table.headers.map(value => `<th>${escapeDocumentText(value)}</th>`).join('')}</tr></thead><tbody>${(section.table.rows || []).map(row => `<tr>${row.map(value => `<td>${escapeDocumentText(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
      return `<h2>${escapeDocumentText(section.title)}</h2>${paragraphs}${items ? `<ul>${items}</ul>` : ''}${table}`;
    }).join('');
    return `<div class="doc-brand"><strong>Compliance Genie 合規精靈</strong><span>CONFIDENTIAL · MANAGEMENT REVIEW</span></div><h1>${escapeDocumentText(data.title)}</h1><div class="doc-subtitle">${escapeDocumentText(data.review_notice || '正式發送或執行前須經權責主管覆核')}</div><div class="doc-meta">${metaHtml}</div>${sectionHtml}`;
  }

  async function openDocumentPreview(type) {
    ensureModal();
    const labels = {'official-reply':'官方回覆草稿','internal-notice':'內部調查通報','case-report':'案件分析報告','management-report':'全局風險管理報告','approval-action':'治理措施核准單','investigation-order':'專案抽查工單'};
    const title = labels[type] || labels['case-report'];
    document.getElementById('document-preview-type').textContent = 'AI JSON DOCUMENT';
    document.getElementById('document-preview-heading').textContent = title;
    document.getElementById('document-page').textContent = '';
    const overlay = document.getElementById('document-preview-overlay');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden','false');
    document.body.classList.add('document-preview-open');
    const loading = document.getElementById('document-loading');
    loading.style.display = 'grid';
    try {
      const caseContext = typeof currentMatchedCase !== 'undefined' ? currentMatchedCase : null;
      const dashboardContext = typeof dashboardPayload !== 'undefined' ? dashboardPayload : null;
      const context = caseContext || dashboardContext;
      if (!context) throw new Error('目前沒有已驗證的案件或 Dashboard 資料');
      const requester = typeof askWorkspaceJson === 'function' ? askWorkspaceJson : askDashboardJson;
      const payload = await requester(PROMPT_TEMPLATES.documentGeneration(type, context), 'document_generation');
      if (payload.status !== 'success') throw new Error(formatAiWarnings(payload.warnings) || '文件資料不足');
      currentDocument = {file:payload.data.file_name || title,generated:true};
      document.getElementById('document-page').innerHTML = renderGeneratedDocument(payload.data);
    } catch (error) {
      currentDocument = null;
      document.getElementById('document-page').textContent = `文件未產生：${error.message || error}。系統不會顯示固定範本或假資料。`;
    } finally {
      loading.style.display = 'none';
      document.getElementById('document-preview-close').focus();
    }
  }

  function closeDocumentPreview() {
    const overlay = document.getElementById('document-preview-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden','true');
    document.body.classList.remove('document-preview-open');
  }

  function exportCurrentDocument() {
    if (!currentDocument) return;
    window.print();
  }

  document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.getElementById('document-preview-overlay')?.classList.contains('open')) closeDocumentPreview(); });
  window.openDocumentPreview = openDocumentPreview;
  window.closeDocumentPreview = closeDocumentPreview;
})();
