"""
QueryMind — Streamlit Chat UI  (Phase A complete)
Run: python -m streamlit run ui/chatbot.py --server.port 8502
"""
from __future__ import annotations

import base64
import json
import os
import re
import urllib.parse
import uuid
from typing import Any

import requests
import streamlit as st

API_BASE = os.getenv("API_BASE", "http://localhost:8101").rstrip("/")

st.set_page_config(
    page_title="QueryMind",
    page_icon="🔍",
    layout="wide",
)

# ── Custom CSS ────────────────────────────────────────────────────────────────
st.markdown("""
<style>
.stChatMessage { max-width: 90%; }
div[data-testid="stHorizontalBlock"] button[kind="secondary"] {
    font-size: 0.78rem; padding: 0.25rem 0.5rem;
}
</style>
""", unsafe_allow_html=True)

# ── Session state init ────────────────────────────────────────────────────────
DEFAULTS: dict[str, Any] = {
    "messages": [],
    "session_id": "default",
    "api_key": "qm_owner_dev_key_change_me",
    "ai_summary": "",
    "schema_cache": None,
    "import_preview": None,
    "import_mapping": None,
    "import_ai_advice": "",
    "import_step": 0,
    # Conversation-depth additions
    "pending_prompt": None,        # str — auto-sent on next render
    "last_suggestions": [],         # list[str] — follow-up question buttons
    "session_meta": {},             # {title, summary, entities}
    "me": None,                     # cached /v1/me response
    "templates_cache": None,        # cached /v1/templates response
    "dict_cache": None,             # cached /v1/dictionary/{conn} response
}
for k, v in DEFAULTS.items():
    if k not in st.session_state:
        st.session_state[k] = v


def _headers(multipart: bool = False) -> dict:
    key = st.session_state.get("api_key", "")
    h = {"X-API-Key": key} if key else {}
    if not multipart:
        h["Content-Type"] = "application/json"
    return h


def _try_render_echarts(text: str) -> None:
    match = re.search(r"```json\s*(\{.+?\})\s*```", text, re.DOTALL)
    if not match:
        return
    try:
        data = json.loads(match.group(1))
        if "series" not in data:
            return
        try:
            from streamlit_echarts import st_echarts
            st_echarts(options=data, height="420px")
        except ImportError:
            st.info("📊 Install streamlit-echarts to render charts.")
    except (json.JSONDecodeError, ValueError):
        pass


