/**
 * Streaming chat composable.
 * Uses fetch + ReadableStream to consume the SSE response from POST /v1/chat
 * (EventSource cannot do POST so we parse the SSE manually).
 *
 * Event schema (from api/streaming.py):
 *   event: token        -> { token, is_final? }
 *   event: flow_trace   -> { steps: [{name,status,output,latency_ms}] }
 *   event: query_plan   -> { query_plan, sql }
 *   event: thought      -> { action, action_input }
 *   event: observation  -> { observation }
 *   event: finish       -> { answer }
 *   event: suggestions  -> { suggestions, title, summary, entities }
 *   event: error        -> { error }
 */

import { useAuthStore } from '../stores/auth'

export interface ChatThought {
  action: string
  action_input: string
  observation?: string
}

export interface ChatStreamCallbacks {
  onToken?(token: string, isFinal: boolean): void
  onThought?(t: ChatThought): void
  onObservation?(obs: string, lastThought?: ChatThought): void
  onFinish?(answer: string, payload?: Record<string, unknown>): void
  onAnswerPlan?(answerPlan: Record<string, unknown>): void
  onWarnings?(warnings: string[]): void
  onSuggestions?(data: { suggestions: string[]; title: string; summary: string; entities: string[] }): void
  onError?(err: string): void
}

export interface ChatStreamRequest {
  message: string
  session_id: string
  conn_name?: string
}

export function useChatStream() {
  const cfg = useRuntimeConfig()
  const auth = useAuthStore()

  let abortCtrl: AbortController | null = null

  async function send(req: ChatStreamRequest, cbs: ChatStreamCallbacks) {
    abortCtrl?.abort()
    abortCtrl = new AbortController()

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }
    if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`

    let resp: Response
    try {
      resp = await fetch(`${cfg.public.apiBase}/v1/chat`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          message: req.message,
          session_id: req.session_id,
          conn_name: req.conn_name ?? 'default',
        }),
        signal: abortCtrl.signal,
      })
    } catch (e: unknown) {
      cbs.onError?.((e as Error)?.message ?? '連線失敗')
      return
    }

    if (resp.status === 401 && (await auth.refresh())) {
      // retry once with fresh token
      headers.Authorization = `Bearer ${auth.accessToken}`
      resp = await fetch(`${cfg.public.apiBase}/v1/chat`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          message: req.message,
          session_id: req.session_id,
          conn_name: req.conn_name ?? 'default',
        }),
        signal: abortCtrl.signal,
      })
    }

    if (!resp.ok || !resp.body) {
      cbs.onError?.(`HTTP ${resp.status}: ${await resp.text().catch(() => '')}`)
      return
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let lastThought: ChatThought | undefined

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE messages are separated by a blank line ("\n\n")
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const ev = parseEvent(raw)
          if (!ev) continue
          dispatch(ev.event, ev.data, cbs, (t) => { lastThought = t }, lastThought)
        }
      }
    } catch (e: unknown) {
      if ((e as Error)?.name !== 'AbortError') {
        cbs.onError?.((e as Error)?.message ?? 'stream error')
      }
    }
  }

  function abort() {
    abortCtrl?.abort()
    abortCtrl = null
  }

  return { send, abort }
}

function parseEvent(raw: string): { event: string; data: string } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}

function dispatch(
  event: string,
  data: string,
  cbs: ChatStreamCallbacks,
  setLastThought: (t: ChatThought) => void,
  lastThought?: ChatThought,
) {
  let payload: Record<string, unknown> = {}
  try { payload = JSON.parse(data) } catch { return }

  switch (event) {
    case 'token':
      cbs.onToken?.(String(payload.token ?? ''), Boolean(payload.is_final))
      break
    case 'thought': {
      const t: ChatThought = {
        action: String(payload.action ?? ''),
        action_input: String(payload.action_input ?? ''),
      }
      setLastThought(t)
      cbs.onThought?.(t)
      break
    }
    case 'query_plan': {
      const t: ChatThought = {
        action: 'query_plan',
        action_input: JSON.stringify(payload.query_plan ?? payload, null, 2),
        observation: String(payload.sql ?? ''),
      }
      setLastThought(t)
      cbs.onThought?.(t)
      break
    }
    case 'flow_trace': {
      const steps = Array.isArray(payload.steps) ? payload.steps : []
      for (const step of steps) {
        if (!step || typeof step !== 'object') continue
        const row = step as Record<string, unknown>
        const output = row.output && typeof row.output === 'object'
          ? row.output as Record<string, unknown>
          : {}
        const t: ChatThought = {
          action: String(row.name ?? 'agent_step'),
          action_input: summarizeTraceInput(row.input),
          observation: summarizeTraceOutput(String(row.status ?? 'success'), output, row.error, row.latency_ms),
        }
        setLastThought(t)
        cbs.onThought?.(t)
      }
      break
    }
    case 'observation':
      cbs.onObservation?.(String(payload.observation ?? ''), lastThought)
      break
    case 'finish':
      cbs.onFinish?.(String(payload.answer ?? ''), payload)
      if (payload.answer_plan && typeof payload.answer_plan === 'object') {
        cbs.onAnswerPlan?.(payload.answer_plan as Record<string, unknown>)
      }
      // followup_questions come in the finish event; surface them as suggestions
      {
        const followups = (payload.followup_questions as string[] | undefined) ?? []
        if (followups.length > 0) {
          cbs.onSuggestions?.({
            suggestions: followups,
            title: '',
            summary: '',
            entities: [],
          })
        }
      }
      // data quality warnings
      {
        const w = (payload.warnings as string[] | undefined) ?? []
        if (w.length > 0) cbs.onWarnings?.(w)
      }
      break
    case 'suggestions':
      cbs.onSuggestions?.({
        suggestions: (payload.suggestions as string[]) ?? [],
        title: String(payload.title ?? ''),
        summary: String(payload.summary ?? ''),
        entities: (payload.entities as string[]) ?? [],
      })
      break
    case 'error':
      cbs.onError?.(String(payload.error ?? 'unknown error'))
      break
  }
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
