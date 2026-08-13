<script setup lang="ts">
import {
  NButton, NCard, NDataTable, NDatePicker, NInput, NPagination, NSelect, NSpace, NTag,
  useMessage, type DataTableColumns,
} from 'naive-ui'
import { h, onMounted, reactive, ref } from 'vue'
import { useApi } from '../../composables/useApi'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ title: '管理 / 審計' })

interface AuditRow {
  id: number
  session_id?: string
  api_key_prefix?: string
  event_type?: string
  tool_name?: string
  conn_name?: string
  status?: string
  duration_ms?: number
  detail?: string
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
  model_name?: string | null
  error_msg?: string
  created_at?: string
}

const api = useApi()
const message = useMessage()

const rows = ref<AuditRow[]>([])
const total = ref(0)
const loading = ref(false)

const filters = reactive({
  event_type: '',
  api_key_prefix: '',
  date_from: null as number | null,
  date_to: null as number | null,
  page: 1,
  size: 50,
})

const eventOptions = [
  { label: '全部', value: '' },
  { label: 'agent_invoke', value: 'agent_invoke' },
  { label: 'agent_flow_trace', value: 'agent_flow_trace' },
  { label: 'tool_call', value: 'tool_call' },
  { label: 'auth', value: 'auth' },
]

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    params.set('page', String(filters.page))
    params.set('size', String(filters.size))
    if (filters.event_type) params.set('event_type', filters.event_type)
    if (filters.api_key_prefix) params.set('api_key_prefix', filters.api_key_prefix)
    if (filters.date_from) params.set('date_from', new Date(filters.date_from).toISOString())
    if (filters.date_to)   params.set('date_to',   new Date(filters.date_to).toISOString())

    const r = await api.get<{ items: AuditRow[]; total: number; page: number; size: number }>(
      `/v1/admin/audit-logs?${params.toString()}`,
    )
    rows.value = r.items
    total.value = r.total
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '載入失敗')
  } finally { loading.value = false }
}

function onSearch() { filters.page = 1; load() }
function onReset() {
  Object.assign(filters, { event_type: '', api_key_prefix: '', date_from: null, date_to: null, page: 1 })
  load()
}

const columns: DataTableColumns<AuditRow> = [
  { title: 'ID', key: 'id', width: 80 },
  { title: '時間', key: 'created_at', width: 180 },
  { title: '事件', key: 'event_type', width: 130,
    render: (r) => h(NTag, { size: 'small', bordered: false, type: 'info' }, () => r.event_type ?? '') },
  { title: 'Tool', key: 'tool_name', width: 140 },
  { title: 'Conn', key: 'conn_name', width: 100 },
  { title: 'Session', key: 'session_id', width: 160,
    render: (r) => h('span', { class: 'text-xs text-slate-500' }, r.session_id ?? '') },
  { title: 'KeyPrefix', key: 'api_key_prefix', width: 100,
    render: (r) => h('code', { class: 'text-xs' }, r.api_key_prefix ?? '') },
  {
    title: '狀態', key: 'status', width: 80,
    render: (r) => h(NTag, {
      size: 'small', bordered: false,
      type: r.status === 'error' ? 'error' : r.status === 'success' ? 'success' : 'default',
    }, () => r.status ?? ''),
  },
  { title: '耗時 (ms)', key: 'duration_ms', width: 90 },
  { title: 'Tokens', key: 'total_tokens', width: 100,
    render: (r) => h('span', { class: 'text-xs text-slate-500' }, r.total_tokens ? String(r.total_tokens) : '') },
  { title: '輸入/輸出', key: 'detail',
    render: (r) => h('span', { class: 'text-xs text-slate-500 line-clamp-2' }, r.detail ?? '') },
  { title: '錯誤', key: 'error_msg',
    render: (r) => h('span', { class: 'text-xs text-red-500 line-clamp-2' }, r.error_msg ?? '') },
]

onMounted(load)
</script>

<template>
  <div>
    <AdminTabs />

    <NCard size="small" title="篩選" class="mb-3">
      <NSpace align="end" :wrap-item="false">
        <div>
          <div class="text-xs text-slate-500 mb-1">事件類型</div>
          <NSelect v-model:value="filters.event_type" :options="eventOptions" style="width:140px" size="small" />
        </div>
        <div>
          <div class="text-xs text-slate-500 mb-1">API Key Prefix</div>
          <NInput v-model:value="filters.api_key_prefix" size="small" style="width:140px" />
        </div>
        <div>
          <div class="text-xs text-slate-500 mb-1">起始</div>
          <NDatePicker v-model:value="filters.date_from" type="datetime" size="small" style="width:200px" />
        </div>
        <div>
          <div class="text-xs text-slate-500 mb-1">結束</div>
          <NDatePicker v-model:value="filters.date_to" type="datetime" size="small" style="width:200px" />
        </div>
        <NButton type="primary" size="small" @click="onSearch">查詢</NButton>
        <NButton size="small" @click="onReset">重設</NButton>
      </NSpace>
    </NCard>

    <NCard>
      <NDataTable
        :columns="columns"
        :data="rows"
        :loading="loading"
        :row-key="(r: AuditRow) => r.id"
        :bordered="false"
        size="small"
      />
      <div class="flex justify-end mt-3">
        <NPagination
          v-model:page="filters.page"
          v-model:page-size="filters.size"
          :item-count="total"
          :page-sizes="[20, 50, 100, 200]"
          show-size-picker
          @update:page="load"
          @update:page-size="load"
        />
      </div>
    </NCard>
  </div>
</template>