def _extract_sql(text: str) -> str | None:
    m = re.search(r"```sql\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    return m.group(1).strip() if m else None


def _export_buttons(answer: str, conn: str) -> None:
    sql = _extract_sql(answer)
    if not sql:
        return
    h = _headers()
    col_csv, col_xl, _ = st.columns([1, 1, 6])
    with col_csv:
        try:
            r = requests.get(
                f"{API_BASE}/v1/export/csv",
                params={"sql": sql, "conn_name": conn},
                headers=h, timeout=30,
            )
            if r.status_code == 200:
                st.download_button(
                    "⬇️ CSV", data=r.content,
                    file_name="querymind_export.csv", mime="text/csv",
                    key=f"csv_{hash(sql)}",
                )
        except Exception:
            pass
    with col_xl:
        try:
            r2 = requests.get(
                f"{API_BASE}/v1/export/xlsx",
                params={"sql": sql, "conn_name": conn},
                headers=h, timeout=30,
            )
            if r2.status_code == 200:
                st.download_button(
                    "📗 Excel", data=r2.content,
                    file_name="querymind_export.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    key=f"xl_{hash(sql)}",
                )
        except Exception:
            pass


# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("🔍 QueryMind")
    st.caption("AI 資料庫分析助手")
    st.divider()

    api_ok = False
    connections: list[str] = []
    try:
        health = requests.get(f"{API_BASE}/health", timeout=3).json()
        st.success(f"✅ API 連線正常  v{health.get('version', '?')}")
        connections = health.get("connections", [])
        api_ok = True
    except Exception:
        st.error("❌ API 未連線 — 請先執行 python main.py")

    conn_name: str = st.selectbox("資料庫連線", connections) if connections else "default"

    st.divider()
    new_key = st.text_input("API Key", value=st.session_state.api_key, type="password")
    if new_key != st.session_state.api_key:
        st.session_state.api_key = new_key
        st.session_state.me = None
        st.rerun()

    # ── Whoami badge ────────────────────────────────────────────────────────
    if api_ok:
        if st.session_state.me is None:
            try:
                r = requests.get(f"{API_BASE}/v1/me", headers=_headers(), timeout=4)
                if r.status_code == 200:
                    st.session_state.me = r.json()
            except Exception:
                pass
        me = st.session_state.me or {}
        if me:
            role = me.get("role", "?")
            emoji = {
                "owner": "👑", "dba": "🛡️", "editor": "✏️",
                "analyst": "📊", "viewer": "👁️",
            }.get(role, "👤")
            st.markdown(
                f"<div style='padding:6px 10px;border-radius:8px;"
                f"background:#1f2937;color:#fff;font-size:0.85rem;margin:6px 0'>"
                f"{emoji} <b>{role}</b> · {me.get('email','')}</div>",
                unsafe_allow_html=True,
            )
            perms = me.get("permissions", {})
            with st.expander("🔐 權限詳情", expanded=False):
                st.write(f"允許 SQL：`{', '.join(perms.get('allowed_sql_verbs', []))}`")
                st.write(f"單次查詢上限：**{perms.get('max_rows_per_query', 0):,}** 列")
                caps = [k for k in ("can_export","can_schedule","can_etl",
                                    "can_modify_schema","can_manage_users")
                        if perms.get(k)]
                st.write("能力：" + (", ".join(caps) or "僅讀取"))

    st.divider()
    st.subheader("對話 Session")
    new_sid = st.text_input("Session ID", value=st.session_state.session_id)
    if new_sid != st.session_state.session_id:
        st.session_state.session_id = new_sid
        st.session_state.messages = []
        st.rerun()

    if api_ok:
        try:
            session_list = requests.get(
                f"{API_BASE}/v1/sessions", headers=_headers(), timeout=5
            ).json().get("sessions", [])
        except Exception:
            session_list = []

        if session_list:
            with st.expander(f"歷史 Sessions ({len(session_list)})", expanded=False):
                for s in session_list:
                    c1, c2 = st.columns([4, 1])
                    last = (s.get("last_active") or "")[:16]
                    label = s.get("title") or s["session_id"]
                    c1.markdown(
                        f"**{label}**  \n"
                        f"<span style='color:#888;font-size:0.78rem'>{s['turn_count']} 輪 · {last}</span>",
                        unsafe_allow_html=True,
                    )
                    if c2.button("載入", key=f"load_{s['session_id']}"):
                        st.session_state.session_id = s["session_id"]
                        try:
                            detail = requests.get(
                                f"{API_BASE}/v1/sessions/{s['session_id']}",
                                headers=_headers(), timeout=5,
                            ).json()
                            st.session_state.messages = [
                                {"role": m["role"], "content": m["content"]}
                                for m in detail.get("messages", [])
                            ]
                            st.session_state.session_meta = {
                                "title":    detail.get("title", ""),
                                "summary":  detail.get("summary", ""),
                                "entities": detail.get("entities", []) or [],
                            }
                            st.session_state.last_suggestions = []
                        except Exception:
                            st.session_state.messages = []
                        st.rerun()

    st.divider()
    c_new, c_clr = st.columns(2)
    if c_new.button("新對話"):
        st.session_state.session_id = uuid.uuid4().hex[:8]
        st.session_state.messages = []
        st.session_state.last_suggestions = []
        st.session_state.session_meta = {}
        st.session_state.pending_prompt = None
        st.rerun()
    if c_clr.button("清除記錄", type="secondary"):
        if api_ok:
            requests.delete(
                f"{API_BASE}/v1/sessions/{st.session_state.session_id}",
                headers=_headers(), timeout=5,
            )
        st.session_state.messages = []
        st.session_state.last_suggestions = []
        st.session_state.session_meta = {}
        st.rerun()

    # Display session title if known
    meta = st.session_state.get("session_meta") or {}
    title = meta.get("title") or ""
    if title:
        st.caption(f"📖 {title}")
    st.caption(f"Session: `{st.session_state.session_id}`")


# ── Core: streaming chat ──────────────────────────────────────────────────────
def _stream_chat(prompt: str, conn: str, session: str,
                 show_thinking: bool = True) -> str:
    """Stream a turn from /v1/chat (SSE).

    Side-effects on st.session_state:
      - last_suggestions: list[str] populated from the `suggestions` event
      - session_meta:     {title, summary, entities} updated from `suggestions`
    """
    answer_ph = st.empty()
    thinking_ph = st.empty()
    answer_text = ""
    thoughts: list[dict] = []
    cur_thought: dict = {}
    event_type = ""

    try:
        with requests.post(
            f"{API_BASE}/v1/chat",
            json={"message": prompt, "session_id": session, "conn_name": conn},
            headers=_headers(),
            stream=True,
            timeout=300,
        ) as resp:
            resp.raise_for_status()
            for raw in resp.iter_lines():
                if not raw:
                    continue
                line = raw.decode() if isinstance(raw, bytes) else raw
                if line.startswith("event:"):
                    event_type = line[6:].strip()
                elif line.startswith("data:"):
                    try:
                        payload = json.loads(line[5:])
                    except json.JSONDecodeError:
                        continue

                    if event_type == "token":
                        tok = payload.get("token", "")
                        if payload.get("is_final"):
                            answer_text = tok
                        else:
                            answer_text += tok
                        answer_ph.markdown(answer_text + "▌")

                    elif event_type == "thought":
                        cur_thought = {
                            "action": payload.get("action", ""),
                            "action_input": payload.get("action_input", ""),
                        }

                    elif event_type == "observation":
                        cur_thought["observation"] = payload.get("observation", "")
                        thoughts.append(cur_thought)
                        cur_thought = {}
                        if show_thinking and thoughts:
                            with thinking_ph.expander(
                                f"🔍 推理步驟 ({len(thoughts)} 步)", expanded=False
                            ):
                                for i, step in enumerate(thoughts, 1):
                                    st.markdown(f"**步驟 {i}** — `{step.get('action')}`")
                                    inp = step.get("action_input", "")
                                    if inp:
                                        st.caption(f"輸入: {inp[:300]}")
                                    obs = step.get("observation", "")
                                    if obs:
                                        st.caption(f"結果: {obs[:500]}")
                                    if i < len(thoughts):
                                        st.divider()

                    elif event_type == "finish":
                        fa = payload.get("answer", "")
                        if fa:
                            answer_text = fa

                    elif event_type == "suggestions":
                        st.session_state.last_suggestions = payload.get("suggestions", []) or []
                        st.session_state.session_meta = {
                            "title":    payload.get("title", ""),
                            "summary":  payload.get("summary", ""),
                            "entities": payload.get("entities", []) or [],
                        }

                    elif event_type == "error":
                        st.error(f"❗ {payload.get('error')}")

    except requests.exceptions.ConnectionError:
        st.error("無法連線到 QueryMind API")
    except Exception as exc:
        st.error(f"錯誤：{exc}")

    if answer_text:
        answer_ph.markdown(answer_text)
    return answer_text


# ─────────────────────────────────────────────────────────────────────────────
# TABS
# ─────────────────────────────────────────────────────────────────────────────
tab_home, tab_chat, tab_schema, tab_dict, tab_import, tab_summary, tab_status = st.tabs(
    ["🏠 首頁", "💬 對話", "🗄️ DB 結構", "📖 資料字典", "📥 匯入資料", "🤖 AI 攝要", "✅ 系統狀態"]
)


# ─────────────────────────────────────────────────────────────────────────────
# Shared helpers for templates / dictionary tabs
# ─────────────────────────────────────────────────────────────────────────────
def _fetch_templates() -> dict:
    """Cache and return /v1/templates response (categories + templates)."""
    if st.session_state.templates_cache is not None:
        return st.session_state.templates_cache
    try:
        r = requests.get(f"{API_BASE}/v1/templates", headers=_headers(), timeout=5)
        r.raise_for_status()
        st.session_state.templates_cache = r.json()
    except Exception:
        st.session_state.templates_cache = {"categories": [], "templates": []}
    return st.session_state.templates_cache


def _render_template_grid(category: str | None = None, key_prefix: str = "tpl") -> None:
    """Render template chips as a 4-col button grid; clicking dispatches to chat."""
    data = _fetch_templates()
    items = data.get("templates", [])
    if category:
        items = [t for t in items if t["category"] == category]
    if not items:
        st.caption("目前沒有可用的範本問題。")
        return
    cols = st.columns(4)
    for idx, tpl in enumerate(items):
        label = f"{tpl['icon']} {tpl['title']}"
        if cols[idx % 4].button(
            label,
            key=f"{key_prefix}_{tpl['id']}",
            use_container_width=True,
            help=tpl.get("description") or tpl.get("prompt", ""),
        ):
            st.session_state.pending_prompt = tpl["prompt"]
            # If user was not on chat tab, st.rerun() will still re-render and
            # the pending_prompt handler in tab_chat will pick it up.
            st.rerun()

# ═══════════════════════════════════════════════
# TAB 1 — CHAT
# ═══════════════════════════════════════════════
with tab_chat:
    st.header("QueryMind 對話助手")

    # ── Context badge: title / depth / entities ───────────────────────────────
    meta = st.session_state.get("session_meta") or {}
    turn_count = len(st.session_state.messages) // 2
    if meta.get("title") or turn_count > 0:
        title_disp = meta.get("title") or "新對話"
        ents = meta.get("entities") or []
        ent_chip = " · ".join(f"`{e}`" for e in ents[:5]) if ents else ""
        badge = f"🧠 **{title_disp}**  ·  {turn_count} 輪對話"
        if meta.get("summary"):
            badge += "  ·  含長期摘要"
        st.markdown(badge)
        if ent_chip:
            st.caption(f"已涉及實體：{ent_chip}")
        if meta.get("summary"):
            with st.expander("📜 對話摘要（AI 長期記憶）", expanded=False):
                st.markdown(meta["summary"])

    with st.expander("⚡ 範本問題庫（依分類）", expanded=False):
        _data = _fetch_templates()
        _cats = _data.get("categories", [])
        if _cats:
            _tab_objs = st.tabs(_cats)
            for _i, _c in enumerate(_cats):
                with _tab_objs[_i]:
                    _render_template_grid(category=_c, key_prefix=f"chat_tpl_{_i}")
        else:
            st.caption("尚未載入範本（請確認 API 已啟動）。")

    st.divider()

    # ── Message history ───────────────────────────────────────────────────────
    for msg in st.session_state.messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])
            if msg["role"] == "assistant":
                _try_render_echarts(msg["content"])
                _export_buttons(msg["content"], conn_name)

    # ── Follow-up suggestion buttons (only show after the latest assistant msg) ──
    suggestions = st.session_state.get("last_suggestions") or []
    if (suggestions
            and st.session_state.messages
            and st.session_state.messages[-1]["role"] == "assistant"):
        st.markdown("**💡 建議追問：**")
        sug_cols = st.columns(len(suggestions))
        for i, q in enumerate(suggestions):
            if sug_cols[i].button(f"➜ {q}", key=f"sug_{i}_{hash(q)}",
                                   use_container_width=True):
                st.session_state.pending_prompt = q
                st.rerun()

    # ── Resolve pending prompt (from quick buttons / suggestions / schema tab) ──
    pending = st.session_state.get("pending_prompt")
    st.session_state.pending_prompt = None

    if pending:
        st.session_state.messages.append({"role": "user", "content": pending})
        st.session_state.last_suggestions = []
        with st.chat_message("user"):
            st.markdown(pending)
        with st.chat_message("assistant"):
            answer = _stream_chat(pending, conn_name, st.session_state.session_id)
            if answer:
                _try_render_echarts(answer)
                _export_buttons(answer, conn_name)
                st.session_state.messages.append({"role": "assistant", "content": answer})
        st.rerun()

    # ── Normal text input ────────────────────────────────────────────────────
    if prompt_input := st.chat_input("請用中文問任何資料問題…"):
        st.session_state.messages.append({"role": "user", "content": prompt_input})
        st.session_state.last_suggestions = []
        with st.chat_message("user"):
            st.markdown(prompt_input)
        with st.chat_message("assistant"):
            answer = _stream_chat(prompt_input, conn_name, st.session_state.session_id)
            if answer:
                _try_render_echarts(answer)
                _export_buttons(answer, conn_name)
                st.session_state.messages.append({"role": "assistant", "content": answer})
        st.rerun()


