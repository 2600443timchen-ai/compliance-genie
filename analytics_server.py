"""Small same-origin backend-for-frontend for Compliance Genie.

Serves the repository's static files and exposes a narrow backend endpoint that
reads allow-listed Gemini Data sources and proxies the finance workspace chat.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


API_BASE = os.environ.get("GEMINI_API_BASE", "https://cloud.geminidata.com/api/v1").rstrip("/")
PORTAL_API_BASE = os.environ.get(
    "GEMINI_PORTAL_API_BASE",
    "https://cloud.geminidata.com/api/portal/api10",
).rstrip("/")
TENANT_ID = os.environ.get("GEMINI_TENANT_ID", "6a439e670763de002d27d6bd")
MAX_CSV_BYTES = 5 * 1024 * 1024
MAX_CHAT_BYTES = 10 * 1024 * 1024
MAX_QUESTION_BYTES = 32 * 1024
CACHE_SECONDS = 60
WORKSPACE_CHAT_TITLE = os.environ.get("GEMINI_WORKSPACE_CHAT_TITLE", "Compliance Genie 工作台")
PROJECT_ROOT = Path(__file__).resolve().parent

SOURCE_CATALOG = {
    "6a59cf580904f50013826ada": ("證券期貨", "爭議類型統計"),
    "6a59cfd40904f50013826b3d": ("銀行", "爭議類型統計"),
    "6a59d0910904f50013826bb8": ("保險輔助人", "非理賠爭議類型"),
    "6a59d0cf0904f50013826c20": ("保險輔助人", "理賠爭議類型"),
    "6a59d1250904f50013826c8b": ("產物保險", "非理賠爭議類型"),
    "6a59d1530904f50013826cfb": ("產物保險", "理賠爭議類型"),
    "6a59d1880904f50013826d6e": ("人壽保險", "非理賠爭議類型"),
    "6a59d1c30904f50013826e5b": ("人壽保險", "理賠爭議類型"),
    "6a59d9d10904f5001382760d": ("人壽保險", "申請評議案件及比率"),
    "6a59da120904f50013827697": ("產物保險", "申請評議案件及比率"),
    "6a59dfe90904f500138280dd": ("人壽保險", "申訴案件及申訴率"),
}

_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()
_workspace_chat_id: str | None = None
_workspace_chat_lock = threading.Lock()


class UpstreamError(RuntimeError):
    pass


DEFAULT_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhNjE5ZjFiMDc2M2RlMDAyZDJmNjJmNiIsImlzQVBJIjp0cnVlLCJnX3VpZCI6IjZhNDNhMGVmMDc2M2RlMDAyZDI3ZTVjYyIsImdfYWRtaW4iOmZhbHNlLCJnX2RlbW9hZG1pbiI6ZmFsc2UsImdfYWNjb3VudGFkbWluIjpmYWxzZSwiZ190aWQiOiI2YTQzOWU2NzA3NjNkZTAwMmQyN2Q2YmQ6cHJvZHVjZXIiLCJnX3RpZF9wZXJtaXNzaW9uIjpbIm1ldGE6dXBkYXRlIiwic291cmNlOnJlYWQiLCJzb3VyY2U6dXBkYXRlIiwic291cmNlOmRlbGV0ZSIsImdyYXBoOnJlYWQiLCJncmFwaDp1cGRhdGUiLCJncmFwaDpkZWxldGUiLCJncmFwaDpleHBsb3JlIiwiZ3JhcGg6ZXhwb3J0IiwiY2FudmFzOmFubm90YXRlIiwiY2FudmFzOnBlcnNvbmFsaXplIiwiZGFzaGJvYXJkOnJlYWQiLCJkYXNoYm9hcmQ6dXBkYXRlIiwiY2FudmFzOnNoYXBlIl0sImdfdGlkX3BhcnNlcl9zb3VyY2UiOiJjc3YiLCJnX3RpZF9mZWF0dXJlX2FkZF9vbnMiOlsiYXNzaXN0YW50Il0sImdfYXZhdGFyIjoiMDIiLCJpc3MiOiJodHRwczovL2Nsb3VkLmdlbWluaWRhdGEuY29tIiwic3ViIjoiNmE0M2EwZWYwNzYzZGUwMDJkMjdlNWNjIiwiYXVkIjoiaHR0cHM6Ly9jbG91ZC5nZW1pbmlkYXRhLmNvbSIsImV4cCI6NDg2NjcwNTI4MiwiaWF0IjoxNzg0NzgyNjE5LCJuaWNrbmFtZSI6Im1lbWJlcjMzQDIwMjZzZWkuY29tIiwiZW1haWwiOiJtZW1iZXIzM0AyMDI2c2VpLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjpmYWxzZX0.DJJY-GARRczejSVR2ZaX93iUcLrGxUizZ8lvaoqiAZU"


MOCK_CASES = [
    {
      "id": 'C001',
      "applicant": '王○○（52歲）',
      "receivedAt": '2026-07-20',
      "category": 'investment',
      "product": 'policy',
      "segment": 'senior',
      "channel": '分行',
      "productVersion": 'V2024.1',
      "riskLevel": 'high',
      "outcome": 'upheld',
      "disputedAmount": 1500000,
      "exposureCount": 12000,
      "status": '審查中',
      "badgeClass": 'badge-review',
      "type": '金融消費爭議 (投資型商品)',
      "item": '理專涉嫌違反告知義務',
      "regulations": ['金融消費者保護法第9條', '金融消費者保護法第10條'],
      "violations": ['適合度評估不足', '風險揭露不全'],
      "evidence": ['錄音檔#A01', 'KYC問卷#K12']
    },
    {
      "id": 'C002',
      "applicant": '林○○（35歲）',
      "receivedAt": '2026-07-22',
      "category": 'insurance',
      "product": 'all', 
      "segment": 'all',
      "channel": '網銀',
      "productVersion": 'V2025.2',
      "riskLevel": 'medium',
      "outcome": 'pending',
      "disputedAmount": 300000,
      "exposureCount": 85000,
      "status": '進行中',
      "badgeClass": 'badge-progress',
      "type": '保險理賠爭議 (醫療險)',
      "item": '精神科日間住院理賠爭議',
      "regulations": ['保險法第54-1條'],
      "violations": ['條款解釋疑義'],
      "evidence": ['診斷證明書#M03']
    },
    {
      "id": 'C003',
      "applicant": '陳○○（45歲）',
      "receivedAt": '2026-07-25',
      "category": 'creditcard',
      "product": 'all',
      "segment": 'vip',
      "channel": '客服',
      "productVersion": 'V2024.3',
      "riskLevel": 'low',
      "outcome": 'rejected',
      "disputedAmount": 15000,
      "exposureCount": 200000,
      "status": '已結案',
      "badgeClass": 'badge-resolved',
      "type": '信用卡交易爭議',
      "item": '信用卡遭盜刷爭議',
      "regulations": ['信用卡業務機構管理辦法'],
      "violations": ['驗證機制瑕疵'],
      "evidence": ['OTP發送紀錄']
    }
]

MOCK_INSIGHTS = {
  "events": {"kicker":'RISK SIGNAL', "title":'新增高風險事件', "metric":'12 件 · 較前 14 天 +35%', "cause":'投資型保單爭議集中於高齡客群，且適合度評估與風險說明紀錄同時缺漏，使事件被提升為高風險。', "evidence":'31 → 42 件；65 歲以上占 82%；8 個分行、17 位理專受影響。', "action":'48 小時內先提高 8 個異常分行的主管覆核層級，再抽查 KYC 與通聯紀錄。'},
  "exposure": {"kicker":'FINANCIAL EXPOSURE', "title":'潛在財務曝險', "metric":'NT$ 680–1,020 萬', "cause":'27 件高風險案件依爭議金額、責任比例與可能裁罰情境形成區間估算，不代表確定罰鍰。', "evidence":'其中 3 件 SIGNAL 01 關聯案件曝險約 155–265 萬；整體估算信心 76%。', "action":'優先核對金額最高且期限最近的案件，再由法遵覆核責任比例與裁罰依據。'},
  "sla": {"kicker":'SERVICE LEVEL', "title":'SLA 逾期風險', "metric":'27 件 · 3 件須於 48 小時內介入', "cause":'信用卡部平均處理時間拉長至 28 天，加上高風險案件文件補正反覆，形成期限壓力。', "evidence":'信用卡部達標率 64%；財富管理處 95%；3 件關聯案件剩餘 2、4、7 天。', "action":'今日指定案件負責人與升級門檻，先處理剩餘 2 天的 C001-INV。'},
  "regulatory": {"kicker":'REGULATORY GAP', "title":'待完成法規缺口', "metric":'4 項 · 最近期限 14 天', "cause":'公平待客與高齡客戶錄音覆核流程尚未完成內控文件、系統規則與教育訓練同步。', "evidence":'公平待客作業調整完成度 68%；實質受益人機制完成度 92%。', "action":'本週核准流程責任人及驗收證據，避免只完成制度文件而未落實系統控制。'},
  "signal": {"kicker":'SIGNAL 01', "title":'投資型保單 × 高齡客群', "metric":'42 件 · 近 14 天 +35%', "cause":'風險並非只由件數上升造成，而是高齡集中度、KYC 缺漏與錄音證據不足同時出現。', "evidence":'65 歲以上占 82%；8 個分行；17 位理專；判定信心 82%。', "action":'先針對異常分行提高銷售覆核層級，不直接全面停售；7 天內完成專案抽查。'},
  "benchmark": {"kicker":'EXTERNAL BENCHMARK', "title":'人壽保險業外部基準', "metric":'載入中', "cause":'外部統計用來確認招攬類爭議是否具產業普遍性，但不能直接證明本公司案件成因。', "evidence":'Gemini Data 正式 Source API／已驗證快照。', "action":'將外部占比與本公司同口徑指標比較；確認顯著偏離後再決定是否擴大抽查。'},
  "wealth-sla": {"kicker":'DEPARTMENT SLA', "title":'財富管理處', "metric":'142 件 · 12 天 · 95%', "cause":'整體達標率良好，但 SIGNAL 01 集中於此部門，使少數高風險案件需要額外覆核。', "evidence":'8 個異常分行、17 位理專；3 件高風險關聯案件。', "action":'維持既有 SLA，同時為高齡與投資型保單案件加上第二層覆核。'},
  "consumer-sla": {"kicker":'DEPARTMENT SLA', "title":'消費金融處', "metric":'89 件 · 18 天 · 82%', "cause":'文件補正與跨單位確認拉長處理時間，但尚未進入立即介入門檻。', "evidence":'達標率比財富管理處低 13 個百分點。', "action":'檢查補正次數最高的案件類型，設定一次性補件清單。'},
  "card-sla": {"kicker":'DEPARTMENT SLA', "title":'信用卡部', "metric":'215 件 · 28 天 · 64%', "cause":'案件量最高，且消費款與催收爭議需要跨系統調閱，造成平均處理時間上升。', "evidence":'達標率為三部門最低；另有 C142-CRD 僅剩 3 天。', "action":'今日建立紅色案件清單並安排每日主管覆核，先排除可快速補證的案件。'},
  "case-c001": {"kicker":'CASE DRILL', "title":'C001-INV · 適合度評估', "metric":'剩 2 天 · 曝險 90–150 萬', "cause":'KYC 風險屬性與商品風險等級的對應證據不足，且客戶屬高齡族群。', "evidence":'SIGNAL 01 主要案件；負責人林專員。', "action":'24 小時內補齊 KYC、銷售錄音與主管覆核紀錄，逾時即升級法遵主管。'},
  "case-c077": {"kicker":'CASE DRILL', "title":'C077-INV · 高齡客群揭露', "metric":'剩 4 天 · 曝險 40–70 萬', "cause":'高齡客戶的風險揭露與理解確認紀錄不足。', "evidence":'SIGNAL 01 關聯案件；負責人李襄理。', "action":'補做錄音逐字稿抽查，確認關鍵風險是否以可理解方式說明。'},
  "case-c104": {"kicker":'CASE DRILL', "title":'C104-INV · KYC 文件缺漏', "metric":'剩 7 天 · 曝險 25–45 萬', "cause":'關鍵 KYC 欄位或版本留存不完整，無法還原銷售當時判斷。', "evidence":'SIGNAL 01 關聯案件；負責人王專員。', "action":'比對 CRM、紙本掃描與簽核紀錄，確認是資料遺失或流程未執行。'},
  "case-c142": {"kicker":'CASE DRILL', "title":'C142-CRD · 不當催收', "metric":'剩 3 天 · 曝險 45–75 萬', "cause":'催收通聯內容與聯繫時段需要人工覆核，且案件已接近處理期限。', "evidence":'信用卡部案件；負責人陳副理。', "action":'立即封存通聯證據並由法遵抽聽，確認是否觸及不當催收紅線。'},
  "case-c088": {"kicker":'CASE DRILL', "title":'C088-INS · 風險說明', "metric":'剩 5 天 · 曝險 20–40 萬', "cause":'商品風險說明與客戶理解確認的證據完整度不足。', "evidence":'保險爭議案件；負責人張專員。', "action":'先核對要保文件與錄音時間軸，再決定是否需要客戶補充訪談。'}
}

def api_token() -> str:
    token = os.environ.get("GEMINI_API_TOKEN", "").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if not token:
        token = DEFAULT_JWT
    return token


def request_bytes(url: str, *, authenticated: bool, attempts: int = 2) -> tuple[bytes, str]:
    headers = {"Accept": "application/json, text/csv;q=0.9, */*;q=0.8"}
    if authenticated:
        headers["Authorization"] = f"Bearer {api_token()}"
        headers["x-application-tenant"] = TENANT_ID
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers=headers, method="GET")
            with urllib.request.urlopen(request, timeout=15) as response:
                content_length = int(response.headers.get("Content-Length", "0") or 0)
                if content_length > MAX_CSV_BYTES:
                    raise UpstreamError("上游檔案超過允許大小")
                body = response.read(MAX_CSV_BYTES + 1)
                if len(body) > MAX_CSV_BYTES:
                    raise UpstreamError("上游回應超過允許大小")
                return body, response.headers.get_content_type()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(0.35 * (attempt + 1))
    raise UpstreamError(f"Gemini Data API 無法連線：{last_error}")


def api_headers(*, content_type: bool = False) -> dict[str, str]:
    headers = {
        "Accept": "application/json, text/event-stream;q=0.9, */*;q=0.8",
        "Authorization": f"Bearer {api_token()}",
        "x-application-tenant": TENANT_ID,
    }
    if content_type:
        headers["Content-Type"] = "application/json"
    return headers


def request_api_json(
    url: str,
    *,
    method: str = "GET",
    payload: dict | None = None,
    timeout: int = 30,
) -> object:
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers=api_headers(content_type=payload is not None),
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(MAX_CHAT_BYTES + 1)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
        raise UpstreamError(f"Gemini Data API 無法連線：{error}") from error
    if len(raw) > MAX_CHAT_BYTES:
        raise UpstreamError("上游聊天回應超過允許大小")
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise UpstreamError("上游未回傳有效 JSON") from error


def get_or_create_workspace_chat() -> dict:
    global _workspace_chat_id
    with _workspace_chat_lock:
        chats = request_api_json(f"{API_BASE}/chat/list")
        if not isinstance(chats, list):
            raise UpstreamError("聊天室清單格式不正確")

        if _workspace_chat_id:
            cached = next((chat for chat in chats if chat.get("_id") == _workspace_chat_id), None)
            if cached:
                return cached

        existing = next((chat for chat in chats if chat.get("title") == WORKSPACE_CHAT_TITLE), None)
        if existing:
            _workspace_chat_id = str(existing["_id"])
            return existing

        created = request_api_json(f"{API_BASE}/chat/create", method="POST", payload={})
        if not isinstance(created, dict):
            raise UpstreamError("建立聊天室回應格式不正確")
        chat_id = created.get("insertedId") or created.get("_id")
        if not chat_id:
            raise UpstreamError("建立聊天室後未取得聊天室 ID")
        request_api_json(
            f"{API_BASE}/chat/{urllib.parse.quote(str(chat_id), safe='')}/update",
            method="POST",
            payload={"title": WORKSPACE_CHAT_TITLE},
        )
        _workspace_chat_id = str(chat_id)
        return {"_id": _workspace_chat_id, "title": WORKSPACE_CHAT_TITLE}


def fetch_chat_messages(chat_id: str) -> list[dict]:
    payload = request_api_json(
        f"{PORTAL_API_BASE}/assistant/chat/{urllib.parse.quote(chat_id, safe='')}/messages"
    )
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise UpstreamError("聊天室歷史格式不正確")
    return [message for message in payload["data"] if isinstance(message, dict)]


def fetch_chat_validation(chat_id: str, message_id: str) -> dict:
    payload = request_api_json(
        f"{PORTAL_API_BASE}/assistant/chat/{urllib.parse.quote(chat_id, safe='')}/{urllib.parse.quote(message_id, safe='')}/validation"
    )
    if not isinstance(payload, dict):
        raise UpstreamError("溯源資料格式不正確")
    return payload


def ask_workspace_chat(chat_id: str, question: str) -> dict:
    workspace_chat = get_or_create_workspace_chat()
    if chat_id != workspace_chat.get("_id"):
        raise KeyError(chat_id)

    request = urllib.request.Request(
        f"{PORTAL_API_BASE}/assistant/chat/{urllib.parse.quote(chat_id, safe='')}",
        data=json.dumps({"q": question, "streaming": True}, ensure_ascii=False).encode("utf-8"),
        headers=api_headers(content_type=True),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=150) as response:
            raw = response.read(MAX_CHAT_BYTES + 1)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
        raise UpstreamError(f"AI 回覆失敗：{error}") from error
    if len(raw) > MAX_CHAT_BYTES:
        raise UpstreamError("AI 回覆超過允許大小")

    user_message_id = ""
    message_id = ""
    fallback_answer = ""
    for raw_line in raw.decode("utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line.startswith("data:"):
            continue
        event_text = line[5:].strip()
        if not event_text or event_text == "[DONE]":
            continue
        try:
            event = json.loads(event_text)
        except json.JSONDecodeError:
            continue
        user_message_id = str(event.get("userMessageId") or user_message_id)
        message_id = str(event.get("messageId") or message_id)
        if isinstance(event.get("result"), str):
            fallback_answer = event["result"]

    messages = fetch_chat_messages(chat_id)
    answer_message = next(
        (message for message in reversed(messages) if message_id and str(message.get("_id")) == message_id),
        None,
    )
    if answer_message is None:
        answer_message = next(
            (message for message in reversed(messages) if message.get("role") in {"ai", "assistant"}),
            None,
        )
    answer = str((answer_message or {}).get("content") or fallback_answer).strip()
    if not answer:
        raise UpstreamError("AI 已完成處理，但未取得可顯示的回答")
    return {
        "chat_id": chat_id,
        "chat_title": workspace_chat.get("title", WORKSPACE_CHAT_TITLE),
        "user_message_id": user_message_id,
        "message_id": message_id,
        "answer": answer,
    }


def fetch_source(source_id: str) -> dict:
    if source_id not in SOURCE_CATALOG:
        raise KeyError(source_id)
    with _cache_lock:
        cached = _cache.get(source_id)
        if cached and time.time() - cached[0] < CACHE_SECONDS:
            return {**cached[1], "cache": "hit"}

    url_body, _ = request_bytes(
        f"{API_BASE}/import/sources/{source_id}/getDownloadUrl",
        authenticated=True,
    )
    try:
        signed_url = json.loads(url_body.decode("utf-8"))["url"]
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise UpstreamError("正式 API 未回傳有效的下載網址") from error
    parsed = urllib.parse.urlparse(signed_url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise UpstreamError("正式 API 回傳了不安全的下載網址")

    csv_body, _ = request_bytes(signed_url, authenticated=False)
    try:
        text = csv_body.decode("utf-8-sig")
        rows = list(csv.DictReader(io.StringIO(text)))
    except (UnicodeDecodeError, csv.Error) as error:
        raise UpstreamError("來源 CSV 無法解析") from error
    if not rows or len(rows) > 5000:
        raise UpstreamError("來源資料列數不符合安全限制")

    columns = list(rows[0].keys())
    required = {"日期(起)", "日期(迄)"}
    dispute_columns = {"爭議類型", "申訴件數", "評議件數", "合計"}
    company_schema = (
        "爭議對象" in columns
        and ("申請評議件數" in columns or "申訴件數" in columns)
        and any("比率" in column or "申訴率" in column for column in columns)
    )
    if not required.issubset(columns) or not (dispute_columns.issubset(columns) or company_schema):
        raise UpstreamError("來源欄位與儀表板契約不一致")

    industry, label = SOURCE_CATALOG[source_id]
    payload = {
        "status": "ok",
        "mode": "live",
        "source_id": source_id,
        "industry": industry,
        "label": label,
        "api_base": API_BASE,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "row_count": len(rows),
        "columns": columns,
        "rows": rows,
        "cache": "miss",
    }
    with _cache_lock:
        _cache[source_id] = (time.time(), payload)
    return payload


class DashboardHandler(SimpleHTTPRequestHandler):
    server_version = "ComplianceGenieDemo/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PROJECT_ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.OK)
        self.end_headers()

    def send_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def send_sse_result(self, payload: dict) -> None:
        event = json.dumps({
            "result": payload["answer"],
            "chatId": payload["chat_id"],
            "chatTitle": payload["chat_title"],
            "userMessageId": payload["user_message_id"],
            "messageId": payload["message_id"],
        }, ensure_ascii=False)
        body = f"data: {event}\n\ndata: [DONE]\n\n".encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache, no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/health":
            self.send_json(HTTPStatus.OK, {
                "status": "ok",
                "service": "analytical-dashboard-bff",
                "api_base": API_BASE,
                "token_configured": bool(os.environ.get("GEMINI_API_TOKEN", "").strip()),
            })
            return
        if path == "/api/chat/session":
            try:
                chat = get_or_create_workspace_chat()
                self.send_json(HTTPStatus.OK, {
                    "status": "success",
                    "chat_id": chat["_id"],
                    "title": chat.get("title", WORKSPACE_CHAT_TITLE),
                })
            except UpstreamError as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"status": "error", "message": str(error)})
            except Exception:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"status": "error", "message": "聊天室初始化失敗"})
            return
        chat_prefix = "/api/chat/"
        if path.startswith(chat_prefix) and path.endswith("/messages"):
            chat_id = urllib.parse.unquote(path[len(chat_prefix):-len("/messages")]).strip("/")
            try:
                workspace_chat = get_or_create_workspace_chat()
                if chat_id != workspace_chat.get("_id"):
                    raise KeyError(chat_id)
                messages = fetch_chat_messages(chat_id)
                self.send_json(HTTPStatus.OK, {"status": "success", "data": messages})
            except KeyError:
                self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "聊天室不存在"})
            except UpstreamError as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"status": "error", "message": str(error)})
            except Exception:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"status": "error", "message": "聊天室歷史載入失敗"})
            return
        if path.startswith(chat_prefix) and path.endswith("/validation"):
            parts = path[len(chat_prefix):-len("/validation")].strip("/").split("/")
            if len(parts) != 2:
                self.send_json(HTTPStatus.BAD_REQUEST, {"status": "error", "message": "路徑格式不正確"})
                return
            chat_id, message_id = parts
            try:
                workspace_chat = get_or_create_workspace_chat()
                if chat_id != workspace_chat.get("_id"):
                    raise KeyError(chat_id)
                validation_data = fetch_chat_validation(chat_id, message_id)
                self.send_json(HTTPStatus.OK, validation_data)
            except KeyError:
                self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "聊天室不存在"})
            except UpstreamError as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"status": "error", "message": str(error)})
            except Exception:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"status": "error", "message": "溯源資料載入失敗"})
            return
        if path == "/api/analytics/sources":
            self.send_json(HTTPStatus.OK, {
                "status": "ok",
                "sources": [
                    {"id": sid, "industry": ind, "label": lbl}
                    for sid, (ind, lbl) in SOURCE_CATALOG.items()
                ]
            })
            return
        prefix = "/api/analytics/sources/"
        if path.startswith(prefix):
            source_id = path[len(prefix):]
            try:
                self.send_json(HTTPStatus.OK, fetch_source(source_id))
            except KeyError:
                self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "不允許的 Source ID"})
            except UpstreamError as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"status": "error", "message": str(error)})
            except Exception:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"status": "error", "message": "後端處理失敗"})
            return
        if path == "/api/insights":
            self.send_json(HTTPStatus.OK, {"status": "success", "data": MOCK_INSIGHTS})
            return
        
        if path.startswith("/api/cases"):
            parsed_path = urllib.parse.urlparse(self.path)
            # Check if it's a specific ID
            parts = parsed_path.path.strip("/").split("/")
            if len(parts) == 3 and parts[2] != "search":
                case_id = parts[2]
                case = next((c for c in MOCK_CASES if c["id"].lower() == case_id.lower()), None)
                if case:
                    self.send_json(HTTPStatus.OK, {"status": "success", "data": case})
                else:
                    self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "案件不存在"})
                return
            
            # Or a search query
            query = urllib.parse.parse_qs(parsed_path.query).get("q", [""])[0].lower()
            if query:
                results = [c for c in MOCK_CASES if 
                           query in str(c.get("id", "")).lower() or 
                           query in str(c.get("applicant", "")).lower() or 
                           query in str(c.get("type", "")).lower()]
            else:
                results = MOCK_CASES
            self.send_json(HTTPStatus.OK, {"status": "success", "data": results})
            return

        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        path = urllib.parse.urlparse(self.path).path
        chat_prefix = "/api/chat/"
        if not path.startswith(chat_prefix):
            self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "找不到 API"})
            return

        chat_id = urllib.parse.unquote(path[len(chat_prefix):]).strip("/")
        try:
            content_length = int(self.headers.get("Content-Length", "0") or 0)
            if content_length <= 0 or content_length > MAX_QUESTION_BYTES:
                self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"status": "error", "message": "問題內容過長或為空"})
                return
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8"))
            question = str(payload.get("q") or payload.get("question") or "").strip()
            if not question:
                self.send_json(HTTPStatus.BAD_REQUEST, {"status": "error", "message": "缺少問題內容"})
                return
            result = ask_workspace_chat(chat_id, question)
            self.send_sse_result(result)
        except KeyError:
            self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "聊天室不存在"})
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"status": "error", "message": "請求格式不正確"})
        except UpstreamError as error:
            self.send_json(HTTPStatus.BAD_GATEWAY, {"status": "error", "message": str(error)})
        except Exception:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"status": "error", "message": "AI 對話處理失敗"})

    def log_message(self, message: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {message % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve Compliance Genie analytical demo")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="Open the dashboard in the default browser")
    args = parser.parse_args()
    url = f"http://{args.host}:{args.port}/pages/v2_workspace_analytical_finance.html"
    server = ThreadingHTTPServer((args.host, args.port), DashboardHandler)
    print(f"Compliance Genie demo: {url}")
    print(f"Gemini Data API: {API_BASE}")
    print("Press Ctrl+C to stop.")
    if args.open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping demo server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
