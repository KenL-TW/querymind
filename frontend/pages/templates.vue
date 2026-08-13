<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { navigateTo } from 'nuxt/app'
import {
  NButton, NCard, NEmpty, NForm, NFormItem, NInput, NInputNumber, NList, NListItem,
  NModal, NPopconfirm, NSelect, NSpace, NSwitch, NTag, NThing, useMessage,
} from 'naive-ui'
import { useApi } from '../composables/useApi'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ title: '模板庫' })

interface Template {
  id: string
  db_id?: number
  title: string
  icon?: string
  description?: string
  category?: string
  prompt?: string
  roles?: string[]
  source?: 'builtin' | 'user'
  is_public?: boolean
  owner_user_id?: number | null
  metric_ids?: string[]
  query_plan?: Record<string, unknown>
  chart_config?: Record<string, unknown>
}
interface TemplatesResp { categories: string[]; templates: Template[]; total?: number }
interface SemanticLayer {
  metrics: Record<string, { id: string; label: string; description?: string }>
  dimensions: Record<string, { id: string; label: string; chart_role?: string }>
}

const api = useApi()
const message = useMessage()

const data = ref<TemplatesResp | null>(null)
const semantic = ref<SemanticLayer | null>(null)
const loading = ref(true)
const searchQ = ref('')
const activeCategory = ref<string | null>(null)

// ── Create / Edit modal ────────────────────────────────────────────────────
const modalOpen = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const saving = ref(false)
const editingId = ref<number | null>(null)

interface FormState {
  title: string
  icon: string
  category: string
  prompt: string
  description: string
  is_public: boolean
  metric_ids: string[]
  plan_metric: string | null
  plan_time_range: string
  plan_dimensions: string[]
  plan_sort_direction: 'desc' | 'asc'
  plan_limit: number
  chart_type: string
  chart_x: string | null
  chart_y: string | null
}
const form = ref<FormState>({
  title: '',
  icon: '📌',
  category: '自訂',
  prompt: '',
  description: '',
  is_public: true,
  metric_ids: [],
  plan_metric: null,
  plan_time_range: 'last_30_days',
  plan_dimensions: [],
  plan_sort_direction: 'desc',
  plan_limit: 10,
  chart_type: 'table',
  chart_x: null,
  chart_y: null,
})

