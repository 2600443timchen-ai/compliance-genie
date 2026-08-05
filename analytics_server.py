"""Small same-origin server for the analytical dashboard demo.

Serves the repository's static files and exposes a narrow backend endpoint that
reads allow-listed Gemini Data sources through the formal API.
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
_chat_lock = threading.Lock()
_chat_id: str | None = None


class UpstreamError(RuntimeError):
    pass


def api_token() -> str:
    token = os.environ.get("GEMINI_API_TOKEN", "").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if not token:
        raise UpstreamError("後端尚未設定 GEMINI_API_TOKEN")
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


def portal_headers(*, content_type: bool = False) -> dict[str, str]:
    headers = {
        "Accept": "application/json, text/event-stream;q=0.9, */*;q=0.8",
        "Authorization": f"Bearer {api_token()}",
        "x-application-tenant": TENANT_ID,
    }
    if content_type:
        headers["Content-Type"] = "application/json"
    return headers


def portal_json(path: str, *, timeout: int = 30) -> object:
    request = urllib.request.Request(
        f"{PORTAL_API_BASE}{path}",
        headers=portal_headers(),
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(MAX_CHAT_BYTES + 1)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
        raise UpstreamError(f"Gemini Chat API 無法連線：{error}") from error
    if len(raw) > MAX_CHAT_BYTES:
        raise UpstreamError("Gemini Chat API 回應超過允許大小")
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise UpstreamError("Gemini Chat API 未回傳有效 JSON") from error


def get_dashboard_chat() -> dict:
    """Call the documented assistant/chat/list endpoint on page bootstrap."""
    global _chat_id
    with _chat_lock:
        payload = portal_json("/assistant/chat/list")
        chats = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(chats, list) or not chats:
            raise UpstreamError("Gemini Chat API 沒有可用聊天室")
        selected = next(
            (chat for chat in chats if chat.get("title") == WORKSPACE_CHAT_TITLE),
            None,
        )
        if selected is None and _chat_id:
            selected = next((chat for chat in chats if str(chat.get("_id")) == _chat_id), None)
        if selected is None:
            selected = chats[0]
        _chat_id = str(selected.get("_id") or "")
        if not _chat_id:
            raise UpstreamError("Gemini Chat API 未提供聊天室 ID")
        return selected


def fetch_chat_messages(chat_id: str) -> list[dict]:
    payload = portal_json(
        f"/assistant/chat/{urllib.parse.quote(chat_id, safe='')}/messages",
        timeout=45,
    )
    messages = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(messages, list):
        raise UpstreamError("Gemini Chat 訊息格式不正確")
    return [message for message in messages if isinstance(message, dict)]


def ask_dashboard_chat(chat_id: str, question: str) -> dict:
    selected = get_dashboard_chat()
    if chat_id != str(selected.get("_id")):
        raise KeyError(chat_id)
    request = urllib.request.Request(
        f"{PORTAL_API_BASE}/assistant/chat/{urllib.parse.quote(chat_id, safe='')}",
        data=json.dumps({"q": question, "streaming": True}, ensure_ascii=False).encode("utf-8"),
        headers=portal_headers(content_type=True),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=150) as response:
            raw = response.read(MAX_CHAT_BYTES + 1)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
        raise UpstreamError(f"Gemini Chat 回覆失敗：{error}") from error
    if len(raw) > MAX_CHAT_BYTES:
        raise UpstreamError("Gemini Chat 回覆超過允許大小")

    message_id = ""
    user_message_id = ""
    fallback = ""
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
        message_id = str(event.get("messageId") or message_id)
        user_message_id = str(event.get("userMessageId") or user_message_id)
        if isinstance(event.get("result"), str):
            fallback = event["result"]

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
    answer = str((answer_message or {}).get("content") or fallback).strip()
    if not answer:
        raise UpstreamError("Gemini Chat 已完成，但沒有可顯示的回答")
    return {
        "chat_id": chat_id,
        "chat_title": selected.get("title") or "Untitled",
        "message_id": message_id,
        "user_message_id": user_message_id,
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

    def send_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def send_chat_sse(self, payload: dict) -> None:
        event = json.dumps({
            "result": payload["answer"],
            "chatId": payload["chat_id"],
            "chatTitle": payload["chat_title"],
            "messageId": payload["message_id"],
            "userMessageId": payload["user_message_id"],
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
                chat = get_dashboard_chat()
                self.send_json(HTTPStatus.OK, {
                    "status": "ok",
                    "mode": "live",
                    "endpoint": "/assistant/chat/list",
                    "chat_id": chat["_id"],
                    "chat_title": chat.get("title") or "Untitled",
                })
            except UpstreamError as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"status": "error", "message": str(error)})
            except Exception:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"status": "error", "message": "Chat API 初始化失敗"})
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
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        path = urllib.parse.urlparse(self.path).path
        prefix = "/api/chat/"
        if not path.startswith(prefix):
            self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "找不到 API"})
            return
        chat_id = urllib.parse.unquote(path[len(prefix):]).strip("/")
        try:
            content_length = int(self.headers.get("Content-Length", "0") or 0)
            if content_length <= 0 or content_length > MAX_QUESTION_BYTES:
                self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"status": "error", "message": "問題內容過長或為空"})
                return
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            question = str(payload.get("q") or payload.get("question") or "").strip()
            if not question:
                self.send_json(HTTPStatus.BAD_REQUEST, {"status": "error", "message": "缺少問題內容"})
                return
            self.send_chat_sse(ask_dashboard_chat(chat_id, question))
        except KeyError:
            self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "聊天室不存在"})
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"status": "error", "message": "請求格式不正確"})
        except UpstreamError as error:
            self.send_json(HTTPStatus.BAD_GATEWAY, {"status": "error", "message": str(error)})
        except Exception:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"status": "error", "message": "Chat API 處理失敗"})

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
