import requests
from debug_api import HARDCODED_TOKEN, get_headers, API_BASE
import json

def test_validation():
    print("Getting chat list...")
    res = requests.get(f"{API_BASE}/assistant/chat/list", headers=get_headers(HARDCODED_TOKEN))
    data = res.json()
    chats = data.get("data", [])
    if not chats:
        print("No chats found")
        return
    
    chat_id = chats[0].get("_id")
    
    url = f"{API_BASE}/assistant/chat/{chat_id}/messages"
    res = requests.get(url, headers=get_headers(HARDCODED_TOKEN))
    
    data = res.json()
    msg_id = None
    if isinstance(data.get("data"), list) and len(data["data"]) > 0:
        for msg in reversed(data["data"]):
            if msg.get("role") in ["ai", "assistant"]:
                msg_id = msg.get("_id") or msg.get("message_id")
                break
                
    if not msg_id:
        print("Could not find ai msg_id")
        return
        
    print(f"Using msg_id: {msg_id}")
    
    # Try different endpoints
    endpoints = [
        f"{API_BASE}/assistant/chat/{chat_id}/{msg_id}/validation",
        f"https://cloud.geminidata.com/api/v1/chat/{chat_id}/{msg_id}/validation",
        f"https://cloud.geminidata.com/api/portal/api10/assistant/chat/{chat_id}/{msg_id}/validation",
        f"https://cloud.geminidata.com/api/portal/api10/chat/{chat_id}/{msg_id}/validation",
        f"https://cloud.geminidata.com/api/v1/chat/{chat_id}/messages/{msg_id}/validation"
    ]
    
    for url in endpoints:
        print(f"\nGET {url}")
        res = requests.get(url, headers=get_headers(HARDCODED_TOKEN))
        print(f"Status: {res.status_code}")
        try:
            print(json.dumps(res.json(), indent=2, ensure_ascii=False))
        except:
            print(res.text)

if __name__ == "__main__":
    test_validation()
