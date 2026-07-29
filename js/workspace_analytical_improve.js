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
// 2. 觸發批次分析（載入分析按鈕）- 採用進階 API 整合版本
// ============================================================
async function loadBatchAnalysisLegacy() {
    const category = document.getElementById('filter-category').value || 'all';
    const product = document.getElementById('filter-product').value || 'all';
    const segment = document.getElementById('filter-segment').value || 'all';

    // 簡化 Prompt，不再強制要求 LLM 輸出龐大的 JSON，交給專屬 API 處理
    const promptText = `請針對目前選定的條件（爭議類別: ${category}, 商品: ${product}, 客戶分群: ${segment}）分析最新批次案件的合規風險與適法性。`;

    console.log("送出分析條件:", promptText);
    setLoadingState(true);

    try {
        const chatID = await getChatId();
        const mockBase = getMockData(category, product, segment);

        if (chatID) {
            try {
                // 1. 發送基礎分析請求 (使用原本支援的 streaming: true 模式避免 502 錯誤)
                const chatResponse = await fetch(`${GEMINI_API_BASE}/assistant/chat/${chatID}`, {
                    method: 'POST',
                    headers: getApiHeaders(),
                    body: JSON.stringify({ question: promptText, streaming: true })
                });
                
                if (chatResponse.ok) {
                    // 必須將 SSE 串流讀取完畢，後端才算完成這筆 message 的生成
                    const reader = chatResponse.body.getReader();
                    let done = false;
                    while (!done) {
                        const { done: readerDone } = await reader.read();
                        done = readerDone;
                    }
                } else {
                    console.warn(`Chat API 錯誤: ${chatResponse.status}`);
                }
            } catch (e) {
                console.warn("基礎分析請求失敗", e);
            }
        } else {
            console.warn("無有效的 Chat ID，跳過基礎 Chat 呼叫，直接嘗試 Summary API...");
        }

        // 2. 取得最新的 Message ID (需要 chatID)
        let messageId = 'latest';
        if (chatID) {
            try {
                const msgRes = await fetch(`${GEMINI_API_BASE}/assistant/chat/${chatID}/messages`, {
                    headers: getApiHeaders()
                });
                if (msgRes.ok) {
                    const msgData = await msgRes.json();
                    const messages = msgData.data || [];
if (messages.length > 0) {
                        messageId = messages[messages.length - 1]._id || messageId;
                    }
                }
            } catch (e) {
                console.warn("取得 messages 失敗，將嘗試使用 fallback ID", e);
            }
        }

        // 3. 呼叫 Summary API (FR-08: 敘事洞察引擎 & 隱藏的知識圖譜節點)
        try {
            const summaryRes = await fetch(`${GEMINI_API_BASE}/assistant/chat/summary?type=markdown`, {
                headers: getApiHeaders()
            });
            if (summaryRes.ok) {
                const summaryData = await summaryRes.json();
                let narrative = summaryData.data || summaryData.summary || summaryData.result;
                
                // 1) 嘗試從隱藏的 nodes 解析真實圖譜 (若 API 回傳了 Graph 結構)
                if (summaryData.nodes && Array.isArray(summaryData.nodes)) {
                    console.log("🌟 偵測到 Summary API 夾帶知識圖譜 Nodes 資料，進行動態解析...");
                    const regNode = summaryData.nodes.find(n => n.name === 'Regulation');
                    const impNode = summaryData.nodes.find(n => n.name === 'Improvement');
                    const dispNode = summaryData.nodes.find(n => n.name === 'Dispute');

                    // 建立 mapping: Case -> Value
                    const extractMapping = (nodeObj, valuePropName) => {
                        const caseProp = nodeObj.properties.find(p => p.name === 'Case');
                        const valProp = nodeObj.properties.find(p => p.name === valuePropName || p.name === 'label');
                        const map = {};
                        if (caseProp && valProp) {
                            caseProp.values.forEach((c, idx) => {
                                map[c] = valProp.values[idx] || valProp.values[0]; 
                            });
                        }
                        return map;
                    };

                    const regMap = regNode ? extractMapping(regNode, 'Regulation') : {};
                    const impMap = impNode ? extractMapping(impNode, 'Improvement') : {};
                    const dispMap = dispNode ? extractMapping(dispNode, 'Dispute') : {};

                    const lawGraphMap = {};
                    Object.keys(regMap).forEach(c => {
                        const law = regMap[c];
                        const obligation = impMap[c];
                        const consequence = dispMap[c];

                        if (law) {
                            if (!lawGraphMap[law]) {
                                lawGraphMap[law] = { law: law, obligations: [], consequences: [], cases: [] };
                            }
                            if (obligation && !lawGraphMap[law].obligations.includes(obligation)) lawGraphMap[law].obligations.push(obligation);
                            if (consequence && !lawGraphMap[law].consequences.includes(consequence)) lawGraphMap[law].consequences.push(consequence);
                            if (!lawGraphMap[law].cases.some(caseObj => caseObj['編號'] === c)) {
                                lawGraphMap[law].cases.push({ '編號': c });
                            }
                        }
                    });

                    const realLawGraph = Object.values(lawGraphMap);
                    if (realLawGraph.length > 0) {
                        mockBase.lawGraph = realLawGraph;
                        console.log("✅ 成功轉換真實知識圖譜資料！", realLawGraph);
                    }
                }

                // 2) 確保 narrative 是字串，以防 marked() 解析錯誤
                if (typeof narrative === 'object' && narrative !== null) {
                    // 若沒有擷取到文字且有 nodes，我們生出一段基礎摘要給它
                    if (summaryData.nodes) {
                        narrative = "### 系統洞察\nGemini API 已成功分析批次案件，並為您動態生成右側的**知識探索圖譜**與關聯。圖譜資料已從底層 Nodes 節點擷取並即時渲染完畢。";
                    } else if (Array.isArray(narrative)) {
                        narrative = narrative.map(item => typeof item === 'object' ? JSON.stringify(item) : item).join('\n');
                    } else {
                        narrative = narrative.text || narrative.content || narrative.markdown || JSON.stringify(narrative, null, 2);
                    }
                }

                if (narrative) mockBase.narrative = narrative;
                console.log("✅ 成功從 Summary API 取得洞察", narrative);
            }
        } catch (e) {
            console.warn("Summary API 失敗", e);
        }

        // 4. 呼叫 Chartgen API (FR-09: 交叉分析矩陣)
        if (chatID) {
            try {
                const chartRes = await fetch(`${GEMINI_API_BASE}/assistant/chat/${chatID}/${messageId}/chartgen`, {
                    method: 'POST',
                    headers: getApiHeaders(),
                    body: JSON.stringify({ type: 'matrix' })
                });
                if (chartRes.ok) {
                    const chartJson = await chartRes.json();
                    const matrix = chartJson.data || chartJson.chart || chartJson.matrix;
                    if (matrix) mockBase.matrix = matrix;
                    console.log("✅ 成功從 Chartgen API 取得分析矩陣");
                }
            } catch (e) {
                console.warn("Chartgen API 失敗", e);
            }
        }

        // 5. 呼叫 Validation API (FR-10: 知識探索圖譜)
        if (chatID) {
            try {
                const valRes = await fetch(`${GEMINI_API_BASE}/assistant/chat/${chatID}/${messageId}/validation`, {
                    headers: getApiHeaders()
                });
                if (valRes.ok) {
                    const valJson = await valRes.json();
                    const lawGraph = valJson.data || valJson.graph || valJson.lawGraph;
                    if (lawGraph) mockBase.lawGraph = lawGraph;
                    console.log("✅ 成功從 Validation API 取得圖譜節點");
                }
            } catch (e) {
                console.warn("Validation API 失敗", e);
            }
        }

        renderDashboard(mockBase);

    } catch (err) {
        console.error("主要 API 流程呼叫失敗，全面啟用本地 Mock 數據:", err);
        setTimeout(() => {
            renderDashboard(getMockData(category, product, segment));
        }, 1200);
    }
}