# ═══════════════════════════════════════════════
# TAB 2 — DB SCHEMA
# ═══════════════════════════════════════════════
with tab_schema:
    st.header(f"🗄️ 資料庫結構 — `{conn_name}`")
    c_reload, _ = st.columns([1, 5])
    if c_reload.button("🔄 重新載入", key="reload_schema"):
        st.session_state.schema_cache = None

    if api_ok and st.session_state.schema_cache is None:
        with st.spinner("載入結構中…"):
            try:
                r = requests.get(f"{API_BASE}/v1/schema/{conn_name}", headers=_headers(), timeout=15)
                r.raise_for_status()
                st.session_state.schema_cache = r.json()
            except Exception as exc:
                st.error(f"無法取得 schema：{exc}")

    schema_data = st.session_state.schema_cache
    if schema_data:
        import pandas as pd
        tables = schema_data.get("tables", [])
        views  = schema_data.get("views", [])
        st.caption(f"共 **{schema_data['table_count']}** 張資料表、**{schema_data['view_count']}** 個 View")

        search_term = st.text_input("🔎 搜尋資料表", placeholder="輸入關鍵字過濾…", key="schema_search")
        if search_term:
            tables = [t for t in tables if search_term.lower() in t["name"].lower()]

        if views:
            with st.expander(f"Views ({len(views)})", expanded=False):
                for v in views:
                    st.code(v, language="sql")

        for tbl in tables:
            row_label = f"{tbl['row_count']:,} 筆" if tbl["row_count"] >= 0 else "?"
            with st.expander(f"📋 **{tbl['name']}**  —  {len(tbl['columns'])} 欄 · {row_label}", expanded=False):
                if tbl["columns"]:
                    df_cols = pd.DataFrame(tbl["columns"])[["name", "type", "nullable", "default"]]
                    df_cols.columns = ["欄位名稱", "型別", "可為空", "預設值"]
                    st.dataframe(df_cols, use_container_width=True, hide_index=True)

                c_ddl, c_ask = st.columns([1, 1])
                if tbl["ddl"]:
                    with c_ddl:
                        st.caption("DDL")
                        st.code(tbl["ddl"], language="sql")
                if c_ask.button(f"💬 問 AI", key=f"ask_{tbl['name']}"):
                    q = f"請說明 {tbl['name']} 這張表的用途與欄位意義，並舉 2 個實用查詢範例"
                    st.session_state.pending_prompt = q
                    st.rerun()

                if tbl["sample_rows"]:
                    st.caption("範例資料（前 3 筆）")
                    st.dataframe(pd.DataFrame(tbl["sample_rows"]), use_container_width=True, hide_index=True)
    elif not api_ok:
        st.warning("API 未連線")


