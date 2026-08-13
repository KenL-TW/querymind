import requests, json

msg = '幫我建立一個排程，名稱 test_sched，Cron 表達式 0 8 * * *，要執行的 SQL: SELECT 1，JSON 負載 {"conn_name": "default"}'
payload = {'message': msg, 'session_id': 's2', 'conn_name': 'default'}

r = requests.post('http://localhost:8101/v1/chat/sync', json=payload, headers={'X-API-Key': 'dev-key-change-me'}, timeout=60)
print('Status:', r.status_code)
if r.status_code == 200:
    data = r.json()
    print('Answer:', data['answer'][:500])
    print('Steps:', len(data.get('steps', [])))
    for step in data.get('steps', []):
        print(f"  - {step['action']}: {step.get('action_input', '')[:200]}")
else:
    print('Error:', r.text[:1000])