// ============================================================
// 3. 解析 AI 回傳的 JSON（支援多種格式）
// ============================================================
// ============================================================
// 3. 確定性資料生成與批次分析
// ============================================================
function generateDeterministicData(category, product, segment, volume) {
    const records = typeof AppDatabase !== 'undefined' ? AppDatabase.queryCases({category, product, segment}).slice(0, Number(volume) || 100) : [];
    
    if (records.length === 0) {
        return {
            narrative: '無符合條件的案件資料。',
            matrix: [],
            lawGraph: [],
            riskData: { violations: [] },
            metrics: { avgLaw: '—', highRiskProduct: '—', savedAmount: '—', traced: '—' }
        };
    }

    let totalExposure = 0;
    let totalUpheld = 0;
    const matrixMap = new Map();
    const graphsMap = new Map();
    const violationsMap = new Map();
    const productMap = new Map();
    let totalLaws = 0;
    let tracedCases = 0;

    records.forEach(r => {
        totalExposure += r.exposureCount || 0;
        const upheldWeight = r.outcome === 'upheld' ? 1 : (r.outcome === 'partial' ? 0.5 : 0);
        totalUpheld += upheldWeight;
        
        if (r.evidence && r.evidence.length > 0) tracedCases++;
        totalLaws += (r.regulations || []).length;

        const stat = productMap.get(r.product) || { exposure: 0, upheld: 0, amount: 0 };
        stat.exposure += r.exposureCount || 0;
        stat.upheld += upheldWeight;
        stat.amount += r.disputedAmount || 0;
        productMap.set(r.product, stat);

        (r.violations || []).forEach(v => violationsMap.set(v, (violationsMap.get(v) || 0) + 1));

        const laws = (r.regulations || []).length ? r.regulations : ['未標註法規'];
        laws.forEach(law => {
            const mKey = `${r.product}|${law}`;
            const mItem = matrixMap.get(mKey) || { product: r.product, law: law, highRisk: 0, medRisk: 0, lowRisk: 0 };
            if (r.riskLevel === 'high') mItem.highRisk++;
            else if (r.riskLevel === 'medium') mItem.medRisk++;
            else mItem.lowRisk++;
            matrixMap.set(mKey, mItem);

            const gItem = graphsMap.get(law) || { law: law, obligations: [], consequences: [], cases: [] };
            (r.violations || []).forEach(v => !gItem.obligations.includes(v) && gItem.obligations.push(v));
            const outcomeLabel = r.outcome === 'upheld' ? '成立' : (r.outcome === 'rejected' ? '不成立' : '處理中');
            !gItem.consequences.includes(outcomeLabel) && gItem.consequences.push(outcomeLabel);
            !gItem.cases.some(c => c['編號'] === r.id) && gItem.cases.push({ '編號': r.id });
            graphsMap.set(law, gItem);
        });
    });

    const topProduct = [...productMap.entries()].map(([name, stat]) => ({ name, rate: stat.exposure ? stat.upheld / stat.exposure : 0, amount: stat.amount }))
        .sort((a, b) => b.rate - a.rate || b.amount - a.amount)[0];
    
    const topViolations = [...violationsMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, count]) => `${name}（${count}）`);
    const rate = totalExposure ? (totalUpheld / totalExposure * 10000).toFixed(2) : 0;

    return {
        narrative: '',
        matrix: [...matrixMap.values()].sort((a, b) => b.highRisk - a.highRisk || b.medRisk - a.medRisk),
        lawGraph: [...graphsMap.values()],
        riskData: { violations: topViolations },
        metrics: {
            avgLaw: (totalLaws / records.length).toFixed(1),
            highRiskProduct: topProduct ? topProduct.name : '—',
            savedAmount: records.length ? `${rate} / 萬` : '—', // Used for rate
            traced: `${tracedCases} / ${records.length}`
        },
        _rawContext: `目前最高風險商品為 ${topProduct ? topProduct.name : '無'}，每萬曝險成立等值風險率為 ${rate} 件。主要控制缺口包含：${topViolations.join('、')}。`
    };
}

