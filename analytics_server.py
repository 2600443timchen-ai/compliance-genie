"""Small same-origin server for the analytical dashboard demo.

Serves the repository's static files and exposes a narrow backend endpoint that
reads allow-listed Gemini Data sources through the formal API.
"""

from __future__ import annotations

import argparse
import copy
import csv
import io
import json
import os
import random
import re
import statistics
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Load KEY=VALUE pairs from a .env file into the environment.

    A real environment variable (already set before the process starts)
    always wins over the .env file, so `$env:GEMINI_API_TOKEN = '...'` in a
    shell still overrides it. .env itself is gitignored — see .env.example
    for the expected keys."""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(Path(__file__).resolve().parent / ".env")

API_BASE = os.environ.get("GEMINI_API_BASE", "https://cloud.geminidata.com/api/v1").rstrip("/")
PORTAL_API_BASE = os.environ.get(
    "GEMINI_PORTAL_API_BASE",
    "https://cloud.geminidata.com/api/portal/api10",
).rstrip("/")
TENANT_ID = os.environ.get("GEMINI_TENANT_ID", "6a439e670763de002d27d6bd")
MAX_CSV_BYTES = 5 * 1024 * 1024
MAX_CHAT_BYTES = 10 * 1024 * 1024
MAX_QUESTION_BYTES = 2 * 1024 * 1024
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
CACHE_SECONDS = 60
WORKSPACE_CHAT_TITLE = os.environ.get("GEMINI_WORKSPACE_CHAT_TITLE", "Compliance Genie 工作台")
PROJECT_ROOT = Path(__file__).resolve().parent
WORKSPACE_CASE_FILES = {
    "C001": PROJECT_ROOT / "docs" / "C001_案卷.md",
    "C002": PROJECT_ROOT / "docs" / "C002_案卷.md",
    "C900": PROJECT_ROOT / "docs" / "C900_案卷.md",
}
CASE_DATABASE_SOURCE_ID = "6a68168e4963aa00134e26cc"
CASE_DATABASE_COLUMNS = (
    "Case", "Case Title", "Dispute", "Regulation", "Product", "outcome",
    "Improvement", "keywords", "產業", "違規類型", "爭議根本原因",
    "客戶類型", "涉案金額", "Date",
)

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
_dashboard_overview_cache: dict | None = None
_dashboard_overview_cache_lock = threading.Lock()
_knowledge_write_available: bool | None = None
_knowledge_write_lock = threading.Lock()
_chat_lock = threading.Lock()
_chat_create_available: bool | None = None
# case_id -> chat_id for this process's lifetime. This tenant's chat/create
# endpoint doesn't accept a title and its rename route 404s (verified live,
# see create_chat()), so per-case chat rooms can't be found again by title —
# we track the mapping ourselves instead. Survives page reloads and case
# switches; does NOT survive a server restart.
_case_chat_map: dict[str, str] = {}


class UpstreamError(RuntimeError):
    pass


def _markdown_field(text: str, label: str, default: str = "未提供") -> str:
    marker = f"**{label}**："
    for line in text.splitlines():
        if marker in line:
            return line.split(marker, 1)[1].strip() or default
    return default


def _parse_twd_amount(value: str) -> dict[str, int | str | None]:
    """Keep the display string, but also expose a calculable money contract."""
    normalized = value.replace(",", "").strip()
    digits = "".join(character for character in normalized if character.isdigit())
    amount = int(digits) if digits and normalized not in {"未提供", "—"} else None
    currency = "TWD" if "NT$" in value.upper() or "TWD" in value.upper() else "TWD"
    return {"value": amount, "currency": currency}


def parse_workspace_case(case_id: str, path: Path) -> dict:
    """Parse a repository case dossier into the Finance workspace contract."""
    text = path.read_text(encoding="utf-8")
    if len(text.encode("utf-8")) > MAX_CSV_BYTES:
        raise ValueError(f"案件檔案過大：{case_id}")
    parsed_id = _markdown_field(text, "案號", case_id).upper()
    if parsed_id != case_id:
        raise ValueError(f"案件檔案案號不符：{case_id}")

    summary: list[str] = []
    laws: list[dict[str, str]] = []
    in_summary = False
    in_laws = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line.startswith("## "):
            in_summary = line == "## 爭議事實與要點摘要"
            in_laws = line == "## 引用法條與法律依據"
            continue
        if in_summary and line.startswith("- ") and not line.startswith(("- **來源文件**", "- **關鍵字**")):
            point = line[2:].strip()
            if point and point != "**事實摘要**：":
                summary.append(point)
        if in_laws and line.startswith("* "):
            title = line[2:].replace("**", "").strip()
            if not title:
                continue
            # Expand compact dossier notation such as
            # 「金融消費者保護法：第7條、第9條」 into article-level items.
            law_parts = re.split(r"[：:]", title, maxsplit=1)
            article_pattern = r"第\s*\d+(?:\s*之\s*\d+)?\s*條(?:\s*之\s*\d+)?"
            if len(law_parts) == 2 and re.search(article_pattern, law_parts[1]):
                law_name, articles_text = (part.strip() for part in law_parts)
                articles = re.findall(article_pattern, articles_text)
                laws.extend({"title": f"{law_name}{article.replace(' ', '')}", "desc": "案卷引用法規"} for article in articles)
            else:
                laws.append({"title": title, "desc": "案卷引用法規"})

    source = _markdown_field(text, "來源文件", "未提供")
    keywords = _markdown_field(text, "關鍵字", "")
    if source != "未提供":
        summary.append(f"來源文件：{source}")
    amount = _markdown_field(text, "涉案金額")
    return {
        "id": parsed_id,
        "applicant": _markdown_field(text, "當事人"),
        "type": _markdown_field(text, "案件類型"),
        "item": _markdown_field(text, "爭議標的"),
        "amount": amount,
        "disputeAmount": _parse_twd_amount(amount),
        "created": _markdown_field(text, "申請日期"),
        "updated": time.strftime("%Y-%m-%d", time.localtime(path.stat().st_mtime)),
        "status": _markdown_field(text, "目前狀態"),
        "badgeClass": "badge-review",
        "summary": summary,
        "laws": laws,
        "keywords": [item.strip() for item in keywords.split(";") if item.strip()],
        "textContext": text,
        "source": str(path.relative_to(PROJECT_ROOT)).replace("\\", "/"),
    }


def find_workspace_cases(query: str = "") -> list[dict]:
    cases = [parse_workspace_case(case_id, path) for case_id, path in WORKSPACE_CASE_FILES.items()]
    normalized = query.casefold().strip()
    if not normalized:
        return cases
    return [case for case in cases if normalized in " ".join([
        case["id"], case["applicant"], case["type"], case["item"],
        " ".join(case["summary"]), " ".join(case["keywords"]), case["textContext"],
    ]).casefold()]


def normalize_case_database_row(row: dict[str, str]) -> dict:
    """Map the declared Case Source schema to the workspace case contract."""
    case_id = str(row.get("Case") or "").strip().upper()
    if not re.fullmatch(r"C\d{3,}", case_id):
        raise UpstreamError("Case Source 含有無效案號")
    amount_value = _parse_twd_amount(str(row.get("涉案金額") or ""))
    amount = "未提供" if amount_value["value"] is None else f"TWD {amount_value['value']:,}"
    raw_date = str(row.get("Date") or "").strip()
    case_date = _roc_date_to_iso(raw_date) or raw_date or "未提供"
    laws = [
        {"title": title, "desc": "Case Source Regulation 欄位"}
        for title in (part.strip() for part in str(row.get("Regulation") or "").split(";"))
        if title
    ]
    summary_fields = (
        ("案卷標題", row.get("Case Title")),
        ("改善措施", row.get("Improvement")),
        ("爭議根本原因", row.get("爭議根本原因")),
        ("違規類型", row.get("違規類型")),
        ("產業", row.get("產業")),
    )
    summary = [f"{label}：{str(value).strip()}" for label, value in summary_fields if str(value or "").strip()]
    keywords = [part.strip() for part in str(row.get("keywords") or "").split(";") if part.strip()]
    text_context = "\n".join(
        f"{column}：{str(row.get(column) or '').strip()}"
        for column in CASE_DATABASE_COLUMNS
        if str(row.get(column) or "").strip()
    )
    return {
        "id": case_id,
        "applicant": str(row.get("客戶類型") or "未提供").strip(),
        "type": str(row.get("Product") or row.get("產業") or "未提供").strip(),
        "item": str(row.get("Dispute") or "未提供").strip(),
        "amount": amount,
        "disputeAmount": amount_value,
        "created": case_date,
        "updated": case_date,
        "status": str(row.get("outcome") or "未提供").strip(),
        "badgeClass": "badge-review",
        "summary": summary,
        "laws": laws,
        "keywords": keywords,
        "textContext": text_context,
        "source": f"Gemini Data Source {CASE_DATABASE_SOURCE_ID}",
    }


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


def data_api_post(path: str, body: bytes, content_type: str, *, timeout: int = 90) -> dict:
    """POST a bounded payload to the Data API and require a JSON response."""
    headers = portal_headers()
    headers["Content-Type"] = content_type
    request = urllib.request.Request(
        f"{API_BASE}{path}",
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(MAX_CHAT_BYTES + 1)
    except urllib.error.HTTPError as error:
        detail = error.read(2048).decode("utf-8", errors="replace").strip()
        raise UpstreamError(f"Gemini 上傳 API 回覆 HTTP {error.code}{f'：{detail}' if detail else ''}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise UpstreamError(f"Gemini 上傳 API 無法連線：{error}") from error
    if len(raw) > MAX_CHAT_BYTES:
        raise UpstreamError("Gemini 上傳 API 回應超過允許大小")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise UpstreamError("Gemini 上傳 API 未回傳有效 JSON") from error
    if not isinstance(payload, dict):
        raise UpstreamError("Gemini 上傳 API 回應格式不正確")
    return payload


def upload_to_signed_url(signed_url: str, body: bytes, content_type: str, *, timeout: int = 90) -> None:
    """PUT one bounded file to Gemini's SaaS object-storage URL without API credentials."""
    parsed = urllib.parse.urlparse(signed_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise UpstreamError("Gemini 上傳 API 提供的 signed URL 無效")
    request = urllib.request.Request(
        signed_url,
        data=body,
        headers={"Content-Type": content_type or "application/octet-stream"},
        method="PUT",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read(1)
    except urllib.error.HTTPError as error:
        detail = error.read(2048).decode("utf-8", errors="replace").strip()
        raise UpstreamError(f"Gemini signed URL 上傳回覆 HTTP {error.code}{f'：{detail}' if detail else ''}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise UpstreamError(f"Gemini signed URL 上傳無法連線：{error}") from error


def extract_local_document_text(body: bytes, content_type: str, file_name: str) -> str:
    """Extract bounded text locally; scanned PDFs fail closed instead of returning garbage."""
    suffix = Path(file_name).suffix.casefold()
    if suffix == ".pdf" or content_type.casefold().startswith("application/pdf"):
        try:
            from pypdf import PdfReader
        except ImportError as error:
            raise UpstreamError("本地 PDF 分析需要安裝 pypdf") from error
        try:
            reader = PdfReader(io.BytesIO(body))
            text = "\n\n".join((page.extract_text() or "").strip() for page in reader.pages).strip()
        except Exception as error:
            raise UpstreamError(f"本地 PDF 文字擷取失敗：{error}") from error
        if not text:
            raise UpstreamError("PDF 未包含可擷取文字；掃描型 PDF 需要 OCR 後才能本地分析")
        return text[:200_000]
    if content_type.casefold().startswith("text/") or suffix in {".txt", ".csv", ".md"}:
        try:
            return body.decode("utf-8-sig")[:200_000]
        except UnicodeDecodeError as error:
            raise UpstreamError("本地文字檔不是 UTF-8 編碼") from error
    raise UpstreamError("知識庫未授權，且此檔案格式不支援本地文字分析")


def _is_authorization_error(error: UpstreamError) -> bool:
    message = str(error)
    return "HTTP 401" in message or "HTTP 403" in message or "unauthorized" in message.casefold()


def _local_only_upload_result(body: bytes, content_type: str, file_name: str, reason: str) -> dict:
    return {
        "status": "local_only",
        "mode": "local_text",
        "path": None,
        "file_name": file_name,
        "local_text": extract_local_document_text(body, content_type, file_name),
        "message": f"雲端知識庫沒有寫入權限，已改用本地文字分析：{reason}",
    }


def upload_workspace_knowledge(body: bytes, content_type: str, original_file_name: str = "") -> dict:
    """Upload through the SaaS signed-URL flow, then register the object in Vector Knowledge."""
    global _knowledge_write_available
    file_name = Path(original_file_name).name if original_file_name else "upload.bin"
    with _knowledge_write_lock:
        known_write_state = _knowledge_write_available
    if known_write_state is False:
        return _local_only_upload_result(body, content_type, file_name, "本次服務工作階段已確認缺少 source:write 權限")
    signed = data_api_post(
        "/import/uploads/signed-url",
        b"{}",
        "application/json; charset=utf-8",
    )
    signed_url = signed.get("signedUrl") or signed.get("signed_url") or signed.get("url")
    upload_id = signed.get("uploadId") or signed.get("upload_id") or signed.get("path") or signed.get("file_path")
    if not signed_url or not upload_id:
        raise UpstreamError("Gemini signed URL API 未提供 signedUrl 或 uploadId")
    upload_to_signed_url(str(signed_url), body, content_type)
    knowledge_body = json.dumps({
        "title": file_name,
        "file_name": file_name,
        "file_path": upload_id,
    }, ensure_ascii=False).encode("utf-8")
    try:
        knowledge = data_api_post(
            "/import/vector/knowledge",
            knowledge_body,
            "application/json; charset=utf-8",
        )
    except UpstreamError as error:
        if not _is_authorization_error(error):
            raise
        with _knowledge_write_lock:
            _knowledge_write_available = False
        return _local_only_upload_result(body, content_type, file_name, str(error))
    with _knowledge_write_lock:
        _knowledge_write_available = True
    # Best-effort local extraction alongside the cloud vector write: the vector
    # store's own retrieval is not reliably queried back by the structured
    # financial_risk_estimation task (verified live), so the frontend needs
    # this text to inject the upload directly into a case's confirmed facts
    # instead of hoping the Chat finds it on its own. Extraction failure here
    # (e.g. a scanned PDF with no text layer) must not fail the upload itself.
    try:
        local_text = extract_local_document_text(body, content_type, file_name)
    except UpstreamError:
        local_text = None
    return {
        "status": "ok",
        "path": upload_id,
        "file_name": file_name,
        "knowledge": knowledge,
        "local_text": local_text,
    }


def extract_validation_regulations(validation: object) -> list[dict[str, str | None]]:
    """Extract only explicit law/article nodes from Chat validation graph data."""
    candidates: list[dict] = []

    def collect(value: object, parent_key: str = "") -> None:
        if isinstance(value, list):
            if parent_key.casefold() in {"nodes", "vertices"}:
                candidates.extend(item for item in value if isinstance(item, dict))
            for item in value:
                collect(item, parent_key)
        elif isinstance(value, dict):
            for key, item in value.items():
                collect(item, str(key))

    collect(validation)
    regulations: list[dict[str, str | None]] = []
    seen: set[tuple[str, str]] = set()
    article_pattern = r"第\s*\d+(?:\s*之\s*\d+)?\s*條"
    for node in candidates:
        node_type = str(node.get("type") or node.get("node_type") or node.get("category") or "")
        label = str(node.get("label") or node.get("name") or node.get("title") or node.get("object_label") or "").strip()
        explicit_article = str(node.get("article") or node.get("article_no") or "").strip()
        article_match = re.search(article_pattern, f"{label} {explicit_article}")
        is_law_node = bool(re.search(r"法規|法條|regulation|law", node_type, re.IGNORECASE))
        if not label or (not article_match and not is_law_node):
            continue
        article = article_match.group(0).replace(" ", "") if article_match else explicit_article or None
        law_name = re.split(article_pattern, label, maxsplit=1)[0].strip(" ：:-") if article_match else label
        if not law_name:
            law_name = label
        key = (law_name, article or "")
        if key in seen:
            continue
        seen.add(key)
        regulations.append({
            "title": law_name,
            "article": article,
            "reason": "Chat validation 知識圖譜關聯",
            "source_id": str(node.get("source_id") or node.get("sourceId") or node.get("id") or "").strip() or None,
        })
    return regulations


def enrich_case_lookup_with_validation(payload: dict, validation: object) -> dict:
    data = payload.get("data")
    if not isinstance(data, dict):
        return payload
    existing = data.get("related_regulations") if isinstance(data.get("related_regulations"), list) else []
    graph_laws = extract_validation_regulations(validation)
    merged: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for law in [*existing, *graph_laws]:
        if not isinstance(law, dict):
            continue
        key = (str(law.get("title") or "").strip(), str(law.get("article") or "").strip())
        if not key[0] or key in seen:
            continue
        seen.add(key)
        merged.append(law)
    data["related_regulations"] = merged
    data["knowledge_graph_status"] = "linked" if graph_laws else "no_explicit_law_node"
    return payload


def create_chat() -> dict:
    """Create a new (untitled) Gemini chat room.

    Verified live against this tenant: POST /chat/create ignores any title
    and returns only {"status":"success","data":{"insertedId": "..."}}; the
    README's documented rename route (POST /chat/<id>/update) 404s on this
    tenant. So the new room comes back as Gemini's default "Untitled (...)"
    name — callers must track case -> chat_id themselves (_case_chat_map)
    rather than looking rooms up by title. Requires the same write scope as
    knowledge uploads, so callers must be ready to fall back gracefully on
    401/403."""
    request = urllib.request.Request(
        f"{PORTAL_API_BASE}/assistant/chat/create",
        data=b"{}",
        headers=portal_headers(content_type=True),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(MAX_CHAT_BYTES + 1)
    except urllib.error.HTTPError as error:
        detail = error.read(2048).decode("utf-8", errors="replace").strip()
        raise UpstreamError(f"Gemini Chat 建立失敗 HTTP {error.code}{f'：{detail}' if detail else ''}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise UpstreamError(f"Gemini Chat 建立無法連線：{error}") from error
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise UpstreamError("Gemini Chat 建立 API 未回傳有效 JSON") from error
    data = payload.get("data") if isinstance(payload, dict) else None
    chat_id = str(data.get("insertedId") or "") if isinstance(data, dict) else ""
    if not chat_id:
        raise UpstreamError("Gemini Chat 建立 API 未提供 insertedId")
    return {"_id": chat_id, "title": None}


def get_dashboard_chat(case_id: str | None = None) -> dict:
    """Resolve the chat room for a case. Each case gets its own room, tracked
    in _case_chat_map for this process's lifetime: reloading the page or
    switching cases and back returns to the same room (and its history);
    switching to a different case resolves to a different room, so analyses
    no longer bleed into each other. When no case_id is given (e.g. the
    cross-case dashboard), the original shared WORKSPACE_CHAT_TITLE room is
    used unchanged, looked up by title as before."""
    global _chat_create_available
    with _chat_lock:
        payload = portal_json("/assistant/chat/list")
        chats = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(chats, list) or not chats:
            raise UpstreamError("Gemini Chat API 沒有可用聊天室")

        if case_id:
            mapped_id = _case_chat_map.get(case_id)
            if mapped_id:
                selected = next((chat for chat in chats if str(chat.get("_id")) == mapped_id), None)
                if selected is not None:
                    return selected
                # Mapped room no longer exists upstream (e.g. deleted); fall
                # through and mint a new one.
            if _chat_create_available is not False:
                try:
                    selected = create_chat()
                    _chat_create_available = True
                    _case_chat_map[case_id] = str(selected["_id"])
                    return selected
                except UpstreamError as error:
                    if not _is_authorization_error(error):
                        raise
                    # No permission to create per-case chat rooms in this
                    # tenant; fall back to the shared room below instead of
                    # failing the request outright.
                    _chat_create_available = False

        selected = next(
            (chat for chat in chats if chat.get("title") == WORKSPACE_CHAT_TITLE),
            chats[0],
        )
        if not selected.get("_id"):
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


def ask_dashboard_chat(chat_id: str, question: str, case_id: str | None = None) -> dict:
    selected = get_dashboard_chat(case_id)
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
    # The SSE result belongs to this exact request. Chat history can contain
    # concurrent answers from other features sharing the workspace chat.
    answer = str(fallback or (answer_message or {}).get("content") or "").strip()
    if not answer:
        raise UpstreamError("Gemini Chat 已完成，但沒有可顯示的回答")
    return {
        "chat_id": chat_id,
        "chat_title": selected.get("title") or "Untitled",
        "message_id": message_id,
        "user_message_id": user_message_id,
        "answer": answer,
    }


_TRAILING_COMMA_RE = re.compile(r",(\s*[}\]])")


def _extract_json_object(text: str) -> str:
    """Pull the {...} JSON object out of a response that may have leading or
    trailing prose, or a code fence placed inconsistently around it. The
    prompt instructs the model to return pure JSON, but it doesn't always
    comply (e.g. "根據查詢結果...\n\n```json\n{...}\n```"); rather than fail
    the whole answer on that alone, take the outermost { ... } span."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise UpstreamError("AI 回傳不是純 JSON object")
    return text[start:end + 1]


_SINGLE_QUOTED_KEY_RE = re.compile(r"'([^'\"]*?)'(\s*:)")
_SINGLE_QUOTED_VALUE_RE = re.compile(r"(:\s*)'([^'\"]*?)'")
_LEADING_COMMA_RE = re.compile(r"([{\[])(\s*),")
_BARE_VALUE_RE = re.compile(r'(:\s*)([A-Za-z一-鿿][^",{}\[\]\n\r]*?)(\s*[,}\]])')


def _quote_bare_value(match: "re.Match[str]") -> str:
    pre, value, post = match.group(1), match.group(2), match.group(3)
    trimmed = value.strip()
    if trimmed in ("true", "false", "null"):
        return match.group(0)
    return f'{pre}"{trimmed}"{post}'


def _repair_json_text(text: str) -> str:
    """Punctuation-only auto-repairs for common LLM JSON mistakes observed
    live from this tenant's model — never invents or guesses content:
    1. A trailing comma before a closing bracket.
    2. A leading comma right after an opening bracket (e.g. "{ ,\"action\"...").
    3. Python/JS-style single-quoted keys or string values (e.g. 'action_item':
       'X') instead of JSON's required double quotes — the model occasionally
       drifts into this mid-object on deeply nested fields.
    4. A bare/unquoted placeholder value (e.g. "basis": 待補,) — quoting the
       model's own token (rather than guessing a value) fixes the "Expecting
       value" errors seen from this tenant's model.
    5. Curly/smart quotes (" " ' ') in place of the straight quotes JSON
       requires — observed live, the model sometimes switches to typographic
       quotes near the end of a long response.
    6. A whole-line "// comment" (JS-style) the model occasionally inserts
       between array elements — JSON has no comment syntax. Only strips
       lines that are entirely a comment, so a legitimate string value
       containing "//" (e.g. a URL) on the same line as content is untouched."""
    text = text.replace("“", '"').replace("”", '"')
    text = text.replace("‘", "'").replace("’", "'")
    text = re.sub(r"^[ \t]*//.*$", "", text, flags=re.MULTILINE)
    text = _TRAILING_COMMA_RE.sub(r"\1", text)
    text = _LEADING_COMMA_RE.sub(r"\1", text)
    text = _SINGLE_QUOTED_VALUE_RE.sub(r'\1"\2"', _SINGLE_QUOTED_KEY_RE.sub(r'"\1"\2', text))
    text = _BARE_VALUE_RE.sub(_quote_bare_value, text)
    return text


def _repair_json_candidates(text: str) -> list[str]:
    repaired = _repair_json_text(text)
    return [repaired] if repaired != text else []


def _parse_json_leniently(text: str) -> dict:
    """Parse JSON, falling back through auto-repairs for common LLM JSON
    mistakes before giving up. Any answer that's still broken after that
    fails loudly — this never invents or guesses content."""
    try:
        return json.loads(text)
    except json.JSONDecodeError as first_error:
        last_error = first_error
        for candidate in _repair_json_candidates(text):
            try:
                return json.loads(candidate)
            except json.JSONDecodeError as candidate_error:
                last_error = candidate_error
        # 部分 Windows 主控台預設編碼（如 cp1252）無法顯示中文字元，若直接 print
        # 會讓 UnicodeEncodeError 蓋掉真正的 JSON 錯誤；改用可安全編碼的字串再輸出。
        safe_text = text.encode(sys.stdout.encoding or "utf-8", errors="replace").decode(sys.stdout.encoding or "utf-8", errors="replace")
        print(f"AI JSON 解析失敗，原始回應內容：{safe_text}")
        raise UpstreamError(f"AI JSON 解析失敗：{last_error}") from last_error


def validate_ai_json_contract(answer: str, expected_feature: str) -> dict:
    """Validate structured AI output before it reaches a JSON-driven UI."""
    if not expected_feature:
        raise UpstreamError("缺少預期功能名稱")
    text = _extract_json_object(answer.strip())
    payload = _parse_json_leniently(text)
    if not isinstance(payload, dict):
        raise UpstreamError("AI JSON 根節點必須是 object")
    if payload.get("schema_version") != "1.0":
        raise UpstreamError("AI JSON schema_version 不符")
    if payload.get("feature") != expected_feature:
        raise UpstreamError("AI JSON feature 不符")
    if payload.get("status") not in {"success", "not_found", "insufficient_data"}:
        raise UpstreamError("AI JSON status 無效")
    if not isinstance(payload.get("warnings"), list):
        raise UpstreamError("AI JSON warnings 必須是 array")
    if payload.get("status") == "success" and not isinstance(payload.get("data"), dict):
        raise UpstreamError("AI JSON 缺少 data")
    if expected_feature == "financial_risk_estimation":
        data = payload.get("data")
        if not isinstance(data, dict):
            raise UpstreamError("財務風險 JSON 缺少 data")
        required = {
            "settlement_estimate", "regulatory_fine_estimate", "regulatory_assessment",
            "confidence", "methodology", "missing_inputs",
        }
        missing = required - set(data)
        if missing:
            raise UpstreamError(f"財務風險 JSON 缺少欄位：{', '.join(sorted(missing))}")
        regulatory = data.get("regulatory_assessment")
        if not isinstance(regulatory, dict):
            raise UpstreamError("財務風險 JSON regulatory_assessment 格式錯誤")
        regulatory_required = {
            "trigger_status", "possible_violations", "statutory_fine_range",
            "comparable_penalty_range", "risk_scenario", "most_likely_range",
            "missing_evidence",
        }
        regulatory_missing = regulatory_required - set(regulatory)
        if regulatory_missing:
            raise UpstreamError(f"監理評估 JSON 缺少欄位：{', '.join(sorted(regulatory_missing))}")
        if not isinstance(regulatory.get("possible_violations"), list) or not isinstance(regulatory.get("missing_evidence"), list):
            raise UpstreamError("監理評估清單欄位格式錯誤")
        settlement = data.get("settlement_estimate")
        if isinstance(settlement, dict) and settlement.get("estimate_type") == "disputed_amount_upper_bound" and not str(settlement.get("basis") or "").strip():
            raise UpstreamError("settlement_estimate 使用 disputed_amount_upper_bound 時必須說明 basis")
        # 評議書是消費爭議評議結果，不是主管機關對業者的正式裁罰；模型偶爾會把評議書
        # 的爭議/賠付金額誤標為 comparable_penalty_range 或 statutory_fine_range 的裁罰
        # 案例，兩者資料性質完全不同，絕不能混用。實測發現模型有時只寫出評議書文號
        # （如「115評001286」），不附上「評議書」這個詞，所以除了關鍵字本身，也要
        # 比對評議書文號的格式特徵（民國年+評+流水號），避免同一種幻覺換個寫法就漏檢。
        evaluation_report_number_re = re.compile(r"\d{2,3}\s*評\s*\d{3,}")
        for key in ("statutory_fine_range", "comparable_penalty_range", "most_likely_range"):
            basis_text = str((regulatory.get(key) or {}).get("basis") or "")
            if "評議書" in basis_text or evaluation_report_number_re.search(basis_text):
                raise UpstreamError(f"{key} 的 basis 引用評議書（消費爭議評議結果）而非正式裁罰案例，兩者性質不同，不得混用")
        most_likely = regulatory.get("most_likely_range")
        has_most_likely_range = (
            isinstance(most_likely, dict)
            and most_likely.get("min") is not None
            and most_likely.get("max") is not None
        )
        # trigger_status=not_identified 代表「已確認無違規」，是明確結論而非資料缺口，
        # 此時 missing_evidence 可以合理為空；只有 potential/highly_likely 才要求說明缺什麼。
        requires_missing_evidence = not has_most_likely_range and regulatory.get("trigger_status") != "not_identified"
        if requires_missing_evidence and not [item for item in regulatory.get("missing_evidence", []) if item]:
            raise UpstreamError("監理評估 most_likely_range 缺值時，missing_evidence 不得為空")
    if payload.get("status") == "success":
        data = payload["data"]
        required_data_keys = {
            "case_lookup": {"case_id", "summary", "related_regulations"},
            "financial_risk_estimation": {"settlement_estimate", "regulatory_fine_estimate", "regulatory_assessment", "confidence", "methodology", "missing_inputs"},
            "case_assistant": {"confirmed_facts", "inferences", "legal_issues", "missing_evidence", "recommended_actions"},
            "dashboard_overview": {"enterprise_risk", "avoidable_exposure", "kpis", "primary_signal", "trend", "high_risk_cases", "recommended_actions"},
            "dashboard_insight": {"target_id", "title", "metric", "cause_analysis", "evidence", "recommended_action"},
            "dashboard_assistant": {"decision_summary", "reasons", "recommended_actions", "related_kpis", "related_case_ids"},
            "document_generation": {"document_type", "title", "metadata", "sections", "review_notice"},
        }
        missing = required_data_keys.get(expected_feature, set()) - set(data)
        if missing:
            raise UpstreamError(f"AI JSON data 缺少欄位：{', '.join(sorted(missing))}")
        if expected_feature in {"case_assistant", "dashboard_assistant"}:
            has_answer = isinstance(payload.get("answer"), str) and bool(payload["answer"].strip())
            # Observed live: the model sometimes files the real analysis into
            # `data`'s structured fields and leaves `answer` null even when
            # status is "success". That's still a usable response — the
            # frontend synthesizes a display answer from `data` in that case
            # (see synthesizeCaseAssistantAnswer in workspace.js) — so only
            # reject when BOTH answer and data are empty.
            if not has_answer and not data:
                raise UpstreamError("AI JSON 缺少 answer")
        array_fields = {
            "case_lookup": ("summary", "related_regulations"),
            "case_assistant": ("confirmed_facts", "inferences", "legal_issues", "missing_evidence", "recommended_actions"),
            "dashboard_overview": ("high_risk_cases", "recommended_actions"),
            "dashboard_assistant": ("reasons", "recommended_actions", "related_kpis", "related_case_ids"),
            "document_generation": ("metadata", "sections"),
        }
        for field in array_fields.get(expected_feature, ()):
            if not isinstance(data.get(field), list):
                raise UpstreamError(f"AI JSON data.{field} 必須是 array")
    return payload


def _roc_date_to_iso(value: str) -> str | None:
    """Convert a Republic of China date such as 115.08.05 to ISO 8601."""
    match = re.fullmatch(r"\s*(\d{2,3})[./-](\d{1,2})[./-](\d{1,2})\s*", value)
    if not match:
        return None
    year, month, day = (int(part) for part in match.groups())
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return None
    return f"{year + 1911:04d}-{month:02d}-{day:02d}"


def parse_dispute_case_table(answer: str) -> list[dict]:
    """Extract verified case rows from Gemini's Markdown/full-width table output.

    The upstream service sometimes mixes ASCII and full-width pipes/spaces.  Only
    rows with an explicit assessment document number are accepted; incomplete
    continuation rows are deliberately ignored instead of being guessed.
    """
    cases: list[dict] = []
    case_indexes: dict[str, int] = {}
    for raw_line in answer.splitlines():
        line = unicodedata.normalize("NFKC", raw_line).replace("｜", "|").replace("\u00a0", " ").replace("\u3000", " ").strip()
        if "|" not in line:
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) < 5:
            continue
        case_match = re.search(r"\d{3}評\d{6}", cells[0])
        if not case_match:
            continue
        case_id = case_match.group(0)
        date = _roc_date_to_iso(cells[1]) if len(cells) > 1 else None
        industry = cells[2] or None if len(cells) > 2 else None
        amount_text = cells[3] if len(cells) > 3 else ""
        amount_match = re.search(r"\d[\d,]*", amount_text.replace(" ", ""))
        amount = int(amount_match.group(0).replace(",", "")) if amount_match else None
        keywords = cells[4] or None if len(cells) > 4 else None
        result = " | ".join(cells[5:]).strip() or None if len(cells) > 5 else None
        candidate = {
            "case_id": case_id,
            "date": date,
            "industry": industry,
            "amount": amount,
            "keywords": keywords,
            "result": result,
        }
        if case_id not in case_indexes:
            case_indexes[case_id] = len(cases)
            cases.append(candidate)
            continue
        existing_index = case_indexes[case_id]
        existing = cases[existing_index]
        existing_score = sum(existing.get(field) is not None for field in ("date", "industry", "amount", "keywords", "result"))
        candidate_score = sum(candidate.get(field) is not None for field in ("date", "industry", "amount", "keywords", "result"))
        if candidate_score > existing_score:
            cases[existing_index] = candidate
        else:
            for field in ("date", "industry", "amount", "keywords", "result"):
                if existing.get(field) is None and candidate.get(field) is not None:
                    existing[field] = candidate[field]
    return cases


def build_dashboard_overview_from_cases(answer: str, period_label: str = "近 14 天") -> dict:
    """Build dashboard metrics deterministically from retrieved assessment rows."""
    cases = parse_dispute_case_table(answer)
    if not cases:
        raise UpstreamError("Gemini 已回覆，但找不到可辨識的評議案件表格")

    dated_cases = [case for case in cases if case["date"]]
    dates = sorted({case["date"] for case in dated_cases})
    trend_values = [sum(case["date"] == date for case in dated_cases) for date in dates]
    amounts = [case["amount"] for case in cases if isinstance(case["amount"], int)]
    total_amount = sum(amounts)

    keyword_counts: dict[str, int] = {}
    for case in cases:
        first_keyword = re.split(r"[;；・、]", case["keywords"] or "")[0].strip()
        if first_keyword:
            keyword_counts[first_keyword] = keyword_counts.get(first_keyword, 0) + 1
    primary_keyword = max(keyword_counts, key=keyword_counts.get) if keyword_counts else "金融消費爭議"
    primary_count = keyword_counts.get(primary_keyword, len(cases))

    ranked_cases = sorted(
        (case for case in cases if isinstance(case["amount"], int)),
        key=lambda case: case["amount"],
        reverse=True,
    )[:5]
    high_risk_cases = [{
        "case_id": case["case_id"],
        "dispute_type": case["keywords"],
        "deadline": None,
        "remaining_days": None,
        "exposure": {"min": case["amount"], "max": case["amount"], "currency": "TWD"},
        "owner": None,
    } for case in ranked_cases]

    warnings = [
        "SLA、負責人、法規改善期限屬內部資料，外部評議案件未提供，相關欄位維持空值。",
        "高風險案件清單僅依已揭露涉案金額排序，不代表正式風險分級。",
    ]
    incomplete = sum(not case["date"] or case["amount"] is None for case in cases)
    if incomplete:
        warnings.append(f"{incomplete} 筆案件缺少日期或涉案金額；統計只納入可驗證欄位。")

    return {
        "schema_version": "1.0",
        "feature": "dashboard_overview",
        "status": "success",
        "as_of": dates[-1] if dates else None,
        "period": {"label": period_label, "start": dates[0] if dates else None, "end": dates[-1] if dates else None},
        "data": {
            "enterprise_risk": {
                "score": None,
                "label": f"已載入 {len(cases)} 件外部評議案件",
                "primary_driver": f"{primary_keyword}為最常見首要關鍵字（{primary_count} 件）",
            },
            "avoidable_exposure": {"min": None, "max": None, "currency": "TWD", "confidence": None},
            "kpis": {
                "new_high_risk_events": {"value": len(cases), "change_rate": None},
                "financial_exposure": {"min": total_amount, "max": total_amount, "currency": "TWD", "case_count": len(amounts)},
                "sla_risk": {"case_count": None, "urgent_case_count": None},
                "regulatory_gaps": {"count": None, "nearest_deadline_days": None},
            },
            "primary_signal": {
                "signal_id": "external-assessment-cases",
                "title": f"{primary_keyword}爭議案件",
                "summary": f"{period_label}共檢索到 {len(cases)} 件可辨識評議案件；{len(amounts)} 件揭露金額合計 NT$ {total_amount:,}。",
                "confidence": None,
                "affected_departments": [],
                "evidence_gaps": ["外部資料未提供內部承辦部門、SLA 與改善進度"],
            },
            "trend": {"labels": dates, "values": trend_values, "unit": "cases"},
            "high_risk_cases": high_risk_cases,
            "recommended_actions": [],
        },
        "citations": [{"title": "Gemini Data 知識庫評議案件檢索結果", "source_id": "gemini-chat"}],
        "warnings": warnings,
    }


def download_source_csv(source_id: str) -> tuple[list[dict[str, str]], list[str]]:
    """Download a Gemini CSV Source through its authenticated signed-URL contract."""
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
    return rows, list(rows[0].keys())


def _load_case_database_rows() -> list[dict[str, str]]:
    """Download (or reuse the cached) raw rows of the authoritative Case Source."""
    cache_key = f"case-database:{CASE_DATABASE_SOURCE_ID}"
    with _cache_lock:
        cached = _cache.get(cache_key)
        cached_payload = cached[1] if cached and time.time() - cached[0] < CACHE_SECONDS else None
    if cached_payload:
        return cached_payload["rows"]
    rows, columns = download_source_csv(CASE_DATABASE_SOURCE_ID)
    required_columns = set(CASE_DATABASE_COLUMNS)
    if not required_columns.issubset(columns):
        missing = sorted(required_columns - set(columns))
        raise UpstreamError(f"Case Source 缺少欄位：{', '.join(missing)}")
    with _cache_lock:
        _cache[cache_key] = (time.time(), {"rows": rows, "columns": columns})
    return rows


def fetch_case_database_cases(query: str) -> list[dict]:
    """Resolve case IDs directly from the authoritative Case Source, without AI."""
    normalized = query.strip().upper()
    if not normalized:
        return []
    rows = _load_case_database_rows()
    matches = [row for row in rows if str(row.get("Case") or "").strip().upper() == normalized]
    return [normalize_case_database_row(row) for row in matches]


_COMPARABLE_CASE_STOPWORDS = {"爭議", "案件", "案", "糾紛", "問題", "投訴", "申訴"}


def _tokenize_for_comparable_match(*fields: str) -> set[str]:
    """Break case_type/dispute_item text into short substrings usable as a
    naive keyword-overlap signal — this tenant's Case Source has no reliable
    tokenizer, so 2-char sliding windows over the (non-stopword) text is the
    simplest thing that actually matches Chinese phrases like 信用卡/行動支付."""
    tokens: set[str] = set()
    for field in fields:
        text = re.sub(r"[\s,、;；/()（）\-]+", "", str(field or ""))
        for stopword in _COMPARABLE_CASE_STOPWORDS:
            text = text.replace(stopword, "")
        for size in (2, 3, 4):
            tokens.update(text[i:i + size] for i in range(len(text) - size + 1))
    return {token for token in tokens if len(token) >= 2}


def enrich_financial_risk_question(question: str, case_id: str | None) -> str:
    """Deterministically inject comparable Case Source rows into the
    financial_risk_estimation prompt so the model doesn't have to rely on its
    own retrieval to find them — verified live, that retrieval can miss a
    comparable case even when it demonstrably exists in the same source."""
    if not case_id:
        return question
    try:
        current = get_workspace_cases(case_id)
    except UpstreamError:
        return question
    if not current:
        return question
    case_type = current[0].get("type") or ""
    dispute_item = current[0].get("item") or ""
    comparable = find_comparable_cases(case_type, dispute_item, exclude_case_id=case_id)
    if not comparable:
        return question
    block = [{
        "case_id": c["id"],
        "case_type": c["type"],
        "dispute_item": c["item"],
        "outcome": c["status"],
        "dispute_amount": c["disputeAmount"],
        "related_regulations": [law["title"] for law in c.get("laws", [])],
    } for c in comparable]
    return (
        f"{question}\n\n"
        "【已由資料庫直接比對之同態樣案件（非 Chat 自行檢索——系統依本案 case_type/dispute_item "
        "關鍵字，直接比對 Case 資料庫欄位所得之結果，屬已驗證資料，判斷時應優先使用，不需要再自行檢索）】\n"
        f"{json.dumps(block, ensure_ascii=False)}"
    )


def find_comparable_cases(case_type: str, dispute_item: str, *, exclude_case_id: str | None = None, limit: int = 5) -> list[dict]:
    """Deterministically find Case Source rows with an overlapping case_type/
    dispute_item, without relying on the Chat's own (unreliable) retrieval —
    verified live: the Chat's structured JSON task can fail to surface a
    comparable case even when it demonstrably exists in this same source."""
    query_tokens = _tokenize_for_comparable_match(case_type, dispute_item)
    if not query_tokens:
        return []
    rows = _load_case_database_rows()
    excluded = (exclude_case_id or "").strip().upper()
    scored: list[tuple[int, dict]] = []
    for row in rows:
        row_case_id = str(row.get("Case") or "").strip().upper()
        if excluded and row_case_id == excluded:
            continue
        row_tokens = _tokenize_for_comparable_match(row.get("Product"), row.get("Dispute"))
        score = len(query_tokens & row_tokens)
        if score > 0:
            scored.append((score, row))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [normalize_case_database_row(row) for _, row in scored[:limit]]


def compute_case_risk_kpis(rows: list[dict[str, str]]) -> dict:
    """Deterministically derive two dashboard KPIs from the Case Source's disclosed
    dispute amounts — no AI involved, so the numbers are reproducible and auditable.

    "High risk" is defined as: disclosed amount at or above the Q3 (upper quartile)
    of all disclosed amounts in the case pool. This is a standard outlier-flagging
    heuristic, not a regulatory risk rating.
    """
    amounts = []
    for row in rows:
        parsed = _parse_twd_amount(str(row.get("涉案金額") or ""))
        if parsed["value"] is not None:
            amounts.append(parsed["value"])
    total_exposure = sum(amounts)
    if len(amounts) >= 4:
        q3 = statistics.quantiles(amounts, n=4, method="inclusive")[-1]
    elif amounts:
        q3 = max(amounts)
    else:
        q3 = None
    high_risk_count = sum(1 for value in amounts if q3 is not None and value >= q3)
    return {
        "new_high_risk_events": {
            "value": high_risk_count,
            "method": "q3_disclosed_amount",
            "threshold": q3,
            "sample_size": len(rows),
            "amount_count": len(amounts),
        },
        "financial_exposure": {
            "min": total_exposure if amounts else None,
            "max": total_exposure if amounts else None,
            "currency": "TWD",
            "case_count": len(amounts),
        },
    }


def get_workspace_cases(query: str = "") -> list[dict]:
    local_cases = find_workspace_cases(query)
    if local_cases or not query.strip():
        return local_cases
    return fetch_case_database_cases(query)


def fetch_source(source_id: str) -> dict:
    if source_id not in SOURCE_CATALOG:
        raise KeyError(source_id)
    with _cache_lock:
        cached = _cache.get(source_id)
        if cached and time.time() - cached[0] < CACHE_SECONDS:
            return {**cached[1], "cache": "hit"}

    rows, columns = download_source_csv(source_id)

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


def _dashboard_number(value: object) -> int:
    text = str(value or "0").replace(",", "").strip()
    try:
        return int(float(text))
    except ValueError:
        return 0


def normalize_dashboard_source(source: dict) -> dict:
    """Normalize either supported Source schema without inventing missing values."""
    rows = source.get("rows")
    if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
        raise UpstreamError("Dashboard Source 沒有可用資料列")
    first = rows[0]
    period_start = str(first.get("日期(起)") or "").strip() or None
    period_end = str(first.get("日期(迄)") or "").strip() or None
    common = {
        "source_id": str(source.get("source_id") or ""),
        "industry": str(source.get("industry") or "未分類"),
        "label": str(source.get("label") or "未命名來源"),
        "period_start": period_start,
        "period_end": period_end,
        "fetched_at": source.get("fetched_at"),
    }
    if "爭議類型" in first:
        items = [{
            "name": str(row.get("爭議類型") or "").strip(),
            "complaints": _dashboard_number(row.get("申訴件數")),
            "mediation": _dashboard_number(row.get("評議件數")),
            "total": _dashboard_number(row.get("合計")),
            "ratio": str(row.get("案件比率") or "").strip() or None,
        } for row in rows if str(row.get("爭議類型") or "").strip()]
        if not items:
            raise UpstreamError("Dashboard Source 爭議類型欄位沒有可用資料")
        return {
            **common,
            "kind": "dispute",
            "items": items,
            "complaints": sum(item["complaints"] for item in items),
            "mediation": sum(item["mediation"] for item in items),
            "total": sum(item["total"] for item in items),
        }
    if "爭議對象" in first:
        count_column = "申請評議件數" if "申請評議件數" in first else "申訴件數"
        ratio_column = next((column for column in first if "比率" in column or "申訴率" in column), None)
        items = [{
            "name": str(row.get("爭議對象") or "").strip(),
            "total": _dashboard_number(row.get(count_column)),
            "ratio": str(row.get(ratio_column) or "").strip() or None if ratio_column else None,
        } for row in rows if str(row.get("爭議對象") or "").strip()]
        if not items:
            raise UpstreamError("Dashboard Source 爭議對象欄位沒有可用資料")
        return {**common, "kind": "company", "items": items}
    raise UpstreamError("Dashboard Source schema 不受支援")


def _dashboard_period_label(start: str | None, end: str | None) -> str:
    if start and end and re.fullmatch(r"\d{8}", start) and re.fullmatch(r"\d{8}", end):
        start_year, start_month = int(start[:4]), int(start[4:6])
        end_year, end_month = int(end[:4]), int(end[4:6])
        start_quarter = (start_month - 1) // 3 + 1
        end_quarter = (end_month - 1) // 3 + 1
        if start_year == end_year and start_quarter == end_quarter:
            return f"{start_year} Q{start_quarter}"
    return f"{start or '未知'}–{end or '未知'}"


def build_dashboard_overview_from_sources(
    sources: list[dict], *, expected_source_count: int, source_errors: list[dict] | None = None,
) -> dict:
    normalized = [normalize_dashboard_source(source) for source in sources]
    disputes = [source for source in normalized if source["kind"] == "dispute"]
    companies = [source for source in normalized if source["kind"] == "company"]
    if not normalized:
        raise UpstreamError("所有 Dashboard Source 均無法使用")

    period_starts = [source["period_start"] for source in normalized if source["period_start"]]
    period_ends = [source["period_end"] for source in normalized if source["period_end"]]
    period_start = min(period_starts) if period_starts else None
    period_end = max(period_ends) if period_ends else None
    complaint_total = sum(source["complaints"] for source in disputes)
    mediation_total = sum(source["mediation"] for source in disputes)
    external_total = sum(source["total"] for source in disputes)
    top_disputes = sorted(({
        "source_id": source["source_id"],
        "industry": source["industry"],
        **item,
    } for source in disputes for item in source["items"]), key=lambda item: item["total"], reverse=True)[:5]
    company_benchmarks = sorted(({
        "source_id": source["source_id"],
        "industry": source["industry"],
        "metric": source["label"],
        **item,
    } for source in companies for item in source["items"]), key=lambda item: item["total"], reverse=True)[:5]
    errors = source_errors or []
    loaded = len(normalized)
    coverage_rate = loaded / expected_source_count if expected_source_count else 1.0
    status = "success" if not errors and loaded == expected_source_count else "partial"
    top = top_disputes[0] if top_disputes else None
    warnings = [
        "此 Dashboard 僅呈現 Gemini Data Source 的外部彙總統計，不代表本公司內部風險、SLA 或財務曝險。",
    ]
    if errors:
        warnings.append(f"{len(errors)} 個正式來源無法載入；其餘來源仍可使用。")
    return {
        "schema_version": "1.0",
        "feature": "dashboard_source_overview",
        "status": status,
        "cache_status": "live",
        "as_of": max((str(source.get("fetched_at") or "") for source in normalized), default="") or None,
        "period": {"start": period_start, "end": period_end, "label": _dashboard_period_label(period_start, period_end)},
        "data": {
            "summary": {
                "label": "外部產業統計",
                "description": f"已驗證 {loaded}/{expected_source_count} 個正式資料來源",
                "primary_driver": f"{top['industry']}－{top['name']}為最高件數分類（{top['total']:,} 件）" if top else "目前沒有可比較的爭議分類",
            },
            "kpis": {
                "external_complaints": {"value": complaint_total},
                "external_mediations": {"value": mediation_total},
                "external_total": {"value": external_total},
                "source_coverage": {"loaded": loaded, "expected": expected_source_count, "rate": round(coverage_rate, 6)},
            },
            "primary_signal": {
                "title": f"{top['industry']}－{top['name']}" if top else "尚無外部爭議分類",
                "summary": f"統計期間 {_dashboard_period_label(period_start, period_end)}；最高分類共 {top['total']:,} 件。" if top else "正式來源未提供可比較的爭議分類。",
                "industry": top["industry"] if top else None,
                "category": top["name"] if top else None,
                "source_id": top["source_id"] if top else None,
            },
            "top_disputes": top_disputes,
            "company_benchmarks": company_benchmarks,
            "unavailable_internal_metrics": [
                "enterprise_risk_score", "avoidable_exposure", "sla_risk", "regulatory_gaps", "internal_case_ranking",
            ],
        },
        "sources": [{
            "source_id": source["source_id"], "industry": source["industry"], "label": source["label"],
            "kind": source["kind"], "period_start": source["period_start"], "period_end": source["period_end"],
        } for source in normalized],
        "source_errors": errors,
        "warnings": warnings,
    }


def clear_dashboard_overview_cache() -> None:
    global _dashboard_overview_cache
    with _dashboard_overview_cache_lock:
        _dashboard_overview_cache = None


def get_dashboard_source_overview(
    *, source_ids: tuple[str, ...] | None = None, source_fetcher=None,
) -> dict:
    global _dashboard_overview_cache
    selected_ids = source_ids or tuple(SOURCE_CATALOG)
    fetcher = source_fetcher or fetch_source
    sources: list[dict] = []
    errors: list[dict] = []
    for source_id in selected_ids:
        try:
            source = fetcher(source_id)
            normalize_dashboard_source(source)
            sources.append(source)
        except Exception as error:
            errors.append({"source_id": source_id, "message": str(error)})
    if sources:
        payload = build_dashboard_overview_from_sources(
            sources, expected_source_count=len(selected_ids), source_errors=errors,
        )
        try:
            payload["data"]["kpis"].update(compute_case_risk_kpis(_load_case_database_rows()))
        except UpstreamError as error:
            payload["data"]["kpis"]["new_high_risk_events"] = {"value": None}
            payload["data"]["kpis"]["financial_exposure"] = {"min": None, "max": None, "currency": "TWD"}
            payload["warnings"].append(f"案件風險指標無法取得：{error}")
        if not errors:
            with _dashboard_overview_cache_lock:
                _dashboard_overview_cache = copy.deepcopy(payload)
        return payload
    with _dashboard_overview_cache_lock:
        cached = copy.deepcopy(_dashboard_overview_cache)
    if cached:
        cached["status"] = "partial"
        cached["cache_status"] = "last_known_good"
        cached["source_errors"] = errors
        cached["warnings"] = list(cached.get("warnings") or []) + ["即時來源全部失敗，目前顯示最近一次完整驗證資料。"]
        return cached
    raise UpstreamError("所有 Dashboard Source 均無法載入，且沒有最近一次成功快取")


class DashboardHandler(SimpleHTTPRequestHandler):
    server_version = "ComplianceGenieDemo/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PROJECT_ROOT), **kwargs)

    def end_headers(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        if not path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def send_json(self, status: HTTPStatus, payload: dict) -> None:
        # A client that navigates away or closes the tab mid-response aborts
        # the socket; that is not a server bug and must not surface as an
        # unhandled traceback (or worse, a second one from the error-path
        # handler retrying the write on an already-dead connection).
        try:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, OSError):
            pass

    def send_chat_sse(self, payload: dict) -> None:
        try:
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
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, OSError):
            pass

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        if path == "/api/health":
            self.send_json(HTTPStatus.OK, {
                "status": "ok",
                "service": "analytical-dashboard-bff",
                "api_base": API_BASE,
                "token_configured": bool(os.environ.get("GEMINI_API_TOKEN", "").strip()),
            })
            return
        if path == "/api/workspace/cases":
            try:
                query = urllib.parse.parse_qs(parsed_url.query).get("q", [""])[0]
                self.send_json(HTTPStatus.OK, {"status": "ok", "data": get_workspace_cases(query)})
            except UpstreamError as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"status": "error", "message": str(error)})
            except (OSError, UnicodeError, ValueError) as error:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"status": "error", "message": str(error)})
            return
        if path == "/api/dashboard/overview":
            try:
                self.send_json(HTTPStatus.OK, get_dashboard_source_overview())
            except UpstreamError as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"status": "error", "message": str(error)})
            except Exception:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"status": "error", "message": "Dashboard 聚合處理失敗"})
            return
        if path == "/api/dashboard/case-sample":
            try:
                count_param = urllib.parse.parse_qs(parsed_url.query).get("count", ["10"])[0]
                count = max(1, min(int(count_param), 25)) if count_param.isdigit() else 10
                rows = _load_case_database_rows()
                sample = random.sample(rows, min(count, len(rows)))
                cases = [normalize_case_database_row(row) for row in sample]
                self.send_json(HTTPStatus.OK, {
                    "status": "ok",
                    "data": [{
                        "case_id": case["id"],
                        "dispute": case["item"],
                        "product": case["type"],
                        "outcome": case["status"],
                        "text_context": case["textContext"],
                    } for case in cases],
                })
            except UpstreamError as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"status": "error", "message": str(error)})
            except Exception:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"status": "error", "message": "無法取得案件抽樣"})
            return
        if path == "/api/chat/session":
            try:
                case_id = urllib.parse.parse_qs(parsed_url.query).get("case_id", [""])[0].strip() or None
                chat = get_dashboard_chat(case_id)
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
        if path == "/api/chat/history":
            try:
                chat_id = urllib.parse.parse_qs(parsed_url.query).get("chat_id", [""])[0].strip()
                if not chat_id:
                    self.send_json(HTTPStatus.BAD_REQUEST, {"status": "error", "message": "缺少 chat_id"})
                    return
                self.send_json(HTTPStatus.OK, {"status": "ok", "data": fetch_chat_messages(chat_id)})
            except UpstreamError as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"status": "error", "message": str(error)})
            except Exception:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"status": "error", "message": "無法取得對話紀錄"})
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

        validation_prefix = "/api/v1/chat/"
        if path.startswith(validation_prefix) and path.endswith("/validation"):
            parts = path.strip("/").split("/")
            if len(parts) >= 6:
                chat_id = urllib.parse.unquote(parts[3])
                message_id = urllib.parse.unquote(parts[4])
                try:
                    if message_id == "latest":
                        messages = fetch_chat_messages(chat_id)
                        answer_message = next(
                            (msg for msg in reversed(messages) if msg.get("role") in {"ai", "assistant"}),
                            None,
                        )
                        if answer_message:
                            message_id = answer_message.get("_id") or answer_message.get("id") or answer_message.get("message_id")

                    if not message_id or message_id == "latest":
                        self.send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "找不到對應的 Message ID"})
                        return

                    url = f"{API_BASE}/chat/{urllib.parse.quote(chat_id, safe='')}/{urllib.parse.quote(message_id, safe='')}/validation"
                    body, _ = request_bytes(url, authenticated=True)
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(body)
                except UpstreamError as error:
                    self.send_json(HTTPStatus.BAD_GATEWAY, {"status": "error", "message": str(error)})
                except Exception as e:
                    self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"status": "error", "message": f"Validation fetching failed: {e}"})
            else:
                self.send_json(HTTPStatus.BAD_REQUEST, {"status": "error", "message": "Invalid validation URL"})
            return

        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/workspace/knowledge":
            try:
                content_type = self.headers.get("Content-Type", "application/octet-stream")
                content_length = int(self.headers.get("Content-Length", "0") or 0)
                if content_length <= 0 or content_length > MAX_UPLOAD_BYTES:
                    self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"status": "error", "message": "檔案為空或超過 10 MB"})
                    return
                encoded_file_name = self.headers.get("X-Upload-File-Name", "")
                original_file_name = Path(urllib.parse.unquote(encoded_file_name)).name
                if not original_file_name:
                    self.send_json(HTTPStatus.BAD_REQUEST, {"status": "error", "message": "缺少安全檔名"})
                    return
                result = upload_workspace_knowledge(
                    self.rfile.read(content_length),
                    content_type,
                    original_file_name,
                )
                self.send_json(HTTPStatus.OK, result)
            except UpstreamError as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"status": "error", "message": str(error)})
            except Exception:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"status": "error", "message": "檔案上傳處理失敗"})
            return
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
            expected_feature = str(payload.get("expected_feature") or "").strip()
            case_id = str(payload.get("case_id") or "").strip() or None
            if not question:
                self.send_json(HTTPStatus.BAD_REQUEST, {"status": "error", "message": "缺少問題內容"})
                return
            if expected_feature == "financial_risk_estimation":
                question = enrich_financial_risk_question(question, case_id)
            chat_result = ask_dashboard_chat(chat_id, question, case_id)
            if expected_feature:
                if expected_feature == "dashboard_overview":
                    period_match = re.search(r"查詢期間[：:]\s*([^\n]+)", question)
                    period_label = period_match.group(1).strip() if period_match else "近 14 天"
                    validated = build_dashboard_overview_from_cases(chat_result["answer"], period_label)
                else:
                    validated = validate_ai_json_contract(chat_result["answer"], expected_feature)
                    if expected_feature == "case_lookup" and chat_result.get("message_id"):
                        try:
                            validation_url = (
                                f"{API_BASE}/chat/{urllib.parse.quote(chat_id, safe='')}/"
                                f"{urllib.parse.quote(str(chat_result['message_id']), safe='')}/validation"
                            )
                            validation_body, _ = request_bytes(validation_url, authenticated=True)
                            validation = json.loads(validation_body.decode("utf-8"))
                            validated = enrich_case_lookup_with_validation(validated, validation)
                        except (UpstreamError, UnicodeDecodeError, json.JSONDecodeError) as error:
                            validated.setdefault("warnings", []).append(f"知識圖譜關聯讀取失敗：{error}")
                chat_result["answer"] = json.dumps(validated, ensure_ascii=False, separators=(",", ":"))
            self.send_chat_sse(chat_result)
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
    parser.add_argument("--workspace", choices=("analytical", "finance"), default="analytical")
    parser.add_argument("--open", action="store_true", help="Open the dashboard in the default browser")
    args = parser.parse_args()
    workspace_pages = {
        "analytical": "/pages/v2_workspace_analytical_finance.html",
        "finance": "/pages/v2_workspace_finance.html",
    }
    page_path = workspace_pages[args.workspace]
    url = f"http://{args.host}:{args.port}{page_path}"
    server = ThreadingHTTPServer((args.host, args.port), DashboardHandler)
    print(f"Compliance Genie demo ({args.workspace}): {url}")
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