function resetForm() {
  form.value = {
    title: '',
    icon: '📌',
    category: '自訂',
    prompt: '',
    description: '',
    is_public: true,
    metric_ids: [],
    plan_metric: null,
    plan_time_range: 'last_30_days',
    plan_dimensions: [],
    plan_sort_direction: 'desc',
    plan_limit: 10,
    chart_type: 'table',
    chart_x: null,
    chart_y: null,
  }
  editingId.value = null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function queryPlanFromTemplate(t: Template): Record<string, unknown> {
  return t.query_plan && typeof t.query_plan === 'object' ? t.query_plan : {}
}

function openCreate() {
  resetForm()
  modalMode.value = 'create'
  modalOpen.value = true
}

function openEdit(t: Template) {
  if (!t.db_id) return
  const plan = queryPlanFromTemplate(t)
  const chart = t.chart_config && typeof t.chart_config === 'object' ? t.chart_config : {}
  const metric = typeof plan.metric === 'string' ? plan.metric : (t.metric_ids?.[0] ?? null)
  const sort = typeof plan.sort === 'string' ? plan.sort : ''
  form.value = {
    title: t.title,
    icon: t.icon ?? '📌',
    category: t.category ?? '自訂',
    prompt: t.prompt ?? '',
    description: t.description ?? '',
    is_public: t.is_public ?? true,
    metric_ids: t.metric_ids ?? [],
    plan_metric: metric,
    plan_time_range: typeof plan.time_range === 'string' ? plan.time_range : 'last_30_days',
    plan_dimensions: stringArray(plan.dimensions),
    plan_sort_direction: sort.toLowerCase().includes(' asc') ? 'asc' : 'desc',
    plan_limit: typeof plan.limit === 'number' ? plan.limit : 10,
    chart_type: typeof chart.type === 'string' ? chart.type : 'table',
    chart_x: typeof chart.x === 'string' ? chart.x : null,
    chart_y: typeof chart.y === 'string' ? chart.y : (metric || null),
  }
  editingId.value = t.db_id
  modalMode.value = 'edit'
  modalOpen.value = true
}

function buildQueryPlan(): Record<string, unknown> {
  const metric = form.value.plan_metric || form.value.metric_ids[0]
  if (!metric) return {}
  return {
    metric,
    time_range: form.value.plan_time_range,
    dimensions: form.value.plan_dimensions,
    sort: `${metric} ${form.value.plan_sort_direction}`,
    limit: form.value.plan_limit,
    chart_type: form.value.chart_type,
    include_metrics: Array.from(new Set([metric, ...form.value.metric_ids])),
  }
}

function buildChartConfig(): Record<string, unknown> {
  if (form.value.chart_type === 'table') return { type: 'table' }
  return {
    type: form.value.chart_type,
    x: form.value.chart_x || form.value.plan_dimensions[0] || '',
    y: form.value.chart_y || form.value.plan_metric || form.value.metric_ids[0] || '',
  }
}

async function saveTemplate() {
  if (!form.value.title.trim()) { message.warning('標題不可為空'); return }
  if (!form.value.prompt.trim()) { message.warning('問題提示不可為空'); return }
  const payload = {
    title: form.value.title,
    icon: form.value.icon,
    category: form.value.category,
    prompt: form.value.prompt,
    description: form.value.description,
    is_public: form.value.is_public,
    metric_ids: form.value.metric_ids,
    query_plan: buildQueryPlan(),
    chart_config: buildChartConfig(),
  }
  saving.value = true
  try {
    if (modalMode.value === 'create') {
      await api.post('/v1/templates', payload)
      message.success('模板已建立')
    } else {
      await api.put(`/v1/templates/user/${editingId.value}`, payload)
      message.success('模板已更新')
    }
    modalOpen.value = false
    await loadTemplates()
  } catch (e: unknown) {
    message.error((e as { data?: { detail?: string }; message?: string })?.data?.detail ?? (e as { message?: string })?.message ?? '儲存失敗')
  } finally {
    saving.value = false
  }
}

async function deleteTemplate(t: Template) {
  if (!t.db_id) return
  try {
    await api.del(`/v1/templates/user/${t.db_id}`)
    message.success('已刪除')
    await loadTemplates()
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '刪除失敗')
  }
}

async function loadTemplates() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (searchQ.value.trim()) params.set('search', searchQ.value.trim())
    if (activeCategory.value) params.set('category', activeCategory.value)
    const qs = params.toString()
    data.value = await api.get<TemplatesResp>(`/v1/templates${qs ? `?${qs}` : ''}`)
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '載入模板失敗')
  } finally {
    loading.value = false
  }
}

async function loadSemanticLayer() {
  try {
    semantic.value = await api.get<SemanticLayer>('/v1/semantic-layer')
  } catch {
    semantic.value = null
  }
}

onMounted(() => {
  loadTemplates()
  loadSemanticLayer()
})

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(loadTemplates, 300)
}

function selectCategory(cat: string | null) {
  activeCategory.value = cat
  loadTemplates()
}

function useTemplate(t: Template) {
  navigateTo(`/chat?q=${encodeURIComponent(t.prompt ?? t.title)}`)
}

const grouped = computed(() => {
  if (!data.value) return []
  const byCat = new Map<string, Template[]>()
  for (const t of data.value.templates) {
    const k = t.category ?? '其他'
    if (!byCat.has(k)) byCat.set(k, [])
    byCat.get(k)!.push(t)
  }
  return Array.from(byCat.entries()).map(([k, items]) => ({ id: k, name: k, items }))
})

