/* Workspace Analytical Dashboard Interactivity and API integration
   結合 Gemini Enterprise API 實現批次案件分析
   FR-08: 敘事性洞察引擎
   FR-09: 跨維度交叉分析儀表板
   FR-10: 知識探索圖譜
*/

let activeChatId = null;

// ============================================================
// 1. 取得 Chat ID（與 workspace.js 一致）
// ============================================================
async function getChatId() {
  if (activeChatId) return activeChatId; 
  try {
    const response = await fetch(`${GEMINI_API_BASE}/assistant/chat/list`, {
      headers: getApiHeaders()
    });
    const data = await response.json();
    if (data.data && data.data.length > 0) {
      activeChatId = data.data[0]._id; 
      return activeChatId;
    }
    return null;
  } catch (e) {
    console.error("取得 Chat ID 失敗", e);
    return null;
  }
}

// ============================================================
// 2. 觸發批次分析（載入分析按鈕）
// ============================================================
async function loadBatchAnalysis() {
    const category = document.getElementById('filter-category').value || 'all';
    const product = document.getElementById('filter-product').value || 'all';
    const segment = document.getElementById('filter-segment').value || 'all';

    const promptText = `請針對目前選定的條件（爭議類別: ${category}, 商品: ${product}, 客戶分群: ${segment}）分析最新批次案件。請提供敘事洞察摘要、風險交叉分析數據、以及法規知識圖譜關聯。請盡可能回傳 JSON 格式，結構包含: {"narrative": "...", "matrix": [{"product": "...", "law": "...", "highRisk": 10, "medRisk": 5, "lowRisk": 2}], "lawGraph": [{"law": "...", "obligations": [], "consequences": [], "cases": []}], "riskData": {"level": "...", "violations": [], "cases": []}, "metrics": {"avgLaw": "3.1", "highRiskProduct": "...", "avgAmount": "NT$ ..."}}`;

    console.log("送出分析條件:", promptText);
    setLoadingState(true);

    try {
        const chatID = await getChatId();
        if (!chatID) throw new Error("無有效的 Chat ID");

        // 呼叫 Chat API（與 workspace.js 完全一致的 streaming 模式）
        const response = await fetch(`${GEMINI_API_BASE}/assistant/chat/${chatID}`, {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ q: promptText, streaming: true })
        });

        if (!response.ok) throw new Error(`API 錯誤: ${response.status}`);

        // === SSE 串流解析 ===
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
                    } catch { /* 忽略零碎片段 */ }
                }
            }
        }

        // 嘗試解析 AI 回傳的結構化 JSON
        const aiData = tryParseAiJson(latestResult);
        const mockBase = getMockData(category, product, segment);

        if (aiData) {
            // 用 AI 真實數據覆蓋各模組
            if (aiData.narrative) mockBase.narrative = aiData.narrative;
            if (aiData.lawGraph) mockBase.lawGraph = aiData.lawGraph;
            if (aiData.riskData) mockBase.riskData = aiData.riskData;
            if (aiData.matrix) mockBase.matrix = aiData.matrix;
            if (aiData.metrics) mockBase.metrics = aiData.metrics;
            console.log("✅ AI 結構化數據已解析成功，使用真實 AI 分析結果");
        } else if (latestResult) {
            // AI 回傳了文字但不是 JSON → 當作 narrative
            mockBase.narrative = latestResult;
            console.log("✅ AI 回傳純文字，作為敘事洞察使用");
        }

        renderDashboard(mockBase);

    } catch (err) {
        console.error("API 呼叫失敗，啟用本地 Mock 數據:", err);
        setTimeout(() => {
            renderDashboard(getMockData(category, product, segment));
        }, 1200);
    }
}

