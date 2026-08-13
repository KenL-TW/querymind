import requests, json

# Simple message first
msg = 'list_schedules'
payload = {'message': msg, 'session_id': 's-list', 'conn_name': 'default'}

r = requests.post('http://localhost:8101/v1/chat/sync', json=payload, headers={'X-API-Key': 'dev-key-change-me'}, timeout=60)
print('Status:', r.status_code)
if r.status_code == 200:
    data = r.json()
    print('OK - Answer:', data['answer'][:200])
else:
    print('ERROR:', r.text[:500])
