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
  
  // Fake progress sequence for Demo
  setTimeout(() => { progressText.textContent = '分析全局曝險數據...'; }, 1000);
  setTimeout(() => { progressText.textContent = '草擬跨部門行動建議...'; }, 2500);
  setTimeout(() => { progressText.textContent = '排版董事會專用格式...'; }, 4000);
  
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
    btn.classList.remove('pulse-btn');
    btn.style.background = 'var(--green)';
    btn.onclick = () => {
      toast('正在下載報告...');
    };
    toast('✅ 報告生成完畢！');
  }, 5000);
}