// ============================================================
// 3. 解析 AI 回傳的 JSON（支援多種格式）
// ============================================================
function tryParseAiJson(text) {
    if (!text) return null;

    // 嘗試直接解析
    let obj = null;
    try {
        obj = JSON.parse(text);
    } catch {
        // 嘗試提取 ```json ... ``` 內的 JSON
        const match = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (match) {
            try { obj = JSON.parse(match[1]); } catch { /* skip */ }
        }
        // 嘗試找第一個 { 到最後一個 }
        if (!obj) {
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start !== -1 && end > start) {
                try { obj = JSON.parse(text.substring(start, end + 1)); } catch { /* skip */ }
            }
        }
    }

    if (!obj || typeof obj !== 'object') return null;

    // 統一對應欄位（AI 可能用中文或英文 key）
    const result = {};

    // Narrative (FR-08)
    result.narrative = obj['敘事洞察摘要'] || obj.narrative || obj.summary || null;

    // Law Graph (FR-10)
    const rawGraph = obj['法規知識圖譜關聯'] || obj.lawGraph || obj.knowledge_graph || null;
    if (Array.isArray(rawGraph)) {
        result.lawGraph = rawGraph.map(item => ({
            law: item['法條'] || item.law || '',
            obligations: item['重點義務'] || item.obligations || [],
            consequences: item['違規後果'] || item.consequences || [],
            cases: item['相關案例'] || item.cases || []
        })).filter(item => item.law); // 過濾沒有法條的項目
    }

    // Risk Data (FR-09)
    const rawRisk = obj['風險交叉分析數據'] || obj.riskData || null;
    if (rawRisk) {
        result.riskData = {
            level: rawRisk['合規風險等級'] || rawRisk.level || '中',
            violations: rawRisk['常見違規態樣'] || rawRisk.violations || [],
            cases: rawRisk['賠償責任參考比例'] || rawRisk.cases || []
        };
    }

    // Matrix (FR-09)
    const rawMatrix = obj['交叉分析矩陣'] || obj.matrix || null;
    if (Array.isArray(rawMatrix)) {
        result.matrix = rawMatrix.map(item => ({
            product: item['商品'] || item.product || '',
            law: item['法條'] || item.law || '',
            highRisk: item['高風險'] || item.highRisk || 0,
            medRisk: item['中風險'] || item.medRisk || 0,
            lowRisk: item['低風險'] || item.lowRisk || 0
        }));
    }

    // Metrics (FR-09)
    const rawMetrics = obj['風險指標'] || obj.metrics || null;
    if (rawMetrics) {
        result.metrics = {
            avgLaw: rawMetrics['平均引用法條數'] || rawMetrics.avgLaw || '',
            highRiskProduct: rawMetrics['最高風險商品'] || rawMetrics.highRiskProduct || '',
            avgAmount: rawMetrics['平均爭議金額'] || rawMetrics.avgAmount || ''
        };
    }

    return result;
}

// ============================================================
// 4. 快速篩選按鈕 (與 C-20231015-001 / C-20231102-005 範例案件對齊)
// ============================================================
function applyQuickFilter(preset) {
    if (preset === 'case_invest') {
        document.getElementById('filter-category').value = 'investment';
        document.getElementById('filter-product').value = 'policy';
        document.getElementById('filter-segment').value = 'senior';
    } else if (preset === 'case_insurance') {
        document.getElementById('filter-category').value = 'insurance';
        document.getElementById('filter-product').value = 'all';
        document.getElementById('filter-segment').value = 'all';
    }
    loadBatchAnalysis();
}

// ============================================================
// 5. UI 狀態控制
// ============================================================
function setLoadingState(isLoading) {
    const btn = document.getElementById('load-analysis-btn');
    const container = document.getElementById('dashboard-main-content');
    if (isLoading) {
        btn.innerHTML = '<span>分析中...</span>';
        btn.style.opacity = '0.7';
        btn.style.pointerEvents = 'none';
        container.style.opacity = '0.5';
        container.style.pointerEvents = 'none';
    } else {
        btn.innerHTML = '<span>載入分析</span>';
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        container.style.opacity = '1';
        container.style.pointerEvents = 'auto';
    }
}

// ============================================================
// 6. 核心渲染函數
// ============================================================
function renderDashboard(data) {
    setLoadingState(false);
    
    // FR-08: Narrative Insight
    renderNarrative(data);

    // FR-09: Cross Analysis Matrix
    renderMatrix(data);

    // FR-10: Knowledge Graph
    renderKnowledgeGraph(data);

    // Case Intelligence Metrics
    renderMetrics(data);
}

// --- FR-08: 敘事洞察（支援 Markdown → Rich Text）---
function renderNarrative(data) {
    const el = document.getElementById('narrative-insight-text');
    if (!el || !data.narrative) return;
    let text = data.narrative;
    
    // 如果載入了 marked.js，使用它渲染完整 Markdown
    if (typeof marked !== 'undefined') {
        el.innerHTML = marked.parse(text);
    } else {
        // Fallback: 基本的 bold → highlight + 換行處理
        text = text.replace(/\*\*(.*?)\*\*/g, '<highlight>$1</highlight>');
        text = text.replace(/\n/g, '<br>');
        el.innerHTML = text;
    }
}

