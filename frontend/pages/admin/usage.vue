<script setup lang="ts">
import {
  NAlert, NButton, NCard, NDataTable, NEmpty, NSelect, NSpace, NSpin, NStatistic, NTag, useMessage,
  type DataTableColumns,
} from 'naive-ui'
import { computed, h, onMounted, ref, watch } from 'vue'
import { useApi } from '../../composables/useApi'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ title: '管理 / 用量統計' })

interface DailyPoint { date: string; calls: number; errors: number; avg_duration_ms: number }
interface ConnRow   { conn_name: string; calls: number; errors: number; avg_duration_ms: number }
interface ToolRow   { tool_name: string; calls: number; avg_duration_ms: number }
interface EventRow  { event_type: string; count: number }
interface PrefixRow { api_key_prefix: string; count: number }
interface TokenTotals { prompt_tokens: number; completion_tokens: number; total_tokens: number }
interface TokenDayPoint { date: string; prompt_tokens: number; completion_tokens: number; total_tokens: number }
interface ModelRow { model_name: string; calls: number; prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_usd: number }
interface UserRow  { user_id: number | null; calls: number; prompt_tokens: number; completion_tokens: number; total_tokens: number }

interface UsageResp {
  total_calls: number
  total_errors: number
  error_rate: number
  window_days: number
  daily_series: DailyPoint[]
  calls_by_conn: ConnRow[]
  calls_by_tool: ToolRow[]
  calls_by_event: EventRow[]
  calls_by_api_key_prefix: PrefixRow[]
  token_totals?: TokenTotals
  token_daily_series?: TokenDayPoint[]
  token_by_model?: ModelRow[]
  token_by_user?: UserRow[]
}

const api = useApi()
const message = useMessage()
const data = ref<UsageResp | null>(null)
const loading = ref(false)
const loadError = ref('')
const days = ref(7)
const dayOptions = [
  { label: '近 1 天', value: 1 },
  { label: '近 7 天', value: 7 },
  { label: '近 14 天', value: 14 },
  { label: '近 30 天', value: 30 },
  { label: '近 90 天', value: 90 },
]

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    data.value = await api.get<UsageResp>(`/v1/admin/usage-stats?days=${days.value}`)
  } catch (e: unknown) {
    const msg = (e as { data?: { detail?: string }; message?: string })?.data?.detail
      ?? (e as { message?: string })?.message ?? '載入失敗'
    loadError.value = msg
    message.error(msg)
  } finally { loading.value = false }
}

// Pre-compute max for the inline bar chart's scale
const maxDaily = computed(() => {
  if (!data.value?.daily_series.length) return 1
  return Math.max(...data.value.daily_series.map((d) => d.calls), 1)
})

const connCols: DataTableColumns<ConnRow> = [
  { title: '連線', key: 'conn_name',
    render: (r) => h(NTag, { size: 'small', type: 'info', bordered: false }, () => r.conn_name) },
  { title: '呼叫數', key: 'calls', width: 100 },
  { title: '錯誤數', key: 'errors', width: 100,
    render: (r) => h('span', { class: r.errors ? 'text-red-500' : '' }, r.errors) },
  { title: '平均延遲 (ms)', key: 'avg_duration_ms', width: 130 },
]

const toolCols: DataTableColumns<ToolRow> = [
  { title: '工具', key: 'tool_name',
    render: (r) => h(NTag, { size: 'small', type: 'success', bordered: false }, () => r.tool_name) },
  { title: '呼叫數', key: 'calls', width: 100 },
  { title: '平均延遲 (ms)', key: 'avg_duration_ms', width: 130 },
]

const eventCols: DataTableColumns<EventRow> = [
  { title: '事件類型', key: 'event_type' },
  { title: '呼叫數', key: 'count', width: 100 },
]

const prefixCols: DataTableColumns<PrefixRow> = [
  { title: 'API Key prefix', key: 'api_key_prefix',
    render: (r) => h('code', { class: 'text-xs' }, r.api_key_prefix) },
  { title: '呼叫數', key: 'count', width: 100 },
]

const modelCols: DataTableColumns<ModelRow> = [
  { title: '模型', key: 'model_name',
    render: (r) => h(NTag, { size: 'small', type: 'warning', bordered: false }, () => r.model_name) },
  { title: '呼叫數', key: 'calls', width: 80 },
  { title: 'Prompt', key: 'prompt_tokens', width: 100,
    render: (r) => h('span', { class: 'tabular-nums' }, r.prompt_tokens.toLocaleString()) },
  { title: 'Completion', key: 'completion_tokens', width: 110,
    render: (r) => h('span', { class: 'tabular-nums' }, r.completion_tokens.toLocaleString()) },
  { title: 'Total', key: 'total_tokens', width: 100,
    render: (r) => h('span', { class: 'tabular-nums font-semibold' }, r.total_tokens.toLocaleString()) },
  { title: '估算成本 (USD)', key: 'cost_usd', width: 130,
    render: (r) => h('span', { class: 'tabular-nums text-emerald-600' }, '$' + r.cost_usd.toFixed(4)) },
]

