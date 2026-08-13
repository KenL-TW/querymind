<script setup lang="ts">
import {
  NButton, NCard, NCollapseTransition, NDrawer, NDrawerContent, NEmpty, NInput, NList, NListItem,
  NModal, NPopover, NScrollbar, NSelect, NSpace, NSpin, NTag, NThing, NTooltip, useMessage,
} from 'naive-ui'
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useRuntimeConfig } from 'nuxt/app'
import { useApi } from '../composables/useApi'
import { useAuthStore } from '../stores/auth'
import { useMarkdown } from '../composables/useMarkdown'
import { useChatStream } from '../composables/useChatStream'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ title: 'Chat' })

interface PendingConfirm {
  verb: string
  sql_preview: string
  message?: string
}

interface Msg {
  role: 'user' | 'assistant'
  content: string
  thoughts?: Array<{ action: string; action_input: string; observation?: string }>
  pending?: boolean
  pendingConfirm?: PendingConfirm | null
  /** SQL extracted from the assistant's markdown — enables "修正 SQL" action. */
  extractedSql?: string
  /** Whether the inline chain-of-thought panel is expanded. */
  thoughtsOpen?: boolean
  /** Data quality warnings returned by the validator. */
  warnings?: string[]
  /** Structured presentation plan returned by the backend. */
  answerPlan?: Record<string, unknown>
  /** DB-grounded facts returned by the last executed query. */
  queryFacts?: Record<string, unknown>
  /** DLP masking report returned by the backend. */
  dlp?: Record<string, unknown>
}

interface SessionInfo {
  session_id: string
  message_count: number
  turn_count: number
  last_active?: string | null
  title?: string
  summary?: string
  pinned?: boolean
  archived?: boolean
  owner_user_id?: number | null
}

interface SessionDetail extends SessionInfo {
  messages: Array<{ role: string; content: string }>
  entities?: string[]
}

interface ConnInfo {
  name: string
  dialect: string
  alive: boolean
  error: string | null
}

const api = useApi()
const md = useMarkdown()
const stream = useChatStream()
const message = useMessage()
const route = useRoute()

const sessions = ref<SessionInfo[]>([])
const conns = ref<ConnInfo[]>([])
const currentSession = ref<string>('')
const currentConn = ref<string>('')
const messages = ref<Msg[]>([])
const input = ref('')
const loadingSessions = ref(false)
const loadingMessages = ref(false)
const streaming = ref(false)
const suggestions = ref<string[]>([])
const summary = ref('')
const entities = ref<string[]>([])
const drawerOpen = ref(false)
const drawerThoughts = ref<Msg['thoughts']>([])
const sessionSearch = ref('')
const showArchived = ref(false)
let sessionSearchTimer: ReturnType<typeof setTimeout> | null = null

// Refine-SQL modal state
const refineOpen = ref(false)
const refineSql = ref('')
const refineNote = ref('')
const refineLoading = ref(false)
const refineWarnings = ref<string[]>([])

// ── Quick template picker ─────────────────────────────────────────────────
interface QuickTemplate { id: string; title: string; icon?: string; category?: string; prompt?: string }
const tplPickerOpen = ref(false)
const tplPickerLoading = ref(false)
const quickTemplates = ref<QuickTemplate[]>([])
const tplSearch = ref('')

const filteredTemplates = computed(() => {
  const q = tplSearch.value.trim().toLowerCase()
  if (!q) return quickTemplates.value
  return quickTemplates.value.filter(t =>
    t.title.toLowerCase().includes(q)
    || (t.category ?? '').toLowerCase().includes(q)
    || (t.prompt ?? '').toLowerCase().includes(q),
  )
})

const templatesByCategory = computed(() => {
  const byCat = new Map<string, QuickTemplate[]>()
  for (const t of filteredTemplates.value) {
    const k = t.category ?? '其他'
    if (!byCat.has(k)) byCat.set(k, [])
    byCat.get(k)!.push(t)
  }
  return Array.from(byCat.entries()).map(([cat, items]) => ({ cat, items }))
})

async function openTplPicker() {
  tplPickerOpen.value = true
  if (quickTemplates.value.length > 0) return  // already loaded
  tplPickerLoading.value = true
  try {
    const resp = await api.get<{ templates: QuickTemplate[] }>('/v1/templates')
    quickTemplates.value = resp.templates ?? []
  } catch { /* silently ignore */ }
  finally { tplPickerLoading.value = false }
}

function applyTemplate(t: QuickTemplate) {
  input.value = t.prompt ?? t.title
  tplPickerOpen.value = false
  tplSearch.value = ''
}

const scrollEl = ref<HTMLDivElement | null>(null)

const connOptions = computed(() =>
  conns.value.map((c) => ({
    label: c.alive ? c.name : `${c.name} (離線)`,
    value: c.name,
    disabled: !c.alive,
  })),
)
const currentConnInfo = computed<ConnInfo | undefined>(() =>
  conns.value.find((c) => c.name === currentConn.value),
)
const lastAssistantIdx = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    if (messages.value[i].role === 'assistant') return i
  }
  return -1
})

function newSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** Extract the LAST fenced ```sql block from a markdown string. */
function extractSqlFromMarkdown(md: string): string {
  const re = /```sql\s*\n([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  let last = ''
  while ((m = re.exec(md)) !== null) last = m[1].trim()
  return last
}

async function loadSessions() {
  loadingSessions.value = true
  try {
    const params = new URLSearchParams()
    const q = sessionSearch.value.trim()
    if (q) params.set('q', q)
    if (showArchived.value) params.set('archived_only', 'true')
    const qs = params.toString()
    const data = await api.get<{ sessions: SessionInfo[] }>(`/v1/sessions${qs ? `?${qs}` : ''}`)
    sessions.value = data.sessions ?? []
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '載入會話列表失敗')
  } finally {
    loadingSessions.value = false
  }
}