# ═══════════════════════════════════════════════
# TAB 3 — IMPORT WIZARD
# ═══════════════════════════════════════════════
with tab_import:
    st.header("📥 資料匯入精靈")
    st.caption("上傳 CSV / Excel，讓 AI 對應欄位後匯入資料庫")

    if not api_ok:
        st.warning("API 未連線，請先啟動伺服器")
    else:
        steps_labels = ["① 上傳檔案", "② AI 欄位對應", "③ 確認匯入", "④ 執行完成"]
        step = st.session_state.import_step
        step_cols = st.columns(4)
        for i, lbl in enumerate(steps_labels):
            if i < step:
                step_cols[i].success(lbl)
            elif i == step:
                step_cols[i].info(f"**{lbl}**")

        st.divider()

        # STEP 0: Upload
        if step == 0:
            uploaded = st.file_uploader(
                "選擇 CSV 或 Excel 檔案（最大 20 MB）",
                type=["csv", "xlsx", "xls"],
            )
            if uploaded:
                with st.spinner("分析檔案結構…"):
                    try:
                        r = requests.post(
                            f"{API_BASE}/v1/import/preview",
                            files={"file": (uploaded.name, uploaded.getvalue(), uploaded.type or "application/octet-stream")},
                            data={"conn_name": conn_name},
                            headers={"X-API-Key": st.session_state.api_key},
                            timeout=30,
                        )
                        r.raise_for_status()
                        st.session_state.import_preview = r.json()
                        st.session_state.import_step = 1
                        st.session_state.import_ai_advice = ""
                        st.session_state.import_mapping = None
                        st.rerun()
                    except Exception as exc:
                        st.error(f"檔案解析失敗：{exc}")

        # STEP 1: Column mapping
        elif step == 1:
            import pandas as pd
            prev = st.session_state.import_preview
            st.subheader(f"📄 {prev['original_name']}  —  {prev['row_count']:,} 筆資料")
            with st.expander("📋 檔案預覽（前 5 筆）", expanded=True):
                st.dataframe(pd.DataFrame(prev["sample_rows"]), use_container_width=True, hide_index=True)
            st.divider()

            # Load schema if needed
            if st.session_state.schema_cache is None:
                try:
                    r = requests.get(f"{API_BASE}/v1/schema/{conn_name}", headers=_headers(), timeout=15)
                    st.session_state.schema_cache = r.json()
                except Exception:
                    pass

            table_names = [t["name"] for t in (st.session_state.schema_cache or {}).get("tables", [])]
            target_table = st.selectbox("🎯 選擇目標資料表", ["（請選擇）"] + table_names)

            if target_table and target_table != "（請選擇）":
                if not st.session_state.import_ai_advice:
                    if st.button("🤖 讓 AI 建議欄位對應", type="primary"):
                        csv_cols = [c["name"] for c in prev["columns"]]
                        mapping_prompt = (
                            f"我有一個 CSV 檔案，欄位是：{csv_cols}\n"
                            f"目標資料表是 `{target_table}`，請查詢這張表的 DDL，"
                            f"然後建議欄位對應，用表格格式：| CSV 欄位 | 資料庫欄位 | 說明 |"
                        )
                        with st.spinner("AI 分析中…"):
                            try:
                                resp = requests.post(
                                    f"{API_BASE}/v1/chat/sync",
                                    json={"message": mapping_prompt, "session_id": "__import_mapping__", "conn_name": conn_name},
                                    headers=_headers(), timeout=60,
                                )
                                st.session_state.import_ai_advice = resp.json().get("answer", "")
                                st.rerun()
                            except Exception as exc:
                                st.error(f"AI 建議失敗：{exc}")

                if st.session_state.import_ai_advice:
                    st.subheader("🤖 AI 欄位對應建議")
                    st.markdown(st.session_state.import_ai_advice)
                    st.divider()
                    st.subheader("✏️ 確認欄位對應")
                    csv_cols = [c["name"] for c in prev["columns"]]
                    df_mapping = pd.DataFrame({
                        "CSV 欄位": csv_cols,
                        "資料庫欄位": csv_cols,
                        "匯入": [True] * len(csv_cols),
                    })
                    edited = st.data_editor(
                        df_mapping, use_container_width=True, hide_index=True,
                        column_config={"匯入": st.column_config.CheckboxColumn("匯入此欄位")},
                    )
                    cb, cn2 = st.columns([1, 3])
                    if cb.button("⬅️ 重新上傳"):
                        st.session_state.import_step = 0
                        st.session_state.import_preview = None
                        st.rerun()
                    if cn2.button("▶️ 下一步：確認匯入", type="primary"):
                        mapping = {
                            row["CSV 欄位"]: row["資料庫欄位"]
                            for _, row in edited.iterrows()
                            if row["匯入"] and row["資料庫欄位"]
                        }
                        st.session_state.import_mapping = {"target_table": target_table, "column_map": mapping}
                        st.session_state.import_step = 2
                        st.rerun()

        # STEP 2: Confirm
        elif step == 2:
            import pandas as pd
            prev    = st.session_state.import_preview
            mapping = st.session_state.import_mapping
            st.subheader("⚠️ 確認匯入資訊")
            st.warning("**匯入是不可逆的操作，請仔細確認後再執行。**")
            c1, c2, c3 = st.columns(3)
            c1.metric("來源檔案", prev["original_name"])
            c2.metric("目標資料表", mapping["target_table"])
            c3.metric("準備匯入筆數", f"{prev['row_count']:,} 筆")
            st.markdown("**欄位對應：**")
            st.dataframe(
                pd.DataFrame([{"CSV 欄位": k, "→ 資料庫欄位": v} for k, v in mapping["column_map"].items()]),
                use_container_width=True, hide_index=True,
            )
            cb2, ce = st.columns([1, 3])
            if cb2.button("⬅️ 返回修改"):
                st.session_state.import_step = 1
                st.rerun()
            if ce.button("✅ 確認執行匯入", type="primary"):
                import_prompt = (
                    f"請將以下檔案的資料匯入資料庫。\n"
                    f"來源檔案路徑：`{prev['file_path']}`\n"
                    f"目標資料表：`{mapping['target_table']}`\n"
                    f"欄位對應（CSV欄位 → 資料庫欄位）：\n"
                    + "\n".join(f"- `{k}` → `{v}`" for k, v in mapping["column_map"].items())
                    + "\n\n請用 read_file_content 讀取檔案，生成並執行 ETL 程式碼，完成後告訴我匯入了幾筆。"
                )
                st.session_state["_import_exec_prompt"] = import_prompt
                st.session_state.import_step = 3
                st.rerun()

        # STEP 3: Execute
        elif step == 3:
            st.subheader("⚙️ 執行匯入中…")
            exec_prompt = st.session_state.get("_import_exec_prompt", "")
            if exec_prompt:
                with st.chat_message("assistant"):
                    result = _stream_chat(exec_prompt, conn_name, "__import_exec__", show_thinking=True)
                if result:
                    st.success("✅ 匯入流程完成！")
                    st.session_state["_import_exec_prompt"] = ""
                    st.session_state.messages.append({"role": "assistant", "content": result})
            ca, cc2 = st.columns(2)
            if ca.button("🔄 再次匯入"):
                for k in ["import_step","import_preview","import_mapping","import_ai_advice"]:
                    st.session_state[k] = 0 if k == "import_step" else None if k != "import_ai_advice" else ""
                st.rerun()
            if cc2.button("💬 前往對話查看結果"):
                st.session_state.import_step = 0
                st.rerun()