const totalCostUsd = computed(() => {
  return (data.value?.token_by_model ?? []).reduce((acc, r) => acc + (r.cost_usd || 0), 0)
})
const maxTokenDay = computed(() => {
  const arr = data.value?.token_daily_series ?? []
  return Math.max(1, ...arr.map(r => r.total_tokens))
})
const maxUserTokens = computed(() => {
  const arr = data.value?.token_by_user ?? []
  return Math.max(1, ...arr.map(r => r.total_tokens))
})

const userCols: DataTableColumns<UserRow> = [
  { title: 'User ID', key: 'user_id', width: 90,
    render: (r) => h('code', { class: 'text-xs' }, r.user_id != null ? String(r.user_id) : '—') },
  { title: '呼叫次數', key: 'calls', width: 90 },
  { title: 'Prompt', key: 'prompt_tokens', width: 100,
    render: (r) => h('span', { class: 'tabular-nums' }, r.prompt_tokens.toLocaleString()) },
  { title: 'Completion', key: 'completion_tokens', width: 110,
    render: (r) => h('span', { class: 'tabular-nums' }, r.completion_tokens.toLocaleString()) },
  { title: 'Total Tokens', key: 'total_tokens', width: 120,
    render: (r) => h('span', { class: 'tabular-nums font-semibold' }, r.total_tokens.toLocaleString()),
    sorter: (a, b) => a.total_tokens - b.total_tokens,
    defaultSortOrder: 'descend' },
]

onMounted(load)
watch(days, load)
</script>