function onSessionSearchInput() {
  if (sessionSearchTimer) clearTimeout(sessionSearchTimer)
  sessionSearchTimer = setTimeout(loadSessions, 300)
}

async function loadConns(opts: { refresh?: boolean } = {}) {
  try {
    const url = opts.refresh ? '/v1/connections?refresh=true' : '/v1/connections'
    const data = await api.get<{ connections: ConnInfo[]; default: string | null }>(url)
    conns.value = data.connections ?? []
    if (!conns.value.length) {
      currentConn.value = ''
      return
    }
    // Pick the user's existing choice if still valid + alive; otherwise the
    // backend-suggested default (first alive); otherwise the first item.
    const existing = conns.value.find((c) => c.name === currentConn.value)
    if (!existing || !existing.alive) {
      currentConn.value = data.default ?? conns.value[0].name
    }
  } catch (e: unknown) {
    message.error(`連線清單載入失敗：${(e as { message?: string })?.message ?? ''}`)
  }
}

/** Force re-probe the current connection (e.g. after a user-visible failure). */
async function pingCurrentConn() {
  if (!currentConn.value) return
  try {
    const r = await api.post<ConnInfo>(`/v1/connections/${encodeURIComponent(currentConn.value)}/ping`, {})
    const idx = conns.value.findIndex((c) => c.name === r.name)
    if (idx >= 0) conns.value[idx] = r
    message[r.alive ? 'success' : 'error'](
      r.alive ? `連線「${r.name}」正常` : `連線「${r.name}」失敗：${r.error ?? ''}`,
    )
  } catch (e: unknown) {
    message.error(`Ping 失敗：${(e as { message?: string })?.message ?? ''}`)
  }
}

async function openSession(sid: string) {
  if (!sid) return
  currentSession.value = sid
  loadingMessages.value = true
  messages.value = []
  suggestions.value = []
  try {
    const d = await api.get<SessionDetail>(`/v1/sessions/${encodeURIComponent(sid)}`)
    messages.value = (d.messages ?? []).map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
      extractedSql: m.role !== 'user' ? extractSqlFromMarkdown(m.content) : undefined,
    }))
    summary.value = d.summary ?? ''
    entities.value = d.entities ?? []
    await scrollToBottom()
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status
    if (status !== 404) {
      message.error((e as { message?: string })?.message ?? '載入訊息失敗')
    }
  } finally {
    loadingMessages.value = false
  }
}

function startNewSession() {
  const sid = newSessionId()
  currentSession.value = sid
  messages.value = []
  suggestions.value = []
  summary.value = ''
  entities.value = []
}

async function deleteSession(sid: string) {
  try {
    await api.del(`/v1/sessions/${encodeURIComponent(sid)}`)
    sessions.value = sessions.value.filter((s) => s.session_id !== sid)
    if (currentSession.value === sid) startNewSession()
    message.success('已刪除')
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '刪除失敗')
  }
}

// ── Session rename ────────────────────────────────────────────────────────
const renamingSession = ref<string | null>(null)
const renameValue = ref('')

function startRename(s: SessionInfo) {
  renamingSession.value = s.session_id
  renameValue.value = s.title || ''
}

async function commitRename(sid: string) {
  const title = renameValue.value.trim()
  renamingSession.value = null
  if (!sid) return
  try {
    await api.patch(`/v1/sessions/${encodeURIComponent(sid)}`, { title })
    const idx = sessions.value.findIndex((s) => s.session_id === sid)
    if (idx >= 0) sessions.value[idx] = { ...sessions.value[idx], title }
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '重命名失敗')
  }
}

async function togglePin(s: SessionInfo) {
  const next = !s.pinned
  try {
    await api.patch(`/v1/sessions/${encodeURIComponent(s.session_id)}`, { pinned: next })
    message.success(next ? '已釘選' : '已取消釘選')
    await loadSessions()
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '操作失敗')
  }
}