async function loadBatchAnalysis() {
    const category = document.getElementById('filter-category').value || 'all';
    const product = document.getElementById('filter-product').value || 'all';
    const segment = document.getElementById('filter-segment').value || 'all';
    const volumeElement = document.getElementById('filter-volume');
    const volume = volumeElement ? (volumeElement.value || '10') : '10';

    setLoadingState(true);
    const dashboardData = generateDeterministicData(category, product, segment, volume);

    if (!dashboardData._rawContext) {
        renderDashboard(dashboardData);
        return;
    }

    const promptText = `請根據以下系統計算出之各維度高風險商品與常見控制缺口，撰寫一段敘事性的合規風險洞察摘要（約100字以內，不要使用 Markdown 列點，請直接寫成一段話）。系統分析數據：${dashboardData._rawContext}`;

    try {
        const chatID = await getChatId();
        if (!chatID) throw new Error('No chat is available for analysis.');

        const response = await fetch(`${GEMINI_API_BASE}/assistant/chat/${chatID}`, {
            method: 'POST',
            headers: getApiHeaders(),
                body: JSON.stringify({ question: promptText, streaming: true })
        });

        if (response.ok && response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let latestResult = '';
            for (;;) {
                const { value, done } = await reader.read();
                if (value) {
                    const chunk = decoder.decode(value, { stream: !done });
                    const lines = chunk.split(/\r?\n/);
                    for (const line of lines) {
                        if (!line.startsWith('data:')) continue;
                        const payload = line.slice(5).trim();
                        if (payload && payload !== '[DONE]') {
                            try {
                                const event = JSON.parse(payload);
                                latestResult = event.result || event.content || event.text || latestResult;
                            } catch (_) {}
                        }
                    }
                }
                if (done) break;
            }
            if (latestResult) {
                dashboardData.narrative = latestResult + '\n\n*(此洞察由 AI 根據實際統計數據生成)*';
            }
        }
    } catch (err) {
        console.warn('AI Narrative generation failed, using fallback.', err);
        dashboardData.narrative = `系統分析完成：${dashboardData._rawContext}`;
    }

    renderDashboard(dashboardData);
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
    const savedAmtEl = document.getElementById('metric-saved-amount'); // actually rate
    const tracedEl = document.getElementById('metric-traced-cases'); // 新增

    if (lawEl) lawEl.innerHTML = `${data.metrics.avgLaw}`;
    if (prodEl) prodEl.innerHTML = data.metrics.highRiskProduct;
    if (savedAmtEl) {
        savedAmtEl.innerHTML = `${data.metrics.savedAmount}`;
        savedAmtEl.style.animation = 'none';
        savedAmtEl.style.color = '#10b981';
    }
    if (tracedEl) {
        tracedEl.innerHTML = data.metrics.traced || '—';
    }
}