<template>
  <div>
    <AdminTabs />

    <NCard size="small" class="mb-3">
      <div class="flex items-center gap-3">
        <div class="text-sm font-semibold">用量統計</div>
        <NSelect
          v-model:value="days"
          :options="dayOptions"
          size="small"
          class="!w-32"
        />
        <div class="ml-auto text-xs text-slate-400">
          視窗：近 {{ data?.window_days ?? days }} 天 ｜ 總計為歷史累計
        </div>
      </div>
    </NCard>

    <NSpin :show="loading">
      <NAlert v-if="loadError && !data" type="error" :title="'載入失敗'" class="mb-3" closable>
        <div class="flex items-center justify-between gap-3">
          <div class="text-sm">{{ loadError }}</div>
          <NButton size="small" @click="load">重試</NButton>
        </div>
      </NAlert>

      <NCard v-if="!loading && !data && !loadError" size="small">
        <NEmpty description="尚無資料" />
      </NCard>

      <div v-if="data" class="space-y-3">
        <!-- KPI cards -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <NCard size="small">
            <NStatistic label="總呼叫數" :value="data.total_calls" />
          </NCard>
          <NCard size="small">
            <NStatistic label="總錯誤數" :value="data.total_errors"
                        :value-style="{ color: data.total_errors ? '#d03050' : undefined }" />
          </NCard>
          <NCard size="small">
            <NStatistic label="錯誤率" :value="(data.error_rate * 100).toFixed(2)" suffix="%"
                        :value-style="{ color: data.error_rate > 0.05 ? '#d03050' : '#18a058' }" />
          </NCard>
        </div>

        <!-- Token cost KPIs (window) -->
        <div v-if="data.token_totals" class="grid grid-cols-1 md:grid-cols-4 gap-3">
          <NCard size="small">
            <NStatistic label="Total Tokens (視窗內)" :value="data.token_totals.total_tokens.toLocaleString()" />
          </NCard>
          <NCard size="small">
            <NStatistic label="Prompt Tokens" :value="data.token_totals.prompt_tokens.toLocaleString()" />
          </NCard>
          <NCard size="small">
            <NStatistic label="Completion Tokens" :value="data.token_totals.completion_tokens.toLocaleString()" />
          </NCard>
          <NCard size="small">
            <NStatistic label="估算成本" :value="'$' + totalCostUsd.toFixed(4)" suffix=" USD"
                        :value-style="{ color: '#18a058' }" />
          </NCard>
        </div>

        <!-- Daily bar chart (inline SVG-free, dependency-free) -->
        <NCard title="每日呼叫趨勢" size="small">
          <div v-if="!data.daily_series.length" class="text-sm text-slate-400 py-6 text-center">
            此區間無資料
          </div>
          <div v-else class="space-y-1">
            <div
              v-for="d in data.daily_series"
              :key="d.date"
              class="flex items-center gap-3 text-xs"
            >
              <div class="w-24 text-slate-500 font-mono">{{ d.date }}</div>
              <div class="flex-1 bg-slate-100 rounded h-5 overflow-hidden relative">
                <div
                  class="absolute inset-y-0 left-0 bg-brand-500"
                  :style="{ width: `${(d.calls / maxDaily) * 100}%` }"
                />
                <div
                  v-if="d.errors"
                  class="absolute inset-y-0 left-0 bg-red-400 opacity-70"
                  :style="{ width: `${(d.errors / maxDaily) * 100}%` }"
                />
              </div>
              <div class="w-20 text-right tabular-nums">{{ d.calls }} 次</div>
              <div class="w-24 text-right text-red-500 tabular-nums">
                {{ d.errors }} 錯誤
              </div>
              <div class="w-20 text-right text-slate-500 tabular-nums">
                {{ d.avg_duration_ms }}ms
              </div>
            </div>
          </div>
        </NCard>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <NCard title="連線使用排行（視窗內）" size="small">
            <NDataTable :columns="connCols" :data="data.calls_by_conn"
                        :row-key="(r: ConnRow) => r.conn_name" :bordered="false" size="small" />
          </NCard>
          <NCard title="工具呼叫排行（視窗內）" size="small">
            <NDataTable :columns="toolCols" :data="data.calls_by_tool"
                        :row-key="(r: ToolRow) => r.tool_name" :bordered="false" size="small" />
          </NCard>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <NCard title="事件類型分布（全期）" size="small">
            <NDataTable :columns="eventCols" :data="data.calls_by_event"
                        :row-key="(r: EventRow) => r.event_type" :bordered="false" size="small" />
          </NCard>
          <NCard title="呼叫者排行（全期）" size="small">
            <NDataTable :columns="prefixCols" :data="data.calls_by_api_key_prefix"
                        :row-key="(r: PrefixRow) => r.api_key_prefix" :bordered="false" size="small" />
          </NCard>
        </div>

        <!-- Token daily trend -->
        <NCard v-if="data.token_daily_series?.length" title="每日 Token 使用" size="small">
          <div class="space-y-1">
            <div v-for="d in data.token_daily_series" :key="'tk' + d.date"
                 class="flex items-center gap-3 text-xs">
              <div class="w-24 text-slate-500 font-mono">{{ d.date }}</div>
              <div class="flex-1 bg-slate-100 rounded h-5 overflow-hidden relative">
                <div class="absolute inset-y-0 left-0 bg-amber-400"
                     :style="{ width: `${(d.total_tokens / maxTokenDay) * 100}%` }" />
              </div>
              <div class="w-28 text-right tabular-nums font-semibold">{{ d.total_tokens.toLocaleString() }}</div>
              <div class="w-24 text-right text-slate-500 tabular-nums">in: {{ d.prompt_tokens.toLocaleString() }}</div>
              <div class="w-24 text-right text-slate-500 tabular-nums">out: {{ d.completion_tokens.toLocaleString() }}</div>
            </div>
          </div>
        </NCard>

        <NCard v-if="data.token_by_model?.length" title="模型使用與成本（視窗內）" size="small">
          <NDataTable :columns="modelCols" :data="data.token_by_model"
                      :row-key="(r: ModelRow) => r.model_name" :bordered="false" size="small" />
        </NCard>

        <!-- Per-user token breakdown -->
        <NCard v-if="data.token_by_user?.length" title="各帳號 Token 用量（視窗內）" size="small">
          <div class="space-y-1 mb-3">
            <div v-for="u in data.token_by_user" :key="'u' + u.user_id"
                 class="flex items-center gap-3 text-xs">
              <div class="w-16 font-mono text-slate-500">uid={{ u.user_id ?? '—' }}</div>
              <div class="flex-1 bg-slate-100 rounded h-5 overflow-hidden relative">
                <div class="absolute inset-y-0 left-0 bg-violet-400"
                     :style="{ width: `${(u.total_tokens / maxUserTokens) * 100}%` }" />
              </div>
              <div class="w-28 text-right tabular-nums font-semibold">{{ u.total_tokens.toLocaleString() }} tkn</div>
              <div class="w-16 text-right text-slate-500 tabular-nums">{{ u.calls }} 次</div>
            </div>
          </div>
          <NDataTable :columns="userCols" :data="data.token_by_user"
                      :row-key="(r: UserRow) => r.user_id ?? -1" :bordered="false" size="small" />
        </NCard>

        <NCard size="small">
          <NSpace>
            <NTag :bordered="false" type="info" size="small">提示</NTag>
            <div class="text-xs text-slate-500">
              「平均延遲」涵蓋所有事件（包含 agent 呼叫、SQL 工具、匯出等）。
              如需查看單一事件的細節，請至「審計日誌」頁面以事件類型過濾。
            </div>
          </NSpace>
        </NCard>
      </div>
    </NSpin>
  </div>
</template>