async function toggleArchive(s: SessionInfo) {
  const next = !s.archived
  try {
    await api.patch(`/v1/sessions/${encodeURIComponent(s.session_id)}`, { archived: next })
    message.success(next ? '已封存' : '已取消封存')
    if (next && currentSession.value === s.session_id) startNewSession()
    await loadSessions()
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '操作失敗')
  }
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '剛才'
  if (mins < 60) return `${mins} 分鐘前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小時前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return d.toLocaleDateString('zh-TW')
}

async function scrollToBottom() {
  await nextTick()
  const el = scrollEl.value
  if (el) el.scrollTop = el.scrollHeight
}

/** Inspect a streamed observation for the `needs_confirmation` envelope
 *  returned by the execute_query tool when the LLM tries a destructive verb.
 *  When present, attach the preview/verb to the assistant message so the
 *  template can render the "執行/取消" card. */
function maybeAttachConfirm(assistant: Msg, obs: string) {
  if (!obs.includes('needs_confirmation')) return
  try {
    const parsed = JSON.parse(obs)
    if (parsed && parsed.needs_confirmation) {
      assistant.pendingConfirm = {
        verb: String(parsed.verb || ''),
        sql_preview: String(parsed.sql_preview || ''),
        message: String(parsed.message || ''),
      }
    }
  } catch { /* obs may be plain text — ignore */ }
}

function dlpColumns(dlp?: Record<string, unknown>): string[] {
  const cols = Array.isArray(dlp?.columns) ? dlp.columns : []
  return cols
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const row = item as Record<string, unknown>
      const patterns = Array.isArray(row.patterns) ? row.patterns.join(', ') : ''
      return `${String(row.column ?? '')}${patterns ? ` (${patterns})` : ''}`
    })
    .filter(Boolean)
}

function queryFactNumber(facts: Record<string, unknown> | undefined, key: string): number | null {
  const value = facts?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function summarizeTraceInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  if (obj.question) return String(obj.question)
  if (obj.sql) return String(obj.sql)
  return JSON.stringify(obj, null, 2)
}

function summarizeTraceOutput(
  status: string,
  output: Record<string, unknown>,
  error: unknown,
  latency: unknown,
): string {
  const lines = [`status: ${status}`, `latency: ${Number(latency || 0)}ms`]
  if (error) lines.push(`error: ${String(error)}`)
  if (output.intent) lines.push(`intent: ${String(output.intent)}`)
  if (output.metric) lines.push(`metric: ${String(output.metric)}`)
  if (Array.isArray(output.dimensions) && output.dimensions.length) {
    lines.push(`dimensions: ${output.dimensions.join(', ')}`)
  }
  if (Array.isArray(output.candidate_tables)) {
    const names = output.candidate_tables
      .slice(0, 5)
      .map((item) => typeof item === 'object' && item ? String((item as Record<string, unknown>).table ?? '') : '')
      .filter(Boolean)
    if (names.length) lines.push(`tables: ${names.join(', ')}`)
  }
  if (output.sql && typeof output.sql === 'string') lines.push(output.sql)
  if (output.ok !== undefined) lines.push(`dry-run: ${output.ok ? 'ok' : 'failed'}`)
  if (Array.isArray(output.warnings) && output.warnings.length) {
    lines.push(`warnings: ${output.warnings.join('；')}`)
  }
  return lines.join('\n')
}

async function send(prompt?: string) {
  const text = (prompt ?? input.value).trim()
  if (!text || streaming.value) return
  if (!currentConn.value) {
    message.error('請先選擇一個可用的資料庫連線。')
    return
  }
  if (!currentSession.value) currentSession.value = newSessionId()

  messages.value.push({ role: 'user', content: text })
  // IMPORTANT: wrap in reactive() so callback mutations (assistant.content += ...,
  // assistant.pending = false) actually trigger Vue updates. Pushing a plain
  // object only proxies it lazily on array access — the captured local ref
  // would still point at the raw target and be invisible to reactivity.
  const assistant: Msg = reactive({
    role: 'assistant', content: '', thoughts: [], pending: true, thoughtsOpen: true,
  })
  messages.value.push(assistant)
  if (prompt === undefined) input.value = ''
  streaming.value = true
  suggestions.value = []
  await scrollToBottom()

  await stream.send(
    { message: text, session_id: currentSession.value, conn_name: currentConn.value },
    {
      onToken(token, isFinal) {
        if (isFinal) assistant.content = token
        else assistant.content += token
        scrollToBottom()
      },
      onThought(t) {
        assistant.thoughts!.push({ action: t.action, action_input: t.action_input })
        scrollToBottom()
      },
      onObservation(obs) {
        const arr = assistant.thoughts!
        if (arr.length) arr[arr.length - 1].observation = obs
        maybeAttachConfirm(assistant, obs)
      },
      onFinish(answer, payload) {
        if (!assistant.content) assistant.content = answer
        assistant.pending = false
        assistant.extractedSql = extractSqlFromMarkdown(assistant.content)
        if (payload?.answer_plan && typeof payload.answer_plan === 'object') {
          assistant.answerPlan = payload.answer_plan as Record<string, unknown>
        }
        if (payload?.query_facts && typeof payload.query_facts === 'object') {
          assistant.queryFacts = payload.query_facts as Record<string, unknown>
        }
        if (payload?.dlp && typeof payload.dlp === 'object') {
          assistant.dlp = payload.dlp as Record<string, unknown>
        }
      },
      onAnswerPlan(plan) {
        assistant.answerPlan = plan
      },
      onWarnings(w) {
        assistant.warnings = w
      },
      onSuggestions(data) {
        suggestions.value = data.suggestions
        summary.value = data.summary
        entities.value = data.entities
        loadSessions()
      },
      onError(err) {
        assistant.pending = false
        assistant.content += `\n\n> ❌ 錯誤：${err}`
        message.error(err)
      },
    },
  )

  streaming.value = false
  assistant.pending = false
  await scrollToBottom()
}

/** Confirm a destructive operation that the agent surfaced via
 *  `needs_confirmation`.  Calls the dedicated fast-path endpoint that
 *  re-runs execute_query with confirmed=True (no LLM round trip). */
async function confirmExecute(assistant: Msg) {
  const pc = assistant.pendingConfirm
  if (!pc) return
  try {
    const res = await api.post<{ ok: boolean; verb: string; affected_rows: number; answer: string }>(
      '/v1/chat/confirm-execute',
      { sql: pc.sql_preview, session_id: currentSession.value, conn_name: currentConn.value },
    )
    assistant.content += `\n\n> ✅ ${res.answer || '已執行'}`
    assistant.pendingConfirm = null
    loadSessions()
  } catch (e: unknown) {
    message.error((e as { data?: { detail?: string }; message?: string })?.data?.detail
      ?? (e as { message?: string })?.message
      ?? '執行失敗')
  }
}

function cancelExecute(assistant: Msg) {
  assistant.pendingConfirm = null
  assistant.content += `\n\n> 🚫 已取消執行。`
  message.info('已取消')
}

/** Re-run the agent for the last user message in this session. */
async function regenerate() {
  if (streaming.value) return
  const idx = lastAssistantIdx.value
  if (idx < 0) return
  // Drop the prior assistant reply from the on-screen list (backend will also
  // pop it from history when /chat/regenerate runs).
  const assistant: Msg = reactive({
    role: 'assistant', content: '', thoughts: [], pending: true, thoughtsOpen: true,
  })
  messages.value.splice(idx, 1, assistant)
  streaming.value = true
  suggestions.value = []
  await scrollToBottom()

  // Reuse the same SSE plumbing as /v1/chat by manually fetching the new
  // endpoint and dispatching events through the existing parser logic in
  // useChatStream.  To keep things simple we just POST and reload session.
  try {
    const cfg = useRuntimeConfig()
    const auth = useAuthStore()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', Accept: 'text/event-stream',
    }
    if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`
    const resp = await fetch(`${cfg.public.apiBase}/v1/chat/regenerate`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ session_id: currentSession.value, conn_name: currentConn.value }),
    })
    if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)

    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let i: number
      while ((i = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, i); buffer = buffer.slice(i + 2)
        let ev = 'message'; const lines: string[] = []
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) ev = line.slice(6).trim()
          else if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^\s+/, ''))
        }
        if (!lines.length) continue
        let payload: Record<string, unknown> = {}
        try { payload = JSON.parse(lines.join('\n')) } catch { continue }
        if (ev === 'token') {
          const tok = String(payload.token ?? '')
          if (payload.is_final) assistant.content = tok
          else assistant.content += tok
        } else if (ev === 'thought') {
          assistant.thoughts!.push({
            action: String(payload.action ?? ''),
            action_input: String(payload.action_input ?? ''),
          })
        } else if (ev === 'flow_trace') {
          const steps = Array.isArray(payload.steps) ? payload.steps : []
          for (const step of steps) {
            if (!step || typeof step !== 'object') continue
            const row = step as Record<string, unknown>
            const output = row.output && typeof row.output === 'object'
              ? row.output as Record<string, unknown>
              : {}
            assistant.thoughts!.push({
              action: String(row.name ?? 'agent_step'),
              action_input: summarizeTraceInput(row.input),
              observation: summarizeTraceOutput(String(row.status ?? 'success'), output, row.error, row.latency_ms),
            })
          }
        } else if (ev === 'observation') {
          const obs = String(payload.observation ?? '')
          const arr = assistant.thoughts!
          if (arr.length) arr[arr.length - 1].observation = obs
          maybeAttachConfirm(assistant, obs)
        } else if (ev === 'finish') {
          if (!assistant.content) assistant.content = String(payload.answer ?? '')
          assistant.pending = false
          assistant.extractedSql = extractSqlFromMarkdown(assistant.content)
          if (payload.answer_plan && typeof payload.answer_plan === 'object') {
            assistant.answerPlan = payload.answer_plan as Record<string, unknown>
          }
          if (payload.query_facts && typeof payload.query_facts === 'object') {
            assistant.queryFacts = payload.query_facts as Record<string, unknown>
          }
          if (payload.dlp && typeof payload.dlp === 'object') {
            assistant.dlp = payload.dlp as Record<string, unknown>
          }
        } else if (ev === 'suggestions') {
          suggestions.value = (payload.suggestions as string[]) ?? []
          summary.value = String(payload.summary ?? '')
          entities.value = (payload.entities as string[]) ?? []
          loadSessions()
        } else if (ev === 'error') {
          throw new Error(String(payload.error ?? 'stream error'))
        }
        scrollToBottom()
      }
    }
  } catch (e: unknown) {
    assistant.pending = false
    assistant.content += `\n\n> ❌ 重新生成失敗：${(e as Error)?.message ?? ''}`
    message.error((e as Error)?.message ?? '重新生成失敗')
  } finally {
    streaming.value = false
    assistant.pending = false
    await scrollToBottom()
  }
}