# ═══════════════════════════════════════════════
# TAB 4 — AI SUMMARY
# ═══════════════════════════════════════════════
with tab_summary:
    st.header("🤖 AI 資料庫摘要")
    st.caption("讓 AI 分析資料庫結構，產生業務說明與分析建議")

    if not api_ok:
        st.warning("API 未連線")
    else:
        col_gen, col_clr = st.columns([1, 1])
        gen_clicked = col_gen.button("✨ 產生 AI 摘要", type="primary")
        if col_clr.button("🗑️ 清除"):
            st.session_state.ai_summary = ""

        if gen_clicked:
            summary_prompt = (
                f"請對 `{conn_name}` 資料庫進行完整業務分析：\n\n"
                "1. **資料庫概況**：有哪些資料表、各自儲存什麼業務資料\n"
                "2. **資料表關聯**：哪些表之間有關聯，如何聯結查詢\n"
                "3. **資料量摘要**：各表目前的資料筆數\n"
                "4. **業務洞察**：從現有結構推測這是什麼類型的業務系統\n"
                "5. **建議分析方向**：提供 5 個最有價值的分析問題\n\n"
                "請以繁體中文回答，使用 Markdown 格式。"
            )
            st.session_state.ai_summary = ""
            with st.chat_message("assistant"):
                answer = _stream_chat(summary_prompt, conn_name, "__summary__")
                if answer:
                    st.session_state.ai_summary = answer

        if st.session_state.ai_summary:
            if not gen_clicked:
                st.markdown(st.session_state.ai_summary)
            st.divider()
            st.subheader("💡 快速發問")
            schema_for_q = st.session_state.schema_cache
            tnames = [t["name"] for t in (schema_for_q or {}).get("tables", [])] if schema_for_q else []
            quick_sum_qs = [
                "請統計每張資料表的筆數，以表格呈現",
                "這個資料庫最近有哪些值得關注的資料異常？",
                f"請分析 {tnames[0] if tnames else '主要'} 資料表的資料品質",
            ]
            qcols = st.columns(3)
            for i, q in enumerate(quick_sum_qs):
                if qcols[i].button(q[:28] + "…", key=f"sum_q_{i}", use_container_width=True):
                    st.session_state.pending_prompt = q
                    st.rerun()
        else:
            st.info("點擊「✨ 產生 AI 摘要」開始分析")


