import sys
import time
import requests
import json
import argparse

API_BASE = "https://cloud.geminidata.com/api/portal/api10"
HARDCODED_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhNjE5ZjFiMDc2M2RlMDAyZDJmNjJmNiIsImlzQVBJIjp0cnVlLCJnX3VpZCI6IjZhNDNhMGVmMDc2M2RlMDAyZDI3ZTVjYyIsImdfYWRtaW4iOmZhbHNlLCJnX2RlbW9hZG1pbiI6ZmFsc2UsImdfYWNjb3VudGFkbWluIjpmYWxzZSwiZ190aWQiOiI2YTQzOWU2NzA3NjNkZTAwMmQyN2Q2YmQ6cHJvZHVjZXIiLCJnX3RpZF9wZXJtaXNzaW9uIjpbIm1ldGE6dXBkYXRlIiwic291cmNlOnJlYWQiLCJzb3VyY2U6dXBkYXRlIiwic291cmNlOmRlbGV0ZSIsImdyYXBoOnJlYWQiLCJncmFwaDp1cGRhdGUiLCJncmFwaDpkZWxldGUiLCJncmFwaDpleHBsb3JlIiwiZ3JhcGg6ZXhwb3J0IiwiY2FudmFzOmFubm90YXRlIiwiY2FudmFzOnBlcnNvbmFsaXplIiwiZGFzaGJvYXJkOnJlYWQiLCJkYXNoYm9hcmQ6dXBkYXRlIiwiY2FudmFzOnNoYXBlIl0sImdfdGlkX3BhcnNlcl9zb3VyY2UiOiJjc3YiLCJnX3RpZF9mZWF0dXJlX2FkZF9vbnMiOlsiYXNzaXN0YW50Il0sImdfYXZhdGFyIjoiMDIiLCJpc3MiOiJodHRwczovL2Nsb3VkLmdlbWluaWRhdGEuY29tIiwic3ViIjoiNmE0M2EwZWYwNzYzZGUwMDJkMjdlNWNjIiwiYXVkIjoiaHR0cHM6Ly9jbG91ZC5nZW1pbmlkYXRhLmNvbSIsImV4cCI6NDg2NjcwNTI4MiwiaWF0IjoxNzg0NzgyNjE5LCJuaWNrbmFtZSI6Im1lbWJlcjMzQDIwMjZzZWkuY29tIiwiZW1haWwiOiJtZW1iZXIzM0AyMDI2c2VpLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjpmYWxzZX0.DJJY-GARRczejSVR2ZaX93iUcLrGxUizZ8lvaoqiAZU"
TENANT_ID = "6a439e670763de002d27d6bd"

def get_headers(token=HARDCODED_TOKEN):
    headers = {
        'Content-Type': 'application/json',
        'x-application-tenant': TENANT_ID
    }
    if token:
        headers['Authorization'] = token if token.startswith('Bearer') else f'Bearer {token}'
    return headers

def extract_latest_msg_id(chat_id, token):
    url = f"{API_BASE}/assistant/chat/{chat_id}"
    try:
        res = requests.get(url, headers=get_headers(token))
        if res.status_code != 200:
            return None
        data = res.json()
        
        collections = [
            data.get('messages', []),
            data.get('data', {}).get('messages', []) if isinstance(data.get('data'), dict) else [],
            data.get('data', []) if isinstance(data.get('data'), list) else [],
            data.get('items', [])
        ]
        
        for col in collections:
            if isinstance(col, list) and len(col) > 0:
                for item in reversed(col):
                    if not isinstance(item, dict):
                        continue
                    msg_id = item.get('_id') or item.get('id') or item.get('message_id')
                    if msg_id and msg_id != 'latest':
                        return msg_id
    except Exception as e:
        print(f"Error extracting msg id: {e}")
    return None

def main():
    token = HARDCODED_TOKEN
    print("="*50)
    print("Starting API Test (Backend Connectivity Verification)")
    print("="*50)

    # 1. Get Chat ID
    print("\n[1] GET /assistant/chat/list")
    try:
        res = requests.get(f"{API_BASE}/assistant/chat/list", headers=get_headers(token))
        print(f"Status: {res.status_code}")
        if res.status_code != 200:
            print(f"Server response ({res.status_code}): {res.text[:500]}")
        data = res.json()
        chat_list = data.get('data', [])
        if not chat_list:
            print("FAILED: No chats found. Please create a chat first.")
            sys.exit(1)
        
        chat_id = chat_list[0].get('_id')
        print(f"SUCCESS. Chat ID: {chat_id}")
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)

    # Get initial message ID
    initial_msg_id = extract_latest_msg_id(chat_id, token)
    print(f"\nInitial Message ID: {initial_msg_id}")

    # 2. Ask Chat
    print("\n[2] POST /assistant/chat/{chat_id}")
    payload = {"question": "Backend connection test", "streaming": True}
    try:
        # stream=True in requests just delays downloading the body, but it's enough to test 502
        res = requests.post(f"{API_BASE}/assistant/chat/{chat_id}", json=payload, headers=get_headers(token), stream=True)
        print(f"Status: {res.status_code}")
        if res.status_code == 502:
            print("⚠️ 502 Bad Gateway detected. Proceeding to polling phase.")
        elif res.status_code >= 400:
            print(f"❌ POST Failed with status {res.status_code}")
    except Exception as e:
        print(f"❌ Error during POST: {e}")

    # Polling for new message
    print("\n[2.1] Polling for new message ID...")
    new_msg_id = None
    for i in range(15):
        print(f"Polling attempt {i+1}/15...")
        current_id = extract_latest_msg_id(chat_id, token)
        if current_id and current_id != 'latest' and current_id != initial_msg_id:
            new_msg_id = current_id
            print(f"✅ Success! New Message ID found: {new_msg_id}")
            break
        time.sleep(2)
        
    if not new_msg_id:
        print("❌ Timeout waiting for new message ID.")
        sys.exit(1)

    # 3. Summary
    print("\n[3] GET /assistant/chat/{chat_id}/summary?type=markdown")
    try:
        res = requests.get(f"{API_BASE}/assistant/chat/{chat_id}/summary?type=markdown", headers=get_headers(token))
        print(f"Status: {res.status_code}")
        if res.status_code == 404:
            print("⚠️ 404 Not found. Trying fallback path...")
            res = requests.get(f"{API_BASE}/assistant/chat/summary?chat_id={chat_id}&type=markdown", headers=get_headers(token))
            print(f"Fallback Status: {res.status_code}")
            print(res.text[:200] + "...")
        else:
            print(res.text[:200] + "...")
    except Exception as e:
        print(f"❌ Error: {e}")

    # 4. Chartgen
    print(f"\n[4] POST /assistant/chat/{{chat_id}}/{new_msg_id}/chartgen")
    try:
        res = requests.post(f"{API_BASE}/assistant/chat/{chat_id}/{new_msg_id}/chartgen", json={}, headers=get_headers(token))
        print(f"Status: {res.status_code}")
        print(res.text[:200] + "...")
    except Exception as e:
        print(f"❌ Error: {e}")

    # 5. Validation
    print(f"\n[5] GET /assistant/chat/{{chat_id}}/{new_msg_id}/validation")
    try:
        res = requests.get(f"{API_BASE}/assistant/chat/{chat_id}/{new_msg_id}/validation", headers=get_headers(token))
        print(f"Status: {res.status_code}")
        print(res.text[:200] + "...")
    except Exception as e:
        print(f"❌ Error: {e}")

    print("\n" + "="*50)
    print("Test Completed")
    print("="*50)

if __name__ == "__main__":
    main()
