<script setup lang="ts">
import {
  NButton, NCard, NDataTable, NDynamicTags, NEmpty, NInput, NInputGroup, NModal, NSelect, NSpace, NSpin,
  NSwitch, NTag, useDialog, useMessage,
  type DataTableColumns,
} from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import { navigateTo } from 'nuxt/app'
import { useApi } from '../composables/useApi'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ title: '收藏' })

interface Insight {
  id: number
  owner_user_id: number | null
  title: string
  description: string
  kind: 'sql' | 'chart' | 'answer'
  conn_name: string | null
  sql: string
  chart_config: string
  tags: string[]
  pinned: boolean
  created_at?: string
  updated_at?: string
}
interface ConnInfo { name: string; alive?: boolean }

const api = useApi()
const message = useMessage()
const dialog = useDialog()

const items = ref<Insight[]>([])
const conns = ref<ConnInfo[]>([])
const loading = ref(false)
const search = ref('')
const filterKind = ref<string | null>(null)
const showAll = ref(false)

const kindOptions = [
  { label: '全部', value: '' },
  { label: 'SQL', value: 'sql' },
  { label: '圖表', value: 'chart' },
  { label: '回答', value: 'answer' },
]
const chartTypeOptions = [
  { label: '長條圖', value: 'bar' },
  { label: '折線圖', value: 'line' },
  { label: '圓餅圖', value: 'pie' },
  { label: '表格', value: 'table' },
]
const connOptions = computed(() => conns.value.map(c => ({
  label: c.alive === false ? `${c.name}（異常）` : c.name,
  value: c.name,
})))

let searchTimer: ReturnType<typeof setTimeout> | null = null

async function load() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (search.value.trim()) params.set('q', search.value.trim())
    if (filterKind.value) params.set('kind', filterKind.value)
    if (showAll.value) params.set('all_users', 'true')
    params.set('limit', '200')
    const [insights, connResp] = await Promise.all([
      api.get<Insight[]>(`/v1/insights?${params.toString()}`),
      api.get<{ connections: ConnInfo[] }>('/v1/connections'),
    ])
    items.value = insights
    conns.value = connResp.connections ?? []
  } catch (e: unknown) {
    message.error((e as { data?: { detail?: string }; message?: string })?.data?.detail
      ?? (e as { message?: string })?.message ?? '載入失敗')
  } finally { loading.value = false }
}

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(load, 300)
}

// ── New / edit modal ───────────────────────────────────────────────────
const showModal = ref(false)
const editing = ref<Insight | null>(null)
const form = ref({
  title: '', description: '', kind: 'sql' as 'sql' | 'chart' | 'answer',
  conn_name: '', sql: '', tags: [] as string[], pinned: false,
  chart_type: 'bar', chart_x: '', chart_y: '',
})

function openNew() {
  editing.value = null
  form.value = {
    title: '', description: '', kind: 'sql', conn_name: '', sql: '',
    tags: [], pinned: false, chart_type: 'bar', chart_x: '', chart_y: '',
  }
  showModal.value = true
}
function openEdit(it: Insight) {
  editing.value = it
  let chart: Record<string, unknown> = {}
  try {
    chart = it.chart_config ? JSON.parse(it.chart_config) : {}
  } catch {
    chart = {}
  }
  form.value = {
    title: it.title, description: it.description, kind: it.kind,
    conn_name: it.conn_name ?? '', sql: it.sql,
    tags: [...it.tags], pinned: it.pinned,
    chart_type: typeof chart.type === 'string' ? chart.type : 'bar',
    chart_x: typeof chart.x === 'string' ? chart.x : '',
    chart_y: typeof chart.y === 'string' ? chart.y : '',
  }
  showModal.value = true
}
async function save() {
  if (!form.value.title.trim()) { message.warning('請輸入標題'); return }
  const payload = {
    title: form.value.title.trim(),
    description: form.value.description,
    kind: form.value.kind,
    conn_name: form.value.conn_name || null,
    sql: form.value.sql,
    chart_config: form.value.kind === 'chart'
      ? JSON.stringify({
          type: form.value.chart_type,
          x: form.value.chart_x,
          y: form.value.chart_y,
        })
      : '',
    tags: form.value.tags,
    pinned: form.value.pinned,
  }
  try {
    if (editing.value) {
      await api.patch(`/v1/insights/${editing.value.id}`, payload)
      message.success('已更新')
    } else {
      await api.post('/v1/insights', payload)
      message.success('已新增')
    }
    showModal.value = false
    load()
  } catch (e: unknown) {
    message.error((e as { data?: { detail?: string }; message?: string })?.data?.detail
      ?? (e as { message?: string })?.message ?? '儲存失敗')
  }
}

async function togglePin(it: Insight) {
  try {
    await api.patch(`/v1/insights/${it.id}`, { pinned: !it.pinned })
    load()
  } catch { message.error('操作失敗') }
}

function confirmDelete(it: Insight) {
  dialog.warning({
    title: '刪除收藏',
    content: `確定刪除「${it.title}」？此操作無法復原。`,
    positiveText: '刪除', negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.del(`/v1/insights/${it.id}`)
        message.success('已刪除')
        load()
      } catch { message.error('刪除失敗') }
    },
  })
}

function useInChat(it: Insight) {
  // Drop the SQL/title into the chat composer via query param.
  const q = it.sql
    ? `請執行以下 SQL：\n\`\`\`sql\n${it.sql}\n\`\`\``
    : it.title
  navigateTo(`/chat?q=${encodeURIComponent(q)}`)
}

