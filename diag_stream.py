"""Test what events the streaming endpoint actually emits."""
import requests

H = {"X-API-Key": "dev-key-change-me"}
url = "http://localhost:8080/v1/chat"
body = {"message": "查 products 表有幾筆資料", "session_id": "__diag__", "conn_name": "default"}

events = []
with requests.post(url, json=body, headers=H, stream=True, timeout=120) as r:
    print(f"HTTP {r.status_code}")
    cur_event = None
    for raw in r.iter_lines():
        if not raw:
            continue
        line = raw.decode()
        if line.startswith("event:"):
            cur_event = line[6:].strip()
        elif line.startswith("data:"):
            data = line[5:].strip()
            events.append((cur_event, data[:120]))

print(f"\nTotal events: {len(events)}")
from collections import Counter
ctr = Counter(e for e, _ in events)
print("Event type counts:", dict(ctr))
print("\nFirst 5 events:")
for e, d in events[:5]:
    print(f"  [{e}] {d}")
print("\nLast 5 events:")
for e, d in events[-5:]:
    print(f"  [{e}] {d}")
