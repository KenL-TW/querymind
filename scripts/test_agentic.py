"""Test that the agent now chains tool calls without asking for confirmation."""
import json
import requests
from collections import Counter

API = "http://localhost:8080"
SID = f"test_agentic_{__import__('time').time():.0f}"

# This question requires the agent to:
#   1. introspect order_items / products schema (list_tables + get_table_ddl)
#   2. JOIN to bring in product names automatically
#   3. return the result IN ONE TURN — no "I will check..." narration
prompt = "請列出銷售量前 5 的商品 ID 與商品名稱。"

print(f"PROMPT: {prompt}\n" + "=" * 70)

r = requests.post(
    f"{API}/v1/chat",
    json={"message": prompt, "session_id": SID, "conn_name": "default"},
    headers={"X-API-Key": "qm_owner_dev_key_change_me"},
    stream=True, timeout=180,
)

events = []
cur = ""
tool_calls = []
final_answer = ""

for raw in r.iter_lines():
    if not raw:
        continue
    s = raw.decode()
    if s.startswith("event:"):
        cur = s[6:].strip()
    elif s.startswith("data:"):
        try:
            payload = json.loads(s[5:])
        except Exception:
            continue
        events.append(cur)
        if cur == "thought":
            tool_calls.append(payload.get("action", ""))
        elif cur == "finish":
            final_answer = payload.get("answer", "")

print("EVENTS:", Counter(events))
print(f"TOOL CALLS ({len(tool_calls)}):", tool_calls)
print("=" * 70)
print("FINAL ANSWER:")
print(final_answer)