const cols = computed<DataTableColumns<Insight>>(() => ([
  { title: '', key: 'pinned', width: 40,
    render: (r) => h('span', {
      class: 'cursor-pointer ' + (r.pinned ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'),
      onClick: () => togglePin(r),
    }, r.pinned ? '★' : '☆') },
  { title: '標題', key: 'title',
    render: (r) => h('div', {}, [
      h('div', { class: 'font-semibold' }, r.title),
      r.description ? h('div', { class: 'text-xs text-slate-500 mt-0.5' }, r.description) : null,
    ]) },
  { title: '類型', key: 'kind', width: 80,
    render: (r) => h(NTag, { size: 'small',
      type: r.kind === 'sql' ? 'info' : r.kind === 'chart' ? 'success' : 'default',
      bordered: false,
    }, () => r.kind.toUpperCase()) },
  { title: '連線', key: 'conn_name', width: 120,
    render: (r) => r.conn_name ? h('code', { class: 'text-xs' }, r.conn_name) : '—' },
  { title: '標籤', key: 'tags',
    render: (r) => r.tags.length
      ? h(NSpace, { size: 'small' }, () => r.tags.map(t =>
          h(NTag, { size: 'small', bordered: false }, () => t)))
      : '—' },
  { title: '更新時間', key: 'updated_at', width: 170,
    render: (r) => h('span', { class: 'text-xs text-slate-500' },
      r.updated_at ? new Date(r.updated_at).toLocaleString() : '—') },
  { title: '操作', key: 'op', width: 220,
    render: (r) => h(NSpace, { size: 'small' }, () => [
      h(NButton, { size: 'tiny', onClick: () => useInChat(r) }, () => '在對話中使用'),
      h(NButton, { size: 'tiny', onClick: () => openEdit(r) }, () => '編輯'),
      h(NButton, { size: 'tiny', type: 'error', ghost: true, onClick: () => confirmDelete(r) }, () => '刪除'),
    ]) },
]))

onMounted(load)
</script>

<template>
  <div class="space-y-3">
    <NCard size="small">
      <div class="flex items-center gap-2 flex-wrap">
        <div class="text-sm font-semibold mr-2">收藏 / Saved Insights</div>
        <NInputGroup class="!w-72">
          <NInput v-model:value="search" placeholder="搜尋標題/SQL/標籤" clearable
                  @input="onSearchInput" />
        </NInputGroup>
        <NSelect v-model:value="filterKind" :options="kindOptions" class="!w-32" size="small"
                 clearable @update:value="load" />
        <div class="flex items-center gap-2 text-xs">
          <span>顯示全部使用者</span>
          <NSwitch v-model:value="showAll" size="small" @update:value="load" />
        </div>
        <div class="ml-auto">
          <NButton type="primary" size="small" @click="openNew">+ 新增收藏</NButton>
        </div>
      </div>
    </NCard>

    <NSpin :show="loading">
      <NCard v-if="!loading && items.length === 0" size="small">
        <NEmpty description="目前沒有收藏。點右上方的「+ 新增收藏」開始整理常用 SQL 或圖表。" />
      </NCard>
      <NCard v-else size="small">
        <NDataTable :columns="cols" :data="items" :row-key="(r: Insight) => r.id"
                    :bordered="false" size="small" />
      </NCard>
    </NSpin>

    <NModal v-model:show="showModal" preset="card" :title="editing ? '編輯收藏' : '新增收藏'"
            style="max-width: 720px;">
      <div class="space-y-3">
        <div>
          <div class="text-xs text-slate-500 mb-1">標題 *</div>
          <NInput v-model:value="form.title" placeholder="例如：上月活躍用戶 TOP10" />
        </div>
        <div>
          <div class="text-xs text-slate-500 mb-1">描述</div>
          <NInput v-model:value="form.description" type="textarea" :rows="2"
                  placeholder="這個 SQL/圖表的用途說明" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <div class="text-xs text-slate-500 mb-1">類型</div>
            <NSelect v-model:value="form.kind" :options="kindOptions.filter(o => o.value)" />
          </div>
          <div>
            <div class="text-xs text-slate-500 mb-1">連線</div>
            <NSelect
              v-model:value="form.conn_name"
              :options="connOptions"
              filterable
              clearable
              placeholder="選擇資料連線"
            />
          </div>
        </div>
        <div>
          <div class="text-xs text-slate-500 mb-1">SQL</div>
          <NInput v-model:value="form.sql" type="textarea" :rows="6"
                  placeholder="SELECT ..." class="!font-mono" />
        </div>
        <div v-if="form.kind === 'chart'">
          <div class="text-xs text-slate-500 mb-1">Chart 設定（）</div>
          <div class="grid grid-cols-3 gap-3">
            <NSelect v-model:value="form.chart_type" :options="chartTypeOptions" />
            <NInput v-model:value="form.chart_x" placeholder="X 軸欄位" />
            <NInput v-model:value="form.chart_y" placeholder="Y 軸欄位" />
          </div>
        </div>
        <div>
          <div class="text-xs text-slate-500 mb-1">標籤（用逗號分隔）</div>
          <NDynamicTags v-model:value="form.tags" />
        </div>
        <div class="flex items-center gap-2">
          <NSwitch v-model:value="form.pinned" size="small" />
          <span class="text-xs">置頂</span>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <NButton @click="showModal = false">取消</NButton>
          <NButton type="primary" @click="save">儲存</NButton>
        </div>
      </div>
    </NModal>
  </div>
</template>

