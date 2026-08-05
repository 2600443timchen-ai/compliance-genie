# -*- coding: utf-8 -*-
import json
import urllib.request

req = urllib.request.Request('http://127.0.0.1:8765/api/chat/session')
with urllib.request.urlopen(req) as res:
    session_data = json.loads(res.read().decode('utf-8'))

chat_id = session_data.get('chat_id')

post_req = urllib.request.Request(
    f'http://127.0.0.1:8765/api/chat/{chat_id}',
    data=json.dumps({'q': '請簡述金融消費者保護法第七條的重點'}, ensure_ascii=False).encode('utf-8'),
    headers={'Content-Type': 'application/json'}
)

output = []
output.append(f"SESSION CHAT ID: {chat_id}")

try:
    with urllib.request.urlopen(post_req, timeout=30) as res:
        output.append(f"STATUS: {res.status}")
        output.append(f"CONTENT TYPE: {res.headers.get('Content-Type')}")
        body = res.read().decode('utf-8', errors='replace')
        output.append(f"BODY:\n{body}")
except Exception as e:
    output.append(f"CHAT POST ERROR: {e}")

with open('chat_test_result.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(output))

print("DONE WRITING RESULT")