// --- FR-09: 交叉分析矩陣 ---
function renderMatrix(data) {
    const matrixBody = document.getElementById('matrix-tbody');
    if (!matrixBody) return;
    matrixBody.innerHTML = '';

    if (data.matrix) {
        data.matrix.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding: 8px 6px; border-bottom: 1px solid #f1f5f9; text-align: left;">
                    ${row.product}<br><span style="font-size:0.7rem;color:#94a3b8">涉: ${row.law}</span>
                </td>
                <td style="background: rgba(239,68,68,${row.highRisk > 50 ? '0.3' : '0.1'}); color: #991b1b; padding: 8px 6px; font-weight: ${row.highRisk > 50 ? 'bold' : 'normal'};">${row.highRisk} 件</td>
                <td style="background: rgba(245,158,11,0.1); padding: 8px 6px;">${row.medRisk} 件</td>
                <td style="color: #64748b; padding: 8px 6px;">${row.lowRisk} 件</td>
            `;
            matrixBody.appendChild(tr);
        });
    }

    // 如果 AI 有回傳 riskData，額外渲染違規態樣
    if (data.riskData && data.riskData.violations && data.riskData.violations.length > 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td colspan="4" style="padding: 10px 6px; border-top: 2px solid #e2e8f0; text-align: left; font-size: 0.8rem;">
                <strong style="color: var(--accent-gold-dark);">⚠ 常見違規態樣：</strong>
                ${data.riskData.violations.map(v => `<span style="display:inline-block; background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:10px; font-size:0.75rem; margin:2px 3px;">${v}</span>`).join('')}
            </td>
        `;
        matrixBody.appendChild(tr);
    }
}

// --- FR-10: 知識探索圖譜（全新動態渲染）---
function renderKnowledgeGraph(data) {
    const container = document.getElementById('knowledge-graph');
    if (!container) return;
    container.innerHTML = ''; // 清空

    const graphData = data.lawGraph || [];

    if (graphData.length === 0) {
        // 沒有 AI 數據時，用 mock fallback
        renderFallbackGraph(container, data);
        return;
    }

    // 收集所有節點與連線
    const nodes = [];
    const edges = [];

    // 計算佈局：法條放中間列，義務放左側，後果放右側
    const containerW = container.offsetWidth || 500;
    const containerH = container.offsetHeight || 280;
    const PAD = 10; // 邊距安全區
    const NODE_H = 24; // 節點大約高度
    const NODE_W_EST = 110; // 節點大約寬度

    // 限制座標不超出容器
    function clampX(x) { return Math.max(PAD, Math.min(x, containerW - NODE_W_EST - PAD)); }
    function clampY(y) { return Math.max(PAD, Math.min(y, containerH - NODE_H - PAD)); }

    // 計算每個法條的垂直均勻分佈
    const lawCount = graphData.filter(item => item.law).length;
    const lawSpacing = (containerH - 60) / Math.max(lawCount - 1, 1);

    graphData.forEach((lawItem, lawIdx) => {
        if (!lawItem.law) return;

        // 簡化法條名稱
        const shortLaw = lawItem.law.replace(/（.*）/, '').trim();
        const shortLaw2 = shortLaw.length > 16 ? shortLaw.substring(0, 16) + '…' : shortLaw;
        const lawY = clampY(30 + (lawIdx * lawSpacing));
        const lawX = clampX(containerW * 0.32);

        const lawNodeId = `law-${lawIdx}`;
        nodes.push({
            id: lawNodeId,
            label: `⚖️ ${shortLaw2}`,
            x: lawX, y: lawY,
            type: 'law'
        });

        // 義務節點（放左側，上下錯開）
        const obMax = Math.min((lawItem.obligations || []).length, 3); // 最多顯示3個
        for (let obIdx = 0; obIdx < obMax; obIdx++) {
            const ob = lawItem.obligations[obIdx];
            const shortOb = ob.length > 10 ? ob.substring(0, 10) + '…' : ob;
            const obY = clampY(lawY - 15 + (obIdx * 30));
            const obX = clampX(containerW * 0.03 + (obIdx % 2) * 20);
            const obId = `ob-${lawIdx}-${obIdx}`;
            nodes.push({ id: obId, label: `📋 ${shortOb}`, x: obX, y: obY, type: 'obligation' });
            edges.push({ from: obId, to: lawNodeId });
        }

        // 後果節點（放右側）
        const coMax = Math.min((lawItem.consequences || []).length, 2); // 最多顯示2個
        for (let coIdx = 0; coIdx < coMax; coIdx++) {
            const co = lawItem.consequences[coIdx];
            const shortCo = co.length > 10 ? co.substring(0, 10) + '…' : co;
            const coY = clampY(lawY - 8 + (coIdx * 30));
            const coX = clampX(containerW * 0.65 + (coIdx % 2) * 18);
            const coId = `co-${lawIdx}-${coIdx}`;
            nodes.push({ id: coId, label: `🚨 ${shortCo}`, x: coX, y: coY, type: 'consequence' });
            edges.push({ from: lawNodeId, to: coId });
        }

        // 案例節點（放最右側）
        (lawItem.cases || []).slice(0, 1).forEach((cs, csIdx) => {
            if (typeof cs === 'object') {
                const caseLabel = cs['編號'] || cs.id || `案例${csIdx + 1}`;
                const csY = clampY(lawY);
                const csX = clampX(containerW * 0.82);
                const csId = `cs-${lawIdx}-${csIdx}`;
                nodes.push({ id: csId, label: `📁 ${caseLabel}`, x: csX, y: csY, type: 'case' });
                edges.push({ from: lawNodeId, to: csId });
            }
        });
    });

    // 建立 nodeMap 用於連線查詢
    const nodeMap = {};
    nodes.forEach(n => { nodeMap[n.id] = n; });

    // 繪製 SVG 連線
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'graph-lines');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');

    edges.forEach(edge => {
        const fromNode = nodeMap[edge.from];
        const toNode = nodeMap[edge.to];
        if (!fromNode || !toNode) return;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', fromNode.x + 40);
        line.setAttribute('y1', fromNode.y + 12);
        line.setAttribute('x2', toNode.x + 40);
        line.setAttribute('y2', toNode.y + 12);
        line.setAttribute('stroke', 'rgba(30, 58, 138, 0.15)');
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('stroke-dasharray', '4,3');
        svg.appendChild(line);

        // 箭頭小圓點
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', toNode.x + 40);
        circle.setAttribute('cy', toNode.y + 12);
        circle.setAttribute('r', '3');
        circle.setAttribute('fill', 'rgba(30, 58, 138, 0.3)');
        svg.appendChild(circle);
    });

    container.appendChild(svg);

    // 繪製節點 DOM
    nodes.forEach(node => {
        const div = document.createElement('div');
        div.className = `net-node node-${node.type}`;
        div.style.left = node.x + 'px';
        div.style.top = node.y + 'px';
        div.innerText = node.label;
        div.title = node.label; // tooltip
        container.appendChild(div);
    });
}

