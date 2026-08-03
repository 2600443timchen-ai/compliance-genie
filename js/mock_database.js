/* 
  Mock Database for Compliance Genie
  模擬後端資料庫與真實統計指標底座
*/

const AppDatabase = {
  cases: [
    {
      id: 'C001',
      applicant: '王○○（52歲）',
      receivedAt: '2026-07-20',
      category: 'investment',
      product: 'policy',
      segment: 'senior',
      channel: '分行',
      productVersion: 'V2024.1',
      riskLevel: 'high',
      outcome: 'upheld', // 成立 (upheld), 不成立 (rejected), 處理中 (pending)
      disputedAmount: 1500000,
      exposureCount: 12000, // 總曝險筆數或交易量
      status: '審查中',
      badgeClass: 'badge-review',
      type: '金融消費爭議 (投資型商品)',
      item: '理專涉嫌違反告知義務',
      regulations: ['金融消費者保護法第9條', '金融消費者保護法第10條'],
      violations: ['適合度評估不足', '風險揭露不全'],
      evidence: ['錄音檔#A01', 'KYC問卷#K12']
    },
    {
      id: 'C002',
      applicant: '林○○（35歲）',
      receivedAt: '2026-07-22',
      category: 'insurance',
      product: 'all', 
      segment: 'all',
      channel: '網銀',
      productVersion: 'V2025.2',
      riskLevel: 'medium',
      outcome: 'pending',
      disputedAmount: 300000,
      exposureCount: 85000,
      status: '進行中',
      badgeClass: 'badge-progress',
      type: '保險理賠爭議 (醫療險)',
      item: '精神科日間住院理賠爭議',
      regulations: ['保險法第54-1條'],
      violations: ['條款解釋疑義'],
      evidence: ['診斷證明書#M03']
    },
    {
      id: 'C003',
      applicant: '陳○○（45歲）',
      receivedAt: '2026-07-25',
      category: 'creditcard',
      product: 'all',
      segment: 'vip',
      channel: '客服',
      productVersion: 'V2024.3',
      riskLevel: 'low',
      outcome: 'rejected',
      disputedAmount: 15000,
      exposureCount: 200000,
      status: '已結案',
      badgeClass: 'badge-resolved',
      type: '信用卡交易爭議',
      item: '信用卡遭盜刷爭議',
      regulations: ['信用卡業務機構管理辦法'],
      violations: ['驗證機制瑕疵'],
      evidence: ['OTP發送紀錄']
    }
  ],

  getCaseById: function(id) {
    return this.cases.find(c => c.id === id);
  },

  getAllCases: function() {
    return this.cases;
  },

  queryCases: function(filters = {}) {
    return this.cases.filter(c => {
      let match = true;
      if (filters.category && filters.category !== 'all') {
        match = match && (c.category === filters.category);
      }
      if (filters.product && filters.product !== 'all') {
        match = match && (c.product === filters.product);
      }
      if (filters.segment && filters.segment !== 'all') {
        match = match && (c.segment === filters.segment);
      }
      return match;
    });
  },

  searchCases: function(query) {
    if (!query) return [];
    const q = query.toLowerCase().trim();
    return this.cases.filter(c => {
      const matchId = c.id && c.id.toLowerCase().includes(q);
      const matchApplicant = c.applicant && c.applicant.toLowerCase().includes(q);
      const matchType = c.type && c.type.toLowerCase().includes(q);
      const matchItem = c.item && c.item.toLowerCase().includes(q);
      const matchStatus = c.status && c.status.toLowerCase().includes(q);
      const matchRegs = Array.isArray(c.regulations) && c.regulations.some(r => r.toLowerCase().includes(q));
      const matchVios = Array.isArray(c.violations) && c.violations.some(v => v.toLowerCase().includes(q));
      const matchEvi = Array.isArray(c.evidence) && c.evidence.some(e => e.toLowerCase().includes(q));
      return matchId || matchApplicant || matchType || matchItem || matchStatus || matchRegs || matchVios || matchEvi;
    });
  }
};