// ── CSV / Excel download ──────────────────────────────────────────────────
const downloadingIdx = ref<number | null>(null)
const downloadingFmt = ref<'csv' | 'xlsx' | null>(null)

async function downloadExport(m: Msg, idx: number, fmt: 'csv' | 'xlsx') {
  if (!m.extractedSql || !currentConn.value) {
    message.warning('沒有可下載的查詢結果')
    return
  }
  downloadingIdx.value = idx
  downloadingFmt.value = fmt
  try {
    await api.downloadBlob(
      `/v1/export/${fmt}`,
      `export.${fmt}`,
      'POST',
      { sql: m.extractedSql, conn_name: currentConn.value, filename: 'export' },
    )
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '下載失敗')
  } finally {
    downloadingIdx.value = null
    downloadingFmt.value = null
  }
}

function openRefine(m: Msg) {
  refineSql.value = m.extractedSql ?? ''
  refineNote.value = ''
  refineWarnings.value = []
  refineOpen.value = true
}

async function submitRefine() {
  const sql = refineSql.value.trim()
  if (!sql) { message.warning('SQL 不可為空'); return }
  refineLoading.value = true
  refineWarnings.value = []
  try {
    const res = await api.post<{ ok: boolean; rows?: unknown[]; row_count?: number; answer: string; warnings?: string[] }>(
      '/v1/chat/refine-sql',
      {
        sql,
        session_id: currentSession.value,
        conn_name: currentConn.value,
        note: refineNote.value,
      },
    )
    // Store warnings for display in modal before closing
    if (res.warnings && res.warnings.length > 0) {
      refineWarnings.value = res.warnings
    }
    // Append the user-edit + result to the local message list to keep the UI
    // in sync without a full session reload.
    messages.value.push({ role: 'user', content: `[修正 SQL]\n\`\`\`sql\n${sql}\n\`\`\`` })
    const reply: Msg = {
      role: 'assistant',
      content: res.answer + (res.rows && res.rows.length
        ? `\n\n回傳 ${res.row_count ?? res.rows.length} 列。`
        : ''),
      extractedSql: sql,
      warnings: res.warnings ?? [],
    }
    messages.value.push(reply)
    if (!res.warnings || res.warnings.length === 0) {
      refineOpen.value = false
    }
    loadSessions()
    await scrollToBottom()
  } catch (e: unknown) {
    message.error((e as { data?: { detail?: string }; message?: string })?.data?.detail
      ?? (e as { message?: string })?.message
      ?? '執行失敗')
  } finally {
    refineLoading.value = false
  }
}