// Fallback Graph（當 AI 沒有回傳法規圖譜時）
function renderFallbackGraph(container, data) {
    const graphInfo = data.graph || { product: '投資單', law: '金保法 §10', issue: '未盡告知', caseId: 'C-1029' };
    const fallbackNodes = [
        { label: `📦 產品: ${graphInfo.product}`, x: '8%', y: '38%', type: 'obligation' },
        { label: `⚖️ 法規: ${graphInfo.law}`, x: '35%', y: '12%', type: 'law' },
        { label: `🚨 爭議: ${graphInfo.issue}`, x: '38%', y: '65%', type: 'consequence' },
        { label: `📁 案件: ${graphInfo.caseId}`, x: '70%', y: '35%', type: 'case' }
    ];

    // SVG 連線
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'graph-lines');
    svg.innerHTML = `
        <line x1="18%" y1="48%" x2="42%" y2="22%" stroke="rgba(30,58,138,0.15)" stroke-width="1.5" stroke-dasharray="4,3"/>
        <line x1="42%" y1="22%" x2="48%" y2="72%" stroke="rgba(30,58,138,0.15)" stroke-width="1.5" stroke-dasharray="4,3"/>
        <line x1="42%" y1="22%" x2="76%" y2="42%" stroke="rgba(30,58,138,0.15)" stroke-width="1.5" stroke-dasharray="4,3"/>
        <line x1="48%" y1="72%" x2="76%" y2="42%" stroke="rgba(30,58,138,0.15)" stroke-width="1.5" stroke-dasharray="4,3"/>
    `;
    container.appendChild(svg);

    fallbackNodes.forEach(n => {
        const div = document.createElement('div');
        div.className = `net-node node-${n.type}`;
        div.style.left = n.x;
        div.style.top = n.y;
        div.innerText = n.label;
        container.appendChild(div);
    });
}

// --- Case Intelligence Metrics ---
function renderMetrics(data) {
    if (!data.metrics) return;
    const lawEl = document.getElementById('metric-avg-law');
    const prodEl = document.getElementById('metric-high-risk-product');
    const amtEl = document.getElementById('metric-avg-amount');

    if (lawEl) lawEl.innerHTML = `${data.metrics.avgLaw} <span style="font-size: 1rem; color: #ef4444; font-weight: 500;">↑ 12%</span>`;
    if (prodEl) prodEl.innerHTML = data.metrics.highRiskProduct;
    if (amtEl) amtEl.innerHTML = `${data.metrics.avgAmount} <span style="font-size: 1rem; color: #10b981; font-weight: 500;">↓ 5%</span>`;
}

