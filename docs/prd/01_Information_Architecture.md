# Executive Risk Command Center
## Part 1：Information Architecture (資訊架構)

本文件定義「高階主管級動態風險指揮中心」的底層資料與介面架構。拋棄微觀的工單視角，全面轉向聚合分析與系統級控制。

---

### 1. 🌐 全局曝險雷達 (Systemic Risk Radar)

**Mission**
高階主管的視角必須是上帝視角 (God's Eye)。取代傳統的條列式工單，此區塊透過向量索引將萬筆資料分群，以「熱點 (Hotspots)」呈現系統性異常。

**Data Architecture (MongoDB + Python Flask)**
- `Vector Clusters`: 將客訴與進件的文本進行 Embedding 分群。
- `Heatmap Intensity`: 基於 SLA 危急度、牽涉金額、法規嚴重性綜合計算。
- `Live Feeds`: 串接交易閘道與客服系統，實現毫秒級資料匯入。

**Interaction**
- 不再是一張張卡片，而是視覺化的「熱圖板塊」。
- 點擊熱區板塊，直接穿透至「深度穿透分析區」。

---

### 2. 🔍 深度穿透分析區 (Drill-down Analytics Workspace)

**Mission**
證據不能只有二手摘要。遇到重大風險事件，主管必須能直接審視最底層的原始憑證（通話音軌、合約）。

**Data Architecture (LiveKit + RAG)**
- `Multi-chunk Media Stream`: 透過 LiveKit 串流播放即時音檔，不需等待完整下載。
- `Dynamic RAG Highlight`: 將音檔轉為逐字稿，並與法規資料庫進行 RAG (檢索增強生成)，即時對比。

**Interaction**
- **全息證據檢視器 (Holographic Evidence Viewer)**：播放音軌時，下方的逐字稿如同卡拉OK般隨時間軸滾動。
- 當音軌播放到特定字眼，RAG 模組立刻在旁高亮觸犯之「金管會法規」，實現鐵證如山的對照。

---

### 3. ⚡ 戰略決策與調度中樞 (Orchestration Hub)

**Mission**
主管的 Action 不是打字回信，而是發動系統級的 API 指令來阻斷風險。

**Data Architecture (Microservices Integration)**
- `Gateway API`: 串接核心交易系統。
- `MongoDB Threshold Config`: 直接寫入風控參數。
- `Jira / ServiceNow Webhooks`: 跨部門工單派送。

**Interaction (Action Canvas)**
- **系統級阻斷**：一鍵切換 Toggle，暫停特定高風險產品的線上申購閘道。
- **動態閾值調整**：拖曳 Slider (滑桿)，將系統警示年齡從 70 歲下調至 65 歲，並即時 Apply 到全網。
- **跨部門派令**：點擊生成最高急件，直接透過 API 寫入 Jira 或 ServiceNow，取代人工 Email 寄送。
