import requests
import json
import time
import sys

BASE_URL = "http://127.0.0.1:8765"

def safe_print(text):
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode('ascii', 'replace').decode('ascii'))

def test_health():
    safe_print("1. Testing /api/health")
    res = requests.get(f"{BASE_URL}/api/health")
    safe_print(f"Status: {res.status_code}")
    safe_print(json.dumps(res.json(), indent=2, ensure_ascii=False))
    return res.status_code == 200

def test_chat_session():
    safe_print("\n2. Testing /api/chat/session")
    res = requests.get(f"{BASE_URL}/api/chat/session")
    safe_print(f"Status: {res.status_code}")
    data = res.json()
    safe_print(json.dumps(data, indent=2, ensure_ascii=False))
    return data.get("chat_id") if res.status_code == 200 else None

def test_chat_message(chat_id):
    safe_print(f"\n3. Testing /api/chat/{chat_id}")
    payload = {"q": "hello"}
    res = requests.post(f"{BASE_URL}/api/chat/{chat_id}", json=payload, stream=True)
    safe_print(f"Status: {res.status_code}")
    msg_id = None
    for line in res.iter_lines():
        if line:
            line_str = line.decode('utf-8')
            safe_print(line_str)
            if line_str.startswith("data: ") and line_str != "data: [DONE]":
                try:
                    data = json.loads(line_str[6:])
                    msg_id = data.get("messageId")
                except:
                    pass
    return msg_id

def test_validation(chat_id, msg_id):
    safe_print(f"\n4. Testing /api/v1/chat/{chat_id}/{msg_id}/validation")
    res = requests.get(f"{BASE_URL}/api/v1/chat/{chat_id}/{msg_id}/validation")
    safe_print(f"Status: {res.status_code}")
    try:
        safe_print(json.dumps(res.json(), indent=2, ensure_ascii=False)[:500] + "...")
    except:
        safe_print(f"Response text: {res.text}")
    return res.status_code == 200

def test_sources():
    safe_print("\n5. Testing /api/analytics/sources/c6395b4c-9fbf-4a94-814d-fa89a9f5d179")
    res = requests.get(f"{BASE_URL}/api/analytics/sources/c6395b4c-9fbf-4a94-814d-fa89a9f5d179")
    safe_print(f"Status: {res.status_code}")
    if res.status_code == 200:
        data = res.json()
        safe_print(f"Source columns: {data.get('columns')}")
        return True
    return False

def main():
    safe_print("Testing Compliance Genie Analytics Server Proxy Endpoints...")
    if not test_health():
        safe_print("Health check failed. Is the server running?")
        sys.exit(1)
        
    chat_id = test_chat_session()
    if not chat_id:
        safe_print("Failed to get chat_id")
        sys.exit(1)
        
    msg_id = test_chat_message(chat_id)
    if not msg_id:
        safe_print("Failed to get messageId from chat POST response.")
        safe_print("Falling back to 'latest' for validation test.")
        msg_id = "latest"
        
    test_validation(chat_id, msg_id)
    test_sources()
    safe_print("\nDone testing APIs.")

if __name__ == "__main__":
    main()
