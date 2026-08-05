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
TENANT_ID = os.environ.get("GEMINI_TENANT_ID", "6a439e670763de002d27d6bd")
MAX_CSV_BYTES = 5 * 1024 * 1024
CACHE_SECONDS = 60
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