// getMockData function totally removed as per strict requirement.

// ============================================================
// 8. 匯出分析報告 (Export Report)
// ============================================================
function triggerExport() {
    // 建立動態 Toast 提示
    let toast = document.getElementById('analytical-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'analytical-toast';
        toast.style.cssText = 'position:fixed; top:20px; right:20px; background:#1e3a8a; color:white; padding:12px 24px; border-radius:8px; z-index:9999; box-shadow:0 4px 12px rgba(0,0,0,0.15); opacity:0; transition:opacity 0.3s; font-family:"Inter", sans-serif; display:flex; align-items:center; gap:8px;';
        toast.innerHTML = '<span>📄 報告生成中...</span>';
        document.body.appendChild(toast);
    }
    
    toast.innerHTML = '<span>📄 報告生成中，請稍候...</span>';
    toast.style.opacity = '1';

    setTimeout(() => {
        // 抓取當前畫面的數據
        const category = document.getElementById('filter-category').options[document.getElementById('filter-category').selectedIndex].text;
        const product = document.getElementById('filter-product').options[document.getElementById('filter-product').selectedIndex].text;
        const segment = document.getElementById('filter-segment').options[document.getElementById('filter-segment').selectedIndex].text;
        
        const narrativeEl = document.getElementById('narrative-insight-text');
        const narrative = narrativeEl ? narrativeEl.innerText : '無資料';

        const matrixBody = document.getElementById('matrix-tbody');
        let matrixText = '| 商品/法條 | 高風險 | 中風險 | 低風險 |\n|---|---|---|---|\n';
        if (matrixBody) {
            const rows = matrixBody.querySelectorAll('tr');
            rows.forEach(tr => {
                const cols = tr.querySelectorAll('td');
                if (cols.length === 4) {
                    matrixText += `| ${cols[0].innerText.replace(/\n/g, ' ')} | ${cols[1].innerText} | ${cols[2].innerText} | ${cols[3].innerText} |\n`;
                }
            });
        }

        const avgLaw = document.getElementById('metric-avg-law') ? document.getElementById('metric-avg-law').innerText : '';
        const highRiskProd = document.getElementById('metric-high-risk-product') ? document.getElementById('metric-high-risk-product').innerText : '';

        // 組裝 Markdown 報告
        const reportContent = `# 📊 合規風險批次分析報告

**產出時間**：${new Date().toLocaleString()}
**篩選條件**：
- 爭議類別：${category}
- 涉案商品：${product}
- 客戶分群：${segment}

---

## 📌 關鍵風險指標 (KPIs)
- **平均引用法條數**：${avgLaw}
- **最高風險商品**：${highRiskProd}

---

## 📝 AI 敘事洞察 (Narrative Insight)
${narrative}

---

## 📈 風險交叉分析矩陣
${matrixText}

---
*本報告由 Gemini Enterprise AI 自動生成。*
`;

        // 觸發下載
        const blob = new Blob([reportContent], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Batch_Analysis_Report_${new Date().getTime()}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        toast.innerHTML = '<span>✅ 報告下載完成！</span>';
        setTimeout(() => { toast.style.opacity = '0'; }, 2000);
    }, 1000);
}