function applySuggestion(s: string) { input.value = s }
function viewThoughts(m: Msg) { drawerThoughts.value = m.thoughts; drawerOpen.value = true }

// ── Schema-aware autocomplete (@ trigger) ─────────────────────────────
interface AcItem { kind: 'table' | 'column'; value: string; detail?: string }
const acItems = ref<AcItem[]>([])
const acIndex = ref(0)
const acOpen = computed(() => acItems.value.length > 0)
let acTimer: ReturnType<typeof setTimeout> | null = null
let acReqSeq = 0

function extractAtToken(text: string): { prefix: string; start: number } | null {
  // Find the last '@' that is followed only by [A-Za-z0-9_.] up to caret end.
  const m = text.match(/@([A-Za-z0-9_.]*)$/)
  if (!m) return null
  return { prefix: m[1], start: m.index! }
}

async function refreshAutocomplete() {
  if (!currentConn.value) { acItems.value = []; return }
  const tok = extractAtToken(input.value)
  if (!tok) { acItems.value = []; return }
  const mySeq = ++acReqSeq
  try {
    const r = await api.get<{ suggestions: AcItem[] }>(
      `/v1/schema/${encodeURIComponent(currentConn.value)}/autocomplete?prefix=${encodeURIComponent(tok.prefix)}&limit=12`,
    )
    if (mySeq !== acReqSeq) return  // stale
    acItems.value = r.suggestions || []
    acIndex.value = 0
  } catch { acItems.value = [] }
}

watch(input, () => {
  if (acTimer) clearTimeout(acTimer)
  acTimer = setTimeout(refreshAutocomplete, 150)
})

function acceptAutocomplete() {
  const tok = extractAtToken(input.value)
  const pick = acItems.value[acIndex.value]
  if (!tok || !pick) return false
  // Replace the '@<prefix>' with the chosen value (no leading '@').
  input.value = input.value.slice(0, tok.start) + pick.value + input.value.slice(tok.start + 1 + tok.prefix.length)
  acItems.value = []
  return true
}

function onEnter(e: KeyboardEvent) {
  if (acOpen.value) {
    e.preventDefault()
    acceptAutocomplete()
    return
  }
  if (e.shiftKey) return
  e.preventDefault()
  send()
}

function onTab(e: KeyboardEvent) {
  if (acOpen.value) { e.preventDefault(); acceptAutocomplete() }
}
function onAcArrow(e: KeyboardEvent) {
  if (!acOpen.value) return
  if (e.key === 'ArrowDown') { e.preventDefault(); acIndex.value = (acIndex.value + 1) % acItems.value.length }
  if (e.key === 'ArrowUp')   { e.preventDefault(); acIndex.value = (acIndex.value - 1 + acItems.value.length) % acItems.value.length }
  if (e.key === 'Escape')    { acItems.value = [] }
}

onMounted(async () => {
  await Promise.all([loadSessions(), loadConns()])
  if (sessions.value.length) openSession(sessions.value[0].session_id)
  else startNewSession()
  const q = route.query.q as string | undefined
  if (q) input.value = q
})

watch(currentSession, () => { suggestions.value = [] })

// Warn the user when they switch connection mid-conversation — silent in-place
// switching is dangerous because new queries will hit a different DB.
watch(currentConn, (newVal, oldVal) => {
  if (oldVal && newVal !== oldVal && messages.value.length > 0) {
    message.warning(`已切換到連線「${newVal}」，後續查詢將針對此連線執行。`)
  }
})
</script>