# ═══════════════════════════════════════════════
# TAB 5 — SYSTEM STATUS
# ═══════════════════════════════════════════════
with tab_status:
    st.header("✅ 系統狀態")
    st.subheader("API 服務")
    if api_ok:
        try:
            hd = requests.get(f"{API_BASE}/health", timeout=3).json()
            st.success(f"✅ API 運行中  v{hd.get('version','?')}  |  {API_BASE}")
            st.json({"status": hd.get("status"), "connections": hd.get("connections", [])})
        except Exception:
            st.error("❌ 無法連線")
    else:
        st.error(f"❌ API 無法連線 ({API_BASE})")
        st.code("python main.py", language="bash")

    st.divider()
    st.subheader("LLM 連線測試")
    if api_ok and st.button("🧪 測試 LLM"):
        with st.spinner("測試中…"):
            try:
                r = requests.post(
                    f"{API_BASE}/v1/chat/sync",
                    json={"message": "reply with exactly: OK", "session_id": "__llm_test__", "conn_name": conn_name},
                    headers=_headers(), timeout=30,
                )
                if r.status_code == 200:
                    d = r.json()
                    st.success(f"✅ LLM 正常  {d.get('tokens_used',0)} tokens")
                    st.caption(d.get("answer","")[:200])
                else:
                    st.error(f"❌ HTTP {r.status_code}")
            except Exception as exc:
                st.error(f"❌ {exc}")

    st.divider()
    st.subheader("資料庫連線")
    if api_ok:
        for cn in connections:
            try:
                sr = requests.get(f"{API_BASE}/v1/schema/{cn}", headers=_headers(), timeout=10)
                if sr.status_code == 200:
                    d = sr.json()
                    st.success(f"✅ `{cn}` — {d['table_count']} 張資料表")
                else:
                    st.error(f"❌ `{cn}` — HTTP {sr.status_code}")
            except Exception as exc:
                st.error(f"❌ `{cn}` — {exc}")

    st.divider()
    st.subheader("Prometheus Metrics")
    if api_ok:
        try:
            mr = requests.get(f"{API_BASE}/metrics", timeout=5)
            if mr.status_code == 200:
                lines = [l for l in mr.text.splitlines() if l.startswith("querymind_") and not l.startswith("#")]
                st.success(f"✅ /metrics 正常  {len(lines)} 個指標")
                with st.expander("原始 metrics"):
                    st.code("\n".join(lines[:30]), language="text")
        except Exception as exc:
            st.warning(f"⚠️ {exc}")

    st.divider()
    st.subheader("快速指令")
    st.code("# 啟動 API\npython main.py\n\n# 啟動 UI\npython -m streamlit run ui/chatbot.py --server.port 8502\n\n# 重建示範資料\npython seed_full_demo.py", language="bash")