// ============================================================
// 7. Fallback Mock Data Generator
// ============================================================
function getMockData(category, product, segment) {
    if (category === 'insurance') {
        return {
            narrative: `本批次分析涵蓋 620 件醫療給付爭議案件（對標 **C002** 類案件）。系統偵測到 **日間住院實支實付理賠拒賠爭議** 佔比最高（54%），主要集中於「精神科/慢性病日間留院是否符合合約住院定義」。依據 **保險法第54-1條 (疑義利益歸於被保險人原則)** 及 **精神衛生法第35條**，保險公司拒賠立場相對薄弱，建議合規部評估通融給付或調整標準契約條款。`,
            matrix: [
                { product: '實支實付醫療險', law: '保險法 §54-1', highRisk: 168, medRisk: 82, lowRisk: 15 },
                { product: '意外傷害險', law: '保險法 §131', highRisk: 32, medRisk: 64, lowRisk: 110 },
                { product: '重大疾病險', law: '保險法 §125', highRisk: 8, medRisk: 25, lowRisk: 116 }
            ],
            lawGraph: [
                {
                    law: '保險法 第54-1條 (有利解釋原則)',
                    obligations: ['探求當事人真意', '疑義有利於被保險人'],
                    consequences: ['通融給付', '勝訴率低'],
                    cases: [{ '編號': 'C002' }]
                },
                {
                    law: '精神衛生法 第35條 (醫療服務)',
                    obligations: ['日間留院屬正規醫療'],
                    consequences: ['符合實質住院要件'],
                    cases: []
                },
                {
                    law: '保險法 第131條 (傷害保險)',
                    obligations: ['外來突發事故認定'],
                    consequences: ['理賠金額給付'],
                    cases: []
                }
            ],
            riskData: {
                level: '中風險',
                violations: ['契約住院定義不明確', '忽視精神衛生法正規醫療認定', '未作有利被保險人解釋'],
                cases: []
            },
            graph: { product: '實支實付險', law: '保險法 §54-1', issue: '日間住院拒賠', caseId: 'C002' },
            metrics: {
                avgLaw: '3.1',
                highRiskProduct: '實支實付醫療險',
                avgAmount: 'NT$ 8.4W'
            }
        };
    }

    // 預設/投資型保單 (C001 對標批次)
    let focusText = '投資型保單';
    let lawText = '金保法 §10';

    return {
        narrative: `本次批次分析涵蓋 850 件案件（對標 **C001** 類案件）。系統偵測到 **${focusText}** 佔比顯著偏高（42%），尤其在 **${segment === 'senior' ? '高齡客群 (65歲以上)' : '一般客群'}** 中，多涉及 **${lawText} (未盡告知義務)** 與 **金保法第9條 (適合度原則)**。理專涉嫌誘導修改風險屬性評估表，建議法遵部針對此類商品啟動專案查核，並加強前線理專的銷售話術錄音監管。`,
        matrix: [
            { product: focusText, law: lawText, highRisk: 142, medRisk: 55, lowRisk: 12 },
            { product: '信貸產品', law: '個資法 §20', highRisk: 24, medRisk: 89, lowRisk: 150 },
            { product: '醫療險理賠', law: '保險法 §54', highRisk: 5, medRisk: 34, lowRisk: 210 }
        ],
        lawGraph: [
            {
                law: '金保法 第9條 (適合度原則)',
                obligations: ['充分瞭解消費者', '確保商品適合度'],
                consequences: ['主管機關裁罰', '賠償損失'],
                cases: []
            },
            {
                law: '金保法 第10條 (說明義務)',
                obligations: ['充分說明商品', '風險揭露'],
                consequences: ['賠償損失'],
                cases: [{ '編號': 'C001' }]
            },
            {
                law: '民法 第184條 (侵權責任)',
                obligations: ['不得故意或過失侵害權利'],
                consequences: ['損害賠償責任'],
                cases: []
            }
        ],
        riskData: {
            level: '高風險',
            violations: ['誘導變造風險問卷', '未充分揭露匯損與本金風險', '適合度審查流於形式'],
            cases: []
        },
        graph: { product: focusText, law: lawText, issue: '未盡告知', caseId: 'C001' },
        metrics: {
            avgLaw: '4.2',
            highRiskProduct: focusText,
            avgAmount: 'NT$ 35.0W'
        }
    };
}
