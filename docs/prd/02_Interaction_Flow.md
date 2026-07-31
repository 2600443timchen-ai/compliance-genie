# Executive Risk Command Center
## Part 2：Interaction Flow (互動流程)

本文件定義「高階主管級」的操作動線與 React 元件狀態變換 (State Transitions)。

---

### Flow 1: 從雷達到全息檢視 (Radar to Hologram)

```text
[View]
系統首頁渲染 `RiskClusteringHeatmap` 元件。
「結構債」區塊顯示深紅色，數字跳動顯示 [128 件異常]。
↓
[Click]
點擊「結構債」熱區。
↓
[State Update]
React `setSelectedCluster('structured_notes')`。
主畫面平滑切換，左側載入群組特徵，右側展開 `HolographicEvidenceViewer` 元件。
```

---

### Flow 2: 影音串流與 RAG 即時連動 (Live Stream & RAG Sync)

```text
[Click]
在 `HolographicEvidenceViewer` 點擊音軌播放鍵。
↓
[Action]
LiveKit 串流啟動。
↓
[Event Trigger: onTimeUpdate]
React 根據 `currentTime` 更新 `TranscriptViewer`，自動將正在播放的那句話加上高光背景 (Highlight)。
↓
[Context Detection]
當播放到「保證獲利」字眼時，觸發 RAG 偵測。
↓
[UI Animation]
畫面右側滑出 `RegulationCard`，紅字顯示：「警告：違反金融消費者保護法第9條（不實承諾獲利）」。
```

---

### Flow 3: 系統級戰略調度 (Orchestrating the System)

取代傳統的 Editor，改為高階的 Control Panel。

```text
[View]
在確認證據確鑿後，點擊右下角的 `[Action: 展開調度中樞]`。
↓
[Transition]
由下方彈出 `OrchestrationHub` 控制面板。
↓
[Action: 阻斷交易]
將「結構債線上申購閘道」的 Switch 由 [Active] 切換為 [Paused]。
↓
[API Call]
POST `/api/gateway/pause` { target: 'structured_notes' }
系統跳出 Toast: "交易閘道已成功阻斷"。
↓
[Action: 跨部門派令]
點擊 `[建立 Jira 重大事故]` 按鈕。
↓
[API Call]
POST `/api/integration/jira/create`
系統回傳 Ticket ID (e.g. SEC-9942)，並直接附加上方抓取的錄音檔與法規衝突證明。
```