# ═══════════════════════════════════════════════
# TAB 0 — HOME (role-aware landing page)
# ═══════════════════════════════════════════════
with tab_home:
    me = st.session_state.me or {}
    role = me.get("role", "guest")
    email = me.get("email", "")
    role_label = {
        "owner": "管理者 / Owner",
        "dba": "資料庫管理員 / DBA",
        "analyst": "資料分析師 / Analyst",
        "editor": "資料編輯 / Editor",
        "viewer": "檢視者 / Viewer",
    }.get(role, role)

    st.header(f"🏠 歡迎使用 QueryMind")
    if email:
        st.caption(f"目前身份：**{role_label}** · `{email}`")
    else:
        st.caption("尚未登入，部分功能將受限。")

    # ── 連線 / 狀態總覽 ────────────────────────────────────────────
    c1, c2, c3 = st.columns(3)
    c1.metric("API 連線", "✅ 正常" if api_ok else "❌ 中斷")
    c2.metric("資料庫連線", f"{len(connections)} 個")
    meta_now = st.session_state.get("session_meta") or {}
    c3.metric(
        "目前對話",
        meta_now.get("title") or "新對話",
        f"{len(st.session_state.messages) // 2} 輪",
    )

    st.divider()

    # ── 角色化引導文案 ────────────────────────────────────────────
    role_intro = {
        "owner":   "管理視角：先看整體營運與部門達成率，再深入單一指標。",
        "dba":     "資料健康優先：先檢視資料庫結構與資料品質，再支援分析需求。",
        "analyst": "分析優先：用範本問題快速產出洞察，再以對話深挖細節。",
        "editor":  "資料維護優先：可使用匯入精靈將檔案資料載入資料表。",
        "viewer":  "查詢優先：可閱讀分析結果與資料字典，但無法寫入資料。",
    }.get(role, "用左側「📖 資料字典」了解資料庫，或從下方範本問題開始。")
    st.info(role_intro)

    # ── 角色化建議分類 ────────────────────────────────────────────
    role_default_cat: dict[str, list[str]] = {
        "owner":   ["營運", "銷售", "客戶"],
        "dba":     ["營運", "庫存", "商品"],
        "analyst": ["銷售", "客戶", "商品", "行銷"],
        "editor":  ["商品", "庫存"],
        "viewer":  ["銷售", "客戶"],
    }
    recommended = role_default_cat.get(role, [])

    if api_ok:
        _tpl_data = _fetch_templates()
        all_cats = _tpl_data.get("categories", [])
        cats_for_role = [c for c in recommended if c in all_cats] or all_cats[:3]

        st.subheader("✨ 為你推薦的分析範本")
        if cats_for_role:
            home_tabs = st.tabs(cats_for_role)
            for i, c in enumerate(cats_for_role):
                with home_tabs[i]:
                    _render_template_grid(category=c, key_prefix=f"home_tpl_{i}")
        else:
            st.caption("尚無可用範本。")

        st.divider()
        st.subheader("🚀 接下來你可以")
        cc1, cc2, cc3 = st.columns(3)
        with cc1:
            st.markdown("**💬 直接開始問**")
            st.caption("切到「對話」分頁，用自然語言提問即可。")
        with cc2:
            st.markdown("**📖 看懂資料**")
            st.caption("打開「資料字典」，了解每張表的意義與重要指標。")
        with cc3:
            st.markdown("**📥 匯入新資料**")
            st.caption("到「匯入資料」上傳 CSV / Excel，AI 會協助欄位對應。")
    else:
        st.warning("API 尚未連線，無法載入範本與字典。")