const categoryOptions = computed(() =>
  (data.value?.categories ?? []).map(c => ({ label: c, value: c })),
)

const metricOptions = computed(() =>
  Object.values(semantic.value?.metrics ?? {}).map(m => ({
    label: `${m.label} (${m.id})`,
    value: m.id,
  })),
)

const dimensionOptions = computed(() =>
  Object.values(semantic.value?.dimensions ?? {}).map(d => ({
    label: `${d.label} (${d.id})`,
    value: d.id,
  })),
)

const timeRangeOptions = [
  { label: '最近 7 天', value: 'last_7_days' },
  { label: '最近 30 天', value: 'last_30_days' },
  { label: '最近 90 天', value: 'last_90_days' },
  { label: '今年至今', value: 'year_to_date' },
]

const chartTypeOptions = [
  { label: '表格', value: 'table' },
  { label: '長條圖', value: 'bar' },
  { label: '折線圖', value: 'line' },
  { label: '圓餅圖', value: 'pie' },
]

const sortOptions = [
  { label: '由高到低', value: 'desc' },
  { label: '由低到高', value: 'asc' },
]
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-2">
      <h2 class="text-lg font-semibold text-slate-700">📋 模板庫</h2>
      <div class="flex items-center gap-2 flex-wrap">
        <NInput v-model:value="searchQ" placeholder="搜尋標題 / 描述…" clearable size="small" style="width:220px"
          @input="onSearchInput" @clear="loadTemplates" />
        <NButton size="small" type="primary" @click="openCreate">+ 新增自訂模板</NButton>
      </div>
    </div>

    <!-- Category filter -->
    <div v-if="data && data.categories.length > 0" class="flex items-center gap-1.5 flex-wrap">
      <NButton size="tiny" :type="activeCategory === null ? 'primary' : 'default'" :ghost="activeCategory !== null"
        round @click="selectCategory(null)">全部</NButton>
      <NButton v-for="cat in data.categories" :key="cat" size="tiny"
        :type="activeCategory === cat ? 'primary' : 'default'" :ghost="activeCategory !== cat"
        round @click="selectCategory(cat)">{{ cat }}</NButton>
    </div>

    <div v-if="loading" class="text-slate-400 text-sm">載入中…</div>
    <NEmpty v-else-if="!data || data.templates.length === 0" description="沒有符合條件的模板" />

    <NCard v-for="group in grouped" :key="group.id" :title="group.name" size="small">
      <NList hoverable>
        <NListItem v-for="t in group.items" :key="t.id">
          <NThing :title="(t.icon ?? '') + ' ' + t.title">
            <template #description>
              <p class="text-xs text-slate-500 line-clamp-2 mt-0.5">{{ t.description || t.prompt }}</p>
            </template>
            <template #footer>
              <div class="flex items-center justify-between mt-1.5 gap-2 flex-wrap">
                <div class="flex items-center gap-1.5">
                  <NTag size="small" :bordered="false" type="info">{{ t.category }}</NTag>
                  <NTag v-if="t.source === 'user'" size="small" :bordered="false" type="success">自訂</NTag>
                  <NTag v-if="t.is_public === false" size="small" :bordered="false">私人</NTag>
                  <NTag v-for="m in (t.metric_ids ?? [])" :key="m" size="small" :bordered="false" type="warning">{{ m }}</NTag>
                </div>
                <NSpace size="small">
                  <NButton size="tiny" type="primary" ghost @click="useTemplate(t)">立即使用</NButton>
                  <template v-if="t.source === 'user'">
                    <NButton size="tiny" secondary @click="openEdit(t)">編輯</NButton>
                    <NPopconfirm positive-text="確認刪除" negative-text="取消" @positive-click="deleteTemplate(t)">
                      <template #trigger>
                        <NButton size="tiny" type="error" secondary>刪除</NButton>
                      </template>
                      確定刪除模板「{{ t.title }}」嗎？
                    </NPopconfirm>
                  </template>
                </NSpace>
              </div>
            </template>
          </NThing>
        </NListItem>
      </NList>
    </NCard>

    <!-- Create / Edit Modal -->
    <NModal v-model:show="modalOpen" preset="card"
      :title="modalMode === 'create' ? '新增自訂模板' : '編輯模板'"
      :style="{ width: '640px' }" @after-leave="resetForm">
      <NForm label-placement="top">
        <div class="grid grid-cols-2 gap-3">
          <NFormItem label="標題 *" class="col-span-2">
            <NInput v-model:value="form.title" placeholder="模板顯示名稱" maxlength="256" show-count />
          </NFormItem>
          <NFormItem label="分類">
            <NSelect v-model:value="form.category" filterable tag :options="categoryOptions"
              placeholder="選擇或輸入新分類" />
          </NFormItem>
          <NFormItem label="圖示">
            <NInput v-model:value="form.icon" placeholder="Emoji 或文字" maxlength="8" />
          </NFormItem>
          <NFormItem label="問題提示（prompt）*" class="col-span-2">
            <NInput v-model:value="form.prompt" type="textarea" :autosize="{ minRows: 4, maxRows: 12 }"
              placeholder="送給 AI 的自然語言問題，使用者點擊時會直接帶入對話框"
              maxlength="4000" show-count />
          </NFormItem>
          <NFormItem label="說明（選填）" class="col-span-2">
            <NInput v-model:value="form.description" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }"
              placeholder="簡短說明此模板的用途" maxlength="1000" />
          </NFormItem>
          <NFormItem label="綁定指標" class="col-span-2">
            <NSelect
              v-model:value="form.metric_ids"
              multiple
              filterable
              clearable
              tag
              :options="metricOptions"
              placeholder="選擇模板關聯的業務指標"
            />
          </NFormItem>
          <NFormItem label="主要指標">
            <NSelect
              v-model:value="form.plan_metric"
              filterable
              clearable
              :options="metricOptions"
              placeholder="用於排序與查詢"
            />
          </NFormItem>
          <NFormItem label="時間範圍">
            <NSelect v-model:value="form.plan_time_range" :options="timeRangeOptions" />
          </NFormItem>
          <NFormItem label="分析維度" class="col-span-2">
            <NSelect
              v-model:value="form.plan_dimensions"
              multiple
              filterable
              clearable
              :options="dimensionOptions"
              placeholder="例如商品、類別、月份"
            />
          </NFormItem>
          <NFormItem label="排序">
            <NSelect v-model:value="form.plan_sort_direction" :options="sortOptions" />
          </NFormItem>
          <NFormItem label="筆數限制">
            <NInputNumber v-model:value="form.plan_limit" :min="1" :max="1000" class="w-full" />
          </NFormItem>
          <NFormItem label="預設圖表">
            <NSelect v-model:value="form.chart_type" :options="chartTypeOptions" />
          </NFormItem>
          <NFormItem label="圖表 X 軸">
            <NSelect
              v-model:value="form.chart_x"
              filterable
              clearable
              :options="dimensionOptions"
              :disabled="form.chart_type === 'table'"
              placeholder="選擇維度"
            />
          </NFormItem>
          <NFormItem label="圖表 Y 軸">
            <NSelect
              v-model:value="form.chart_y"
              filterable
              clearable
              :options="metricOptions"
              :disabled="form.chart_type === 'table'"
              placeholder="選擇指標"
            />
          </NFormItem>
          <NFormItem label="公開給所有使用者">
            <NSwitch v-model:value="form.is_public" />
          </NFormItem>
        </div>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="modalOpen = false">取消</NButton>
          <NButton type="primary" :loading="saving" @click="saveTemplate">
            {{ modalMode === 'create' ? '建立' : '儲存' }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