<template>
  <div class="grid grid-cols-[280px_1fr] gap-4 h-[calc(100vh-7rem)]">
    <!-- Sessions sidebar -->
    <div class="flex flex-col bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div class="p-3 border-b flex items-center justify-between">
        <div class="text-sm font-semibold">會話</div>
        <NButton size="tiny" type="primary" @click="startNewSession">新增</NButton>
      </div>
      <div class="px-3 pt-2 pb-2 border-b space-y-2">
        <NInput
          v-model:value="sessionSearch"
          size="small"
          placeholder="搜尋標題 / 摘要"
          clearable
          @update:value="onSessionSearchInput"
          @clear="loadSessions"
        >
          <template #prefix>
            <span class="text-slate-400 text-xs">🔍</span>
          </template>
        </NInput>
        <label class="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
          <input
            type="checkbox"
            v-model="showArchived"
            class="w-3 h-3 accent-brand-500"
            @change="loadSessions"
          />
          <span>{{ showArchived ? '顯示封存中' : '顯示進行中' }}</span>
        </label>
      </div>
      <NScrollbar class="flex-1">
        <NSpin :show="loadingSessions">
          <NEmpty v-if="!sessions.length" description="尚無會話" class="mt-10" />
          <NList v-else hoverable clickable>
            <NListItem
              v-for="s in sessions"
              :key="s.session_id"
              :class="['!px-3', currentSession === s.session_id ? 'bg-brand-50' : '']"
              @click="renamingSession !== s.session_id && openSession(s.session_id)"
            >
              <NThing>
                <template #header>
                  <!-- Inline rename input -->
                  <div v-if="renamingSession === s.session_id" class="flex items-center gap-1" @click.stop>
                    <NInput
                      v-model:value="renameValue"
                      size="tiny"
                      class="flex-1"
                      autofocus
                      @keydown.enter.stop="commitRename(s.session_id)"
                      @keydown.esc.stop="renamingSession = null"
                      @blur="commitRename(s.session_id)"
                    />
                  </div>
                  <!-- Normal title display -->
                  <div v-else class="flex items-center gap-1 group">
                    <span v-if="s.pinned" class="text-amber-500 text-xs shrink-0" title="已釘選">★</span>
                    <div class="text-sm font-medium truncate max-w-[140px] flex-1"
                         :class="s.archived ? 'text-slate-400 italic' : ''">
                      {{ s.title || '新會話' }}
                    </div>
                    <button
                      class="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-amber-500 p-0.5 rounded"
                      :title="s.pinned ? '取消釘選' : '釘選'"
                      @click.stop="togglePin(s)"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10 1l2.39 5.84L18 7.74l-4.5 4.05L14.78 18 10 14.94 5.22 18l1.28-6.21L2 7.74l5.61-.9z"/>
                      </svg>
                    </button>
                    <button
                      class="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-700 p-0.5 rounded"
                      title="重新命名"
                      @click.stop="startRename(s)"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-8.793 8.793-3.535.707.707-3.536 8.793-8.792z"/>
                      </svg>
                    </button>
                  </div>
                </template>
                <template #description>
                  <div class="text-xs text-slate-400 flex items-center justify-between mt-0.5">
                    <span class="flex items-center gap-2">
                      <span>{{ s.turn_count }} 輪</span>
                      <span v-if="s.last_active" class="text-slate-300">·</span>
                      <NTooltip v-if="s.last_active" :delay="600">
                        <template #trigger>
                          <span>{{ formatRelativeTime(s.last_active) }}</span>
                        </template>
                        {{ s.last_active }}
                      </NTooltip>
                    </span>
                    <span class="flex items-center gap-1">
                      <NButton
                        text size="tiny"
                        @click.stop="toggleArchive(s)"
                      >{{ s.archived ? '取消封存' : '封存' }}</NButton>
                      <NButton
                        text size="tiny" type="error"
                        @click.stop="deleteSession(s.session_id)"
                      >刪除</NButton>
                    </span>
                  </div>
                  <div v-if="s.summary" class="text-xs text-slate-400 mt-0.5 line-clamp-2 leading-snug">
                    {{ s.summary }}
                  </div>
                </template>
              </NThing>
            </NListItem>
          </NList>
        </NSpin>
      </NScrollbar>
    </div>

    <!-- Chat area -->
    <div class="flex flex-col bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div class="px-4 py-3 border-b flex items-center gap-3">
        <div class="text-sm font-semibold flex-1 truncate">
          {{ sessions.find((s) => s.session_id === currentSession)?.title || '新會話' }}
        </div>
        <NTag
          size="small"
          :type="currentConnInfo?.alive ? 'success' : (currentConnInfo ? 'error' : 'default')"
          :bordered="false"
        >
          <span class="inline-flex items-center gap-1">
            <span
              class="inline-block w-2 h-2 rounded-full"
              :class="currentConnInfo?.alive ? 'bg-emerald-500' : 'bg-red-500'"
            />
            {{ currentConn || '未選擇連線' }}
            <span v-if="currentConnInfo?.dialect" class="text-xs opacity-70">
              ({{ currentConnInfo.dialect }})
            </span>
          </span>
        </NTag>
        <NSelect
          v-model:value="currentConn"
          :options="connOptions"
          size="small"
          placeholder="選擇連線"
          class="!w-40"
        />
        <NButton size="tiny" quaternary @click="pingCurrentConn" :disabled="!currentConn">
          重測
        </NButton>
      </div>

      <NCollapseTransition :show="!!currentConnInfo && !currentConnInfo.alive">
        <div class="px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700">
          ⚠️ 目前連線「{{ currentConn }}」無法連通{{ currentConnInfo?.error ? '：' + currentConnInfo.error : '' }}。送出查詢可能會失敗，建議切換連線或點「重測」。
        </div>
      </NCollapseTransition>

      <NCollapseTransition :show="conns.length === 0">
        <div class="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700">
          ℹ️ 目前帳號沒有可用的資料庫連線。請聯絡系統管理員為您指派連線權限。
        </div>
      </NCollapseTransition>

      <div ref="scrollEl" class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <NSpin :show="loadingMessages" class="block">
          <NEmpty v-if="!messages.length" description="輸入一個問題開始聊天" class="mt-20" />

          <template v-else>
            <div
              v-for="(m, i) in messages"
              :key="i"
              :class="['flex', m.role === 'user' ? 'justify-end' : 'justify-start']"
            >
              <div
                :class="[
                  'rounded-2xl px-4 py-3 max-w-[80%] shadow-sm',
                  m.role === 'user'
                    ? 'bg-brand-500 text-white'
                    : 'bg-slate-50 border border-slate-200',
                ]"
              >
                <div v-if="m.role === 'user'" class="whitespace-pre-wrap">{{ m.content }}</div>
                <div v-else>
                  <!-- Inline chain-of-thought (collapsible) -->
                  <div
                    v-if="m.thoughts && m.thoughts.length"
                    class="mb-2 border border-slate-200 rounded-lg bg-white overflow-hidden"
                  >
                    <button
                      type="button"
                      class="w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 bg-slate-50 hover:bg-slate-100 transition"
                      @click="m.thoughtsOpen = !m.thoughtsOpen"
                    >
                      <span class="inline-block transition-transform" :class="m.thoughtsOpen ? 'rotate-90' : ''">▶</span>
                      <span class="font-semibold text-slate-600">
                        思考過程 · {{ m.thoughts.length }} 步
                      </span>
                      <span v-if="m.pending" class="ml-auto text-slate-400 italic">執行中…</span>
                    </button>
                    <NCollapseTransition :show="!!m.thoughtsOpen">
                      <div class="px-3 py-2 space-y-2 text-xs border-t border-slate-200 max-h-[360px] overflow-y-auto">
                        <div
                          v-for="(t, ti) in m.thoughts"
                          :key="ti"
                          class="border border-slate-100 rounded p-2 bg-slate-50/60"
                        >
                          <div class="flex items-center gap-2 mb-1">
                            <NTag size="tiny" type="info" :bordered="false">#{{ ti + 1 }}</NTag>
                            <span class="font-mono text-slate-700">{{ t.action }}</span>
                          </div>
                          <div class="text-slate-500 mb-1">
                            <span class="text-slate-400">輸入：</span>
                            <code class="break-all">{{ t.action_input }}</code>
                          </div>
                          <div v-if="t.observation" class="text-slate-600">
                            <span class="text-slate-400">結果：</span>
                            <pre class="whitespace-pre-wrap break-all bg-white border border-slate-200 rounded p-1.5 mt-1 max-h-32 overflow-y-auto">{{ t.observation }}</pre>
                          </div>
                          <div v-else class="text-slate-400 italic">等待結果…</div>
                        </div>
                      </div>
                    </NCollapseTransition>
                  </div>

                  <MarkdownWithCharts v-if="m.content" :content="m.content" />
                  <div v-else-if="m.pending" class="text-slate-400 text-sm italic">思考中…</div>
                  <AnswerPlanView v-if="m.answerPlan" :plan="m.answerPlan" />
                  <div
                    v-if="m.queryFacts"
                    class="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
                  >
                    <div class="font-semibold text-slate-700 mb-1">DB 查詢事實</div>
                    <div class="flex flex-wrap gap-1.5">
                      <NTag size="tiny" bordered>connection: {{ m.queryFacts.conn_name || '-' }}</NTag>
                      <NTag size="tiny" bordered>verb: {{ m.queryFacts.verb || '-' }}</NTag>
                      <NTag size="tiny" bordered>rows: {{ queryFactNumber(m.queryFacts, 'row_count') ?? '-' }}</NTag>
                      <NTag
                        v-if="m.queryFacts.row_cap_applied"
                        size="tiny"
                        type="warning"
                        bordered
                      >
                        row cap: {{ m.queryFacts.row_cap }}
                      </NTag>
                    </div>
                    <pre
                      v-if="m.queryFacts.sql"
                      class="mt-2 whitespace-pre-wrap break-all rounded border border-slate-100 bg-slate-50 p-2 font-mono text-[11px] text-slate-600 max-h-40 overflow-y-auto"
                    >{{ m.queryFacts.sql }}</pre>
                  </div>
                  <div
                    v-if="m.dlp && m.dlp.enabled"
                    class="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800"
                  >
                    <div class="font-semibold mb-1">DLP / PII 遮罩</div>
                    <div>
                      狀態：{{ m.dlp.applied ? '已套用遮罩' : '未命中敏感值' }}；
                      redactions: {{ m.dlp.total_redactions ?? 0 }}
                    </div>
                    <div v-if="dlpColumns(m.dlp).length" class="mt-1 flex flex-wrap gap-1">
                      <NTag
                        v-for="col in dlpColumns(m.dlp)"
                        :key="col"
                        size="tiny"
                        type="info"
                        bordered
                      >{{ col }}</NTag>
                    </div>
                  </div>

                  <!-- Destructive-op confirmation card -->
                  <NCard
                    v-if="m.pendingConfirm"
                    size="small"
                    class="mt-3 !border-amber-300 !bg-amber-50"
                    title="⚠️ 需要確認執行"
                  >
                    <div class="text-xs text-amber-700 mb-2">
                      動作：<b>{{ m.pendingConfirm.verb }}</b>
                      <span v-if="m.pendingConfirm.message"> — {{ m.pendingConfirm.message }}</span>
                    </div>
                    <pre class="text-xs bg-white border border-amber-200 p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-48">{{ m.pendingConfirm.sql_preview }}</pre>
                    <template #action>
                      <NSpace size="small">
                        <NButton size="small" type="primary" @click="confirmExecute(m)">執行</NButton>
                        <NButton size="small" @click="cancelExecute(m)">取消</NButton>
                      </NSpace>
                    </template>
                  </NCard>

                  <div v-if="!m.pending" class="mt-2 flex items-center gap-2 flex-wrap">
                    <NButton
                      v-if="i === lastAssistantIdx && !streaming"
                      size="tiny" text type="warning"
                      @click="regenerate"
                    >重新生成</NButton>
                    <NButton
                      v-if="m.extractedSql"
                      size="tiny" text type="success"
                      @click="openRefine(m)"
                    >修正 SQL</NButton>
                    <NButton
                      v-if="m.extractedSql"
                      size="tiny" text type="info"
                      :loading="downloadingIdx === i && downloadingFmt === 'csv'"
                      @click="downloadExport(m, i, 'csv')"
                    >下載 CSV</NButton>
                    <NButton
                      v-if="m.extractedSql"
                      size="tiny" text type="info"
                      :loading="downloadingIdx === i && downloadingFmt === 'xlsx'"
                      @click="downloadExport(m, i, 'xlsx')"
                    >下載 Excel</NButton>
                  </div>

                  <!-- Data quality warnings -->
                  <div
                    v-if="m.warnings && m.warnings.length > 0"
                    class="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2"
                  >
                    <div class="flex items-center gap-1.5 text-xs font-semibold text-amber-700 mb-1">
                      <span>⚠️</span> 資料品質提醒
                    </div>
                    <ul class="space-y-0.5">
                      <li
                        v-for="(w, wi) in m.warnings"
                        :key="wi"
                        class="text-xs text-amber-700 list-disc list-inside"
                      >{{ w }}</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </NSpin>
      </div>

      <NCollapseTransition :show="suggestions.length > 0">
        <div class="px-4 py-2 border-t bg-slate-50">
          <div class="text-xs text-slate-500 mb-1">接著可以問</div>
          <NSpace size="small">
            <NTag
              v-for="(s, i) in suggestions"
              :key="i"
              size="small"
              type="info"
              :bordered="false"
              checkable
              @click="applySuggestion(s)"
            >{{ s }}</NTag>
          </NSpace>
        </div>
      </NCollapseTransition>

      <div class="p-3 border-t flex items-end gap-2 relative">
        <div v-if="acOpen" class="absolute bottom-full left-3 mb-1 w-80 bg-white border border-slate-200 shadow-lg rounded-md max-h-64 overflow-y-auto z-10">
          <div
            v-for="(it, i) in acItems"
            :key="it.value"
            class="px-3 py-1.5 text-xs cursor-pointer flex items-center justify-between"
            :class="i === acIndex ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50'"
            @mousedown.prevent="() => { acIndex = i; acceptAutocomplete() }"
            @mouseover="acIndex = i"
          >
            <span class="font-mono">{{ it.value }}</span>
            <span class="text-slate-400 ml-2">{{ it.kind === 'table' ? 'table' : it.detail || 'column' }}</span>
          </div>
          <div class="px-3 py-1 text-[10px] text-slate-400 border-t">Tab/Enter 選取、Esc 關閉</div>
        </div>
        <NInput
          v-model:value="input"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 5 }"
          placeholder="輸入問題，Enter 送出、Shift+Enter 換行；打 @ 可自動補全 schema"
          :disabled="streaming"
          @keydown.enter="onEnter"
          @keydown.tab="onTab"
          @keydown="onAcArrow"
        />
        <!-- Template quick-picker -->
        <NPopover
          v-model:show="tplPickerOpen"
          trigger="manual"
          placement="top-end"
          :style="{ width: '380px', padding: '0' }"
        >
          <template #trigger>
            <NTooltip placement="top">
              <template #trigger>
                <NButton
                  :disabled="streaming"
                  secondary
                  @click="openTplPicker"
                >📋</NButton>
              </template>
              從模板庫選取問題
            </NTooltip>
          </template>
          <div class="flex flex-col" style="max-height: 400px">
            <div class="px-3 pt-2 pb-1 border-b">
              <NInput
                v-model:value="tplSearch"
                placeholder="搜尋模板…"
                size="small"
                clearable
              />
            </div>
            <div v-if="tplPickerLoading" class="text-xs text-slate-400 text-center py-4">載入中…</div>
            <NScrollbar v-else style="max-height: 340px">
              <div v-if="templatesByCategory.length === 0" class="text-xs text-slate-400 text-center py-4">無符合結果</div>
              <div v-for="g in templatesByCategory" :key="g.cat">
                <div class="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide bg-slate-50">
                  {{ g.cat }}
                </div>
                <div
                  v-for="t in g.items"
                  :key="t.id"
                  class="px-3 py-2 text-sm cursor-pointer hover:bg-brand-50 hover:text-brand-700 flex items-start gap-2"
                  @mousedown.prevent="applyTemplate(t)"
                >
                  <span class="text-base leading-none mt-0.5">{{ t.icon ?? '📌' }}</span>
                  <span class="flex-1 min-w-0 truncate">{{ t.title }}</span>
                </div>
              </div>
            </NScrollbar>
          </div>
        </NPopover>
        <NButton
          type="primary"
          :loading="streaming"
          :disabled="!input.trim() || streaming || !currentConn"
          @click="() => send()"
        >送出</NButton>
        <NButton v-if="streaming" type="error" @click="stream.abort()">中斷</NButton>
      </div>
    </div>

    <NDrawer v-model:show="drawerOpen" :width="520" placement="right">
      <NDrawerContent title="思考過程">
        <div v-if="drawerThoughts && drawerThoughts.length" class="space-y-4">
          <div
            v-for="(t, i) in drawerThoughts"
            :key="i"
            class="border border-slate-200 rounded-lg p-3"
          >
            <div class="text-xs text-slate-400">Step {{ i + 1 }}</div>
            <div class="font-mono text-sm font-semibold text-brand-600 mt-1">{{ t.action }}</div>
            <div class="text-xs text-slate-500 mt-2">輸入</div>
            <pre class="text-xs bg-slate-50 p-2 rounded mt-1 overflow-x-auto whitespace-pre-wrap">{{ t.action_input }}</pre>
            <template v-if="t.observation">
              <div class="text-xs text-slate-500 mt-2">輸出</div>
              <pre class="text-xs bg-slate-50 p-2 rounded mt-1 overflow-x-auto whitespace-pre-wrap max-h-60">{{ t.observation }}</pre>
            </template>
          </div>
        </div>
        <NEmpty v-else description="無思考記錄" />
      </NDrawerContent>
    </NDrawer>

    <NModal v-model:show="refineOpen" preset="card" title="修正 SQL 並執行" :style="{ width: '720px' }">
      <div class="space-y-3">
        <div class="text-xs text-slate-500">調整以下 SQL（將直接執行，不再經過 LLM）：</div>
        <NInput
          v-model:value="refineSql"
          type="textarea"
          :autosize="{ minRows: 6, maxRows: 18 }"
          placeholder="SELECT ..."
          class="!font-mono"
        />
        <NInput
          v-model:value="refineNote"
          placeholder="（選填）說明調整原因"
          maxlength="500"
          show-count
        />
        <div class="text-xs text-slate-400">
          將以連線「{{ currentConn }}」執行，遵循目前角色的 SQL 動詞白名單與列數上限。
        </div>
        <!-- Warnings from last execution -->
        <div
          v-if="refineWarnings.length > 0"
          class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2"
        >
          <div class="flex items-center gap-1.5 text-xs font-semibold text-amber-700 mb-1">
            <span>⚠️</span> 資料品質提醒（結果已加入對話，但請注意以下問題）
          </div>
          <ul class="space-y-0.5">
            <li
              v-for="(w, wi) in refineWarnings"
              :key="wi"
              class="text-xs text-amber-700 list-disc list-inside"
            >{{ w }}</li>
          </ul>
          <div class="mt-2 flex justify-end">
            <NButton size="tiny" @click="refineOpen = false">關閉</NButton>
          </div>
        </div>
      </div>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="refineOpen = false">取消</NButton>
          <NButton type="primary" :loading="refineLoading" @click="submitRefine">執行</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
