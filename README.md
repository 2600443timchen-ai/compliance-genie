# 合規精靈 Compliance Genie - 智能金融消費爭議解決方案

「合規精靈」是一款為金融機構合規人員與法務專家設計的 AI-Native 智能輔助工作台。結合了大語言模型（LLM）與檢索增強生成（RAG）技術，能夠自動解析消費者爭議案件、檢索推薦法規，並為爭議處理與答辯意見書提供深度的合規建議及報告生成。

---

## 🚀 系統架構

為了提高代碼的可讀性、可維護性及便於 Token 和端點的統一管理，本專案採用了 CSS 與 JavaScript 模組化拆分架構：

```
SEI競賽/
├── css/
│   ├── global.css        # 全域樣式：定義色彩變數、Reset、自訂滾動條與共用背景
│   ├── landing.css       # 登入/首頁樣式
│   ├── workspace.css     # 智能工作台樣式（包含聊天氣泡、載入動畫、法規面板）
│   └── test_api.css      # API 測試工具專屬樣式
├── js/
│   ├── config.js         # 統一配置檔：管理 API_BASE 與後端 JWT 連線憑證
│   └── workspace.js      # 工作台互動邏輯與 RAG 後端 API 串接邏輯
├── pages/
│   ├── v2_workspace.html # 核心智能合規工作台頁面
│   └── test_api.html     # 連線測試工具頁（CORS 與 Proxy 驗證）
├── index.html            # 首頁/導覽入口頁
├── .gitignore            # Git 忽略設定檔
└── README.md             # 本開發與部署說明文件
```

---

## 💡 核心功能

1. **AI 案件適法性深度分析**：
   自動分析理專是否違反《金融消費者保護法》之「適合度原則」與「充分說明義務」，並指出關鍵合規疏失與比例責任建議。
2. **多管道案卷載入**：
   * **模擬/預設案卷**：提供投資型保單及實支實付醫療險等預設爭議案件進行快速測試。
   * **手動自訂案卷**：合規人員可手動填寫當事人、案件類型、爭議金額等資訊一鍵建立案卷。
   * **文件拖曳上傳**：支援拖曳 CSV 或 PDF 到工作台，自動寫入向量知識庫並啟動 RAG。
3. **動態法規引用與檢索**：
   自動比對當前案卷，於右側面板列出建議法規（如《金融消費者保護法》、《保險法》、《民法》等），點擊法規條文即可將其作為引用來源直接插入對話框進行追問。
4. **大模型串流回答（SSE）**：
   連線後端 API 時，支援 Server-Sent Events (SSE) 串流模式，回覆即時打字呈現；若 API 連線逾時，系統會無縫切換至「本地專家大模型模擬解答」確保業務不中斷。
5. **合規審查報告匯出**：
   一鍵將審查結果、法規引用與爭議要點打包為 JSON 格式報告下載，便於後續法務系統整合。

---

## 🛠️ 開發與本地執行

### 分析儀表板：同時啟動前端與正式 API 後端

Windows 可直接雙擊 `start_analytical_demo.cmd`，或在 PowerShell 的專案根目錄執行：

```powershell
.\start_analytical_demo.ps1
```

這個指令會同時啟動靜態前端與小型同源後端，並開啟：
`http://127.0.0.1:8765/pages/v2_workspace_analytical_finance.html`

後端使用 `https://cloud.geminidata.com/api/v1`，只代理儀表板允許的 11 個 Source ID。優先讀取後端環境變數 `GEMINI_API_TOKEN`；目前展示環境若未設定，啟動腳本會暫時沿用 `js/config.js` 的既有展示憑證。正式部署請只用環境變數，避免讓 JWT 出現在前端檔案。

不需要自動開啟瀏覽器時，也可以直接執行：

```powershell
$env:GEMINI_API_TOKEN = '<token>'
python .\analytics_server.py --host 127.0.0.1 --port 8765
```

健康檢查端點：`GET /api/health`。

1. **安裝 Live Server**：
   在 VS Code 中安裝 **Live Server** 擴充功能，或在專案根目錄執行：
   ```bash
   npx http-server -p 5500
   ```
2. **啟動專案**：
   右鍵點擊 `index.html` 選擇 `Open with Live Server`。
3. **配置 API 連線**：
   若需修改後端 API 伺服器網址或更新登入權限，請直接編輯：
   * [js/config.js](file:///c:/Users/Tim/Desktop/SEI%E7%AB%B6%E8%B3%BD/js/config.js) ➡️ 修改 `API_BASE` 與 `JWT_TOKEN`。
4. **測試連線狀態**：
   可於瀏覽器訪問 `http://127.0.0.1:5500/pages/test_api.html` 以檢測 Live Server Proxy 與 API 後端直接連線的 CORS 狀態。

---

## 📡 API 對接規格說明

本系統與後端進行交互的核心 API 接口規格如下（連線均需於 Header 帶入 `Authorization: Bearer <JWT_TOKEN>`）：

### 1. 取得會話清單
*   **端點**：`GET /chat/list`
*   **功能**：載入所有雲端歷史協作對話，系統用以比對是否有與當前案號相同的對話。

### 2. 建立新對話會話
*   **端點**：`POST /chat/create`
*   **功能**：初始化一個新的 RAG 會話。
*   **回傳**：`{ "insertedId": "chat_session_id" }`

### 3. 更新會話標題
*   **端點**：`POST /chat/<chatId>/update`
*   **功能**：將對話標題更新為案件編號（如 `C001`）以便儲存與追蹤。

### 4. 讀取會話歷史訊息
*   **端點**：`GET /chat/<chatId>/messages`
*   **功能**：取得該案件在雲端的完整 AI 對答紀錄。

### 5. 上傳文件至向量資料庫 (RAG)
*   **第一步：上傳檔案**
    *   **端點**：`POST /import/uploads`
    *   **格式**：`FormData` 帶 `file` 欄位
    *   **回傳**：`{ "path": "file_storage_path" }`
*   **第二步：寫入知識庫**
    *   **端點**：`POST /import/vector/knowledge`
    *   **格式**：JSON 
    *   **參數**：`{ "title": "檔案名稱", "file_name": "檔案名稱", "file_path": "file_storage_path" }`

### 6. 送出合規問題諮詢 (支援 SSE 串流)
*   **端點**：`POST /chat/<chatId>`
*   **格式**：`{ "question": "問題內容" }`
*   **串流回覆格式 (text/event-stream)**：
    後端回傳格式為標準的 SSE 串流：
    ```
    data: {"choices": [{"delta": {"content": "即時生"}}]}
    data: {"choices": [{"delta": {"content": "成的字詞"}}]}
    data: [DONE]
    ```