# ═══════════════════════════════════════════════
# TAB 3.5 — DATA DICTIONARY
# ═══════════════════════════════════════════════
with tab_dict:
    st.header(f"📖 資料字典 — `{conn_name}`")
    st.caption("每張表是什麼、每個欄位代表什麼、有哪些業務指標與名詞。")

    cdr, _ = st.columns([1, 5])
    if cdr.button("🔄 重新載入", key="reload_dict"):
        st.session_state.dict_cache = None

    if api_ok and st.session_state.dict_cache is None:
        with st.spinner("載入字典中…"):
            try:
                r = requests.get(
                    f"{API_BASE}/v1/dictionary/{conn_name}",
                    headers=_headers(),
                    timeout=15,
                )
                r.raise_for_status()
                st.session_state.dict_cache = r.json()
            except Exception as exc:
                st.error(f"無法取得資料字典：{exc}")

    dict_data = st.session_state.dict_cache
    if dict_data:
        tables = dict_data.get("tables", [])
        metrics = dict_data.get("metrics", {})
        glossary = dict_data.get("glossary", {})

        # ── 上方：搜尋 + 分類過濾 ───────────────────────────────
        cs1, cs2 = st.columns([2, 1])
        kw = cs1.text_input("🔎 搜尋（表名 / 欄位 / 描述）", key="dict_search")
        cats = sorted({t.get("category") or "其他" for t in tables})
        cat_sel = cs2.selectbox("分類", ["全部"] + cats, key="dict_cat")

        def _match(t: dict) -> bool:
            if cat_sel != "全部" and (t.get("category") or "其他") != cat_sel:
                return False
            if not kw:
                return True
            kw_l = kw.lower()
            if kw_l in t["name"].lower() or kw_l in (t.get("description") or "").lower():
                return True
            return any(
                kw_l in c["name"].lower() or kw_l in (c.get("description") or "").lower()
                for c in t.get("columns", [])
            )

        shown = [t for t in tables if _match(t)]
        st.caption(f"共 **{len(tables)}** 張資料表，顯示 **{len(shown)}** 張")

        # ── 資料表卡片 ──────────────────────────────────────────
        import pandas as pd

        for t in shown:
            row_label = f"{t['row_count']:,} 筆" if t["row_count"] >= 0 else "?"
            cat_chip = f"  ·  `{t.get('category')}`" if t.get("category") else ""
            with st.expander(
                f"📋 **{t['name']}**  —  {len(t['columns'])} 欄 · {row_label}{cat_chip}",
                expanded=False,
            ):
                desc = t.get("description") or "_(尚未提供業務說明)_"
                st.markdown(f"**用途**：{desc}")
                if t["columns"]:
                    df = pd.DataFrame(t["columns"])[["name", "type", "description"]]
                    df.columns = ["欄位", "型別", "業務說明"]
                    st.dataframe(df, use_container_width=True, hide_index=True)

                c_ask, _spacer = st.columns([1, 4])
                if c_ask.button(f"💬 問 AI 這張表怎麼用", key=f"dict_ask_{t['name']}"):
                    q = (
                        f"請以業務語言說明 `{t['name']}` 這張表的用途、"
                        f"關鍵欄位、常見分析角度，並給 2 個實用查詢範例。"
                    )
                    st.session_state.pending_prompt = q
                    st.rerun()

        # ── 業務指標 ────────────────────────────────────────────
        if metrics:
            st.divider()
            st.subheader("📐 業務指標")
            for name, definition in metrics.items():
                st.markdown(f"- **{name}** — {definition}")

        # ── 名詞辭典 ────────────────────────────────────────────
        if glossary:
            st.divider()
            st.subheader("📚 名詞辭典")
            for term, definition in glossary.items():
                st.markdown(f"- **{term}** — {definition}")
    elif not api_ok:
        st.warning("API 未連線")
