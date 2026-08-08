import requests
import json
import sys

BASE_URL = "http://127.0.0.1:8765"

def safe_print(text):
    try:
        print(text)
    except UnicodeEncodeError:
        print(str(text).encode('ascii', 'replace').decode('ascii'))

def test_c001_fetch():
    safe_print("Getting session...")
    res = requests.get(f"{BASE_URL}/api/chat/session")
    if res.status_code != 200:
        safe_print("Session failed")
        return
    chat_id = res.json().get("chat_id")
    safe_print(f"Chat ID: {chat_id}")

    prompt = """請在知識庫中檢索案號為「C001」的完整詳細資料。
請嚴格以 JSON 格式回傳，必須包含以下欄位：
{
  "id": "案號",
  "applicant": "當事人或客戶類型",
  "type": "案件類型與產業",
  "item": "爭議標的或主旨",
  "amount": "涉案金額",
  "created": "申請或發生日期 (YYYY-MM-DD)",
  "status": "目前狀態",
  "summary": ["事實摘要 1", "事實摘要 2"],
  "laws": [{"title": "法規名稱", "desc": "法規內容或說明"}],
  "textContext": "完整文字內容"
}
如果找不到該案號，請回傳 {"error": "not found"}。
請確保只回傳純 JSON 內容，不要包含 markdown code blocks (```) 或其他說明文字。"""

    safe_print("Sending POST request to chat API...")
    res = requests.post(f"{BASE_URL}/api/chat/{chat_id}", json={"q": prompt, "streaming": True})
    safe_print(f"Status: {res.status_code}")
    text = res.text
    safe_print(f"Raw response text length: {len(text)}")
    safe_print(f"Raw response preview: {text[:200]}")

    # Simulate JS parsing
    import re
    # use DOTALL in python equivalent to /s in JS? Wait, JS regex doesn't have /s in the original code!
    # /data:\s*({.*})/ does NOT have /s in workspace.js!
    match = re.search(r"data:\s*({.*})", text)
    if match:
        safe_print("Regex matched!")
        try:
            data = json.loads(match.group(1))
            answer = data.get("result", "")
            safe_print(f"Answer preview: {answer[:100]}")
            answer = re.sub(r"^```(?:json)?", "", answer, flags=re.IGNORECASE)
            answer = re.sub(r"```$", "", answer).strip()
            safe_print("Parsed Answer inside:")
            try:
                case_json = json.loads(answer)
                safe_print("Successfully parsed case JSON!")
                safe_print(json.dumps(case_json, indent=2, ensure_ascii=False))
            except Exception as e:
                safe_print(f"Failed to parse case JSON: {e}")
                safe_print(f"Cleaned answer was:\n{answer}")
        except Exception as e:
            safe_print(f"Failed to parse outer JSON: {e}")
    else:
        safe_print("Regex failed to match data payload!")

if __name__ == "__main__":
    test_c001_fetch()
