<script setup lang="ts">
import {
  NButton, NCard, NCollapseTransition, NDataTable, NEmpty, NGrid, NGridItem, NInput,
  NScrollbar, NSelect, NSpin, NTabPane, NTabs, NTag, useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRuntimeConfig } from 'nuxt/app'
import { useApi } from '../composables/useApi'
import { useAuthStore } from '../stores/auth'
import { useMarkdown } from '../composables/useMarkdown'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ title: 'Schema' })

interface Column {
  name: string
  type: string
  nullable: boolean
  default: string | null
  description?: string
}

interface ForeignKey {
  constrained_columns: string[]
  referred_table: string
  referred_columns: string[]
}

interface TableInfo {
  name: string
  description?: string
  row_count: number
  columns: Column[]
  ddl: string
  sample_rows: Record<string, unknown>[]
  foreign_keys?: ForeignKey[]
}

interface SchemaResp {
  conn_name: string
  tables: TableInfo[]
  views: string[]
  table_count: number
  view_count: number
}

const api = useApi()
const cfg = useRuntimeConfig()
const auth = useAuthStore()
const message = useMessage()
const md = useMarkdown()

const conns = ref<string[]>([])
const currentConn = ref<string>('default')
const schema = ref<SchemaResp | null>(null)
const loading = ref(false)
const search = ref('')
const selectedTable = ref<string | null>(null)

// ── AI Summary ─────────────────────────────────────────────────────────────
const summaryOpen = ref(true)
const summaryContent = ref('')
const summaryLoading = ref(false)
const summaryGenerated = ref(false)

// ── ER Diagram ─────────────────────────────────────────────────────────────
const erOpen = ref(false)
const erSvg = ref('')
const erLoading = ref(false)
const erGenerated = ref(false)
const erEl = ref<HTMLDivElement | null>(null)

const connOptions = computed(() => conns.value.map(c => ({ label: c, value: c })))

const filteredTables = computed(() => {
  const q = search.value.toLowerCase().trim()
  return (schema.value?.tables ?? []).filter(t => !q || t.name.toLowerCase().includes(q))
})

const selectedTableInfo = computed<TableInfo | null>(() =>
  schema.value?.tables.find(t => t.name === selectedTable.value) ?? null
)

const colDefs = computed<DataTableColumns<Column>>(() => [
  { title: '欄位名稱', key: 'name', minWidth: 140, ellipsis: { tooltip: true } },
  { title: '型別', key: 'type', minWidth: 120, ellipsis: { tooltip: true } },
  {
    title: '允許 NULL', key: 'nullable', width: 95,
    render: (row) => row.nullable ? '✓' : '✗',
  },
  {
    title: '預設值', key: 'default',
    render: (row) => row.default != null ? String(row.default) : '—',
  },
  {
    title: '說明', key: 'description', minWidth: 160, ellipsis: { tooltip: true },
    render: (row) => row.description || '—',
  },
])

async function loadConns() {
  try {
    const h = await api.get<{ connections: Array<{ name: string; alive: boolean }>; default: string | null }>('/v1/connections')
    conns.value = (h.connections ?? []).map((c) => c.name)
    if (!conns.value.includes(currentConn.value) && conns.value.length) {
      currentConn.value = h.default ?? conns.value[0]
    }
  } catch { /* swallow */ }
}

async function loadSchema() {
  if (!currentConn.value) return
  loading.value = true
  schema.value = null
  selectedTable.value = null
  summaryContent.value = ''
  summaryGenerated.value = false
  erSvg.value = ''
  erGenerated.value = false
  try {
    schema.value = await api.get<SchemaResp>(`/v1/schema/${encodeURIComponent(currentConn.value)}`)
    if (schema.value?.tables.length) selectedTable.value = schema.value.tables[0].name
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? 'Schema 載入失敗')
  } finally {
    loading.value = false
  }
}

// ── AI Summary streaming ────────────────────────────────────────────────────
async function generateSummary() {
  if (!currentConn.value || summaryLoading.value) return
  summaryContent.value = ''
  summaryLoading.value = true
  summaryGenerated.value = false
  summaryOpen.value = true

  const url = `${cfg.public.apiBase}/v1/schema/${encodeURIComponent(currentConn.value)}/ai-summary`
  const headers: Record<string, string> = { Accept: 'text/event-stream' }
  if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`

  try {
    const resp = await fetch(url, { method: 'GET', headers, credentials: 'include' })
    if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)

    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2)
        const line = raw.startsWith('data:') ? raw.slice(5).replace(/^\s+/, '') : raw
        try {
          const parsed = JSON.parse(line)
          if (parsed.token) summaryContent.value += parsed.token
          if (parsed.done) summaryGenerated.value = true
          if (parsed.error) throw new Error(parsed.error)
        } catch { /* ignore parse errors for non-data lines */ }
      }
    }
    summaryGenerated.value = true
  } catch (e: unknown) {
    message.error((e as Error)?.message ?? 'AI 摘要生成失敗')
  } finally {
    summaryLoading.value = false
  }
}

// ── ER Diagram (Mermaid) ────────────────────────────────────────────────────
function buildMermaidEr(tables: TableInfo[]): string {
  const lines: string[] = ['erDiagram']

  // Entity definitions
  for (const t of tables) {
    lines.push(`  ${t.name} {`)
    for (const col of t.columns) {
      const typePart = col.type.split('(')[0].toUpperCase().replace(/\s+/g, '_') || 'TEXT'
      lines.push(`    ${typePart} ${col.name}`)
    }
    lines.push('  }')
  }

  // Relationships from FK
  const seenRels = new Set<string>()
  for (const t of tables) {
    for (const fk of t.foreign_keys ?? []) {
      if (!fk.referred_table || !fk.constrained_columns.length) continue
      const key = `${t.name}__${fk.referred_table}`
      if (seenRels.has(key)) continue
      seenRels.add(key)
      lines.push(`  ${fk.referred_table} ||--o{ ${t.name} : "FK"`)
    }
  }

  return lines.join('\n')
}

async function generateEr() {
  if (!schema.value || erLoading.value) return
  erLoading.value = true
  erGenerated.value = false
  erOpen.value = true

  try {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      er: { diagramPadding: 20, layoutDirection: 'TB', minEntityWidth: 100, entityPadding: 15 },
    })

    const code = buildMermaidEr(schema.value.tables)
    const id = `er-${Date.now()}`
    const { svg } = await mermaid.render(id, code)
    erSvg.value = svg
    erGenerated.value = true
    await nextTick()
  } catch (e: unknown) {
    message.error('ER 圖生成失敗：' + ((e as Error)?.message ?? ''))
  } finally {
    erLoading.value = false
  }
}

watch(currentConn, loadSchema)

onMounted(async () => {
  await loadConns()
  await loadSchema()
})
</script>

<template>
  <div class="flex flex-col gap-3 h-[calc(100vh-5rem)] overflow-hidden">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 flex-wrap flex-shrink-0">
      <span class="text-sm font-semibold">連線</span>
      <NSelect
        v-model:value="currentConn"
        :options="connOptions"
        size="small"
        class="!w-44"
        :disabled="loading"
      />
      <NButton size="small" :loading="loading" @click="loadSchema">重新整理</NButton>
      <span v-if="schema" class="text-sm text-slate-400">
        {{ schema.table_count }} 資料表 · {{ schema.view_count }} 檢視
      </span>
      <div class="flex-1" />
      <NButton
        size="small"
        type="info"
        :loading="summaryLoading"
        :disabled="!schema || loading"
        @click="generateSummary"
      >
        ✨ AI 摘要
      </NButton>
      <NButton
        size="small"
        :loading="erLoading"
        :disabled="!schema || loading"
        @click="generateEr"
      >
        🗂 ER 圖
      </NButton>
    </div>

    <NSpin :show="loading" class="flex-1 min-h-0 flex flex-col">
      <NEmpty v-if="!loading && !schema" description="點擊「重新整理」載入 Schema" class="mt-20" />

      <template v-else-if="schema">
        <!-- AI Summary panel (collapsible) -->
        <div v-if="summaryContent || summaryLoading" class="flex-shrink-0 mb-2">
          <div
            class="flex items-center gap-2 px-3 py-2 bg-indigo-800 border border-indigo-700 rounded-t-lg cursor-pointer select-none"
            @click="summaryOpen = !summaryOpen"
          >
            <span class="inline-block transition-transform text-indigo-200" :class="summaryOpen ? 'rotate-90' : ''">▶</span>
            <span class="text-sm font-semibold text-white">✨ AI Schema 摘要</span>
            <NSpin v-if="summaryLoading" :size="14" class="ml-1" />
            <span v-else-if="summaryGenerated" class="ml-auto text-xs text-indigo-300">已完成</span>
          </div>
          <NCollapseTransition :show="summaryOpen">
            <NScrollbar style="max-height: 280px">
              <div class="px-4 py-3 bg-indigo-950 border border-t-0 border-indigo-700 rounded-b-lg qm-ai-summary-dark">
                <div
                  v-if="summaryContent"
                  class="markdown-body text-sm"
                  v-html="md.render(summaryContent)"
                />
                <div v-else class="text-indigo-300 text-sm italic">生成中…</div>
              </div>
            </NScrollbar>
          </NCollapseTransition>
        </div>

        <!-- ER Diagram panel (collapsible) -->
        <div v-if="erSvg || erLoading" class="flex-shrink-0 mb-2">
          <div
            class="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-t-lg cursor-pointer select-none"
            @click="erOpen = !erOpen"
          >
            <span class="inline-block transition-transform text-emerald-600" :class="erOpen ? 'rotate-90' : ''">▶</span>
            <span class="text-sm font-semibold text-emerald-700">🗂 ER 圖</span>
            <NSpin v-if="erLoading" :size="14" class="ml-1" />
            <span v-else-if="erGenerated" class="ml-auto text-xs text-emerald-400">
              {{ schema.table_count }} 個資料表
            </span>
          </div>
          <NCollapseTransition :show="erOpen">
            <div class="bg-white border border-t-0 border-emerald-200 rounded-b-lg overflow-auto" style="max-height: 500px">
              <div v-if="erLoading" class="flex items-center justify-center py-12 text-slate-400 text-sm">
                生成 ER 圖中…
              </div>
              <div
                v-else-if="erSvg"
                ref="erEl"
                class="p-4 flex justify-center"
                v-html="erSvg"
              />
            </div>
          </NCollapseTransition>
        </div>

        <!-- Main table explorer -->
        <NGrid :cols="4" :x-gap="16" class="flex-1 min-h-0" style="overflow:hidden">
          <!-- Table list -->
          <NGridItem :span="1" style="display:flex;flex-direction:column;min-height:0;overflow:hidden">
            <NCard
              size="small"
              style="height:100%;display:flex;flex-direction:column;overflow:hidden"
              content-style="flex:1;overflow:hidden;display:flex;flex-direction:column;gap:8px;padding:10px;min-height:0"
            >
              <div class="flex items-center justify-between flex-shrink-0">
                <span class="text-sm font-semibold">資料表</span>
                <NTag size="tiny">{{ filteredTables.length }}</NTag>
              </div>
              <NInput v-model:value="search" placeholder="搜尋…" size="small" clearable class="flex-shrink-0" />
              <NScrollbar style="flex:1;min-height:0">
                <div
                  v-for="t in filteredTables"
                  :key="t.name"
                  :class="[
                    'px-3 py-2 rounded cursor-pointer text-sm transition-colors select-none',
                    selectedTable === t.name ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-slate-50',
                  ]"
                  @click="selectedTable = t.name"
                >
                  <div class="truncate">{{ t.name }}</div>
                  <div class="text-xs text-slate-400 mt-0.5">
                    {{ t.columns.length }} 欄
                    <span v-if="t.row_count >= 0" class="ml-1">· {{ t.row_count.toLocaleString() }} 列</span>
                  </div>
                </div>
              </NScrollbar>
            </NCard>
          </NGridItem>

          <!-- Table detail -->
          <NGridItem :span="3" style="min-height:0;overflow:hidden">
            <NCard size="small" style="height:100%;overflow:hidden">
              <NEmpty v-if="!selectedTableInfo" description="← 請從左側選取一張資料表" class="mt-16" />
              <template v-else>
                <div class="flex items-center gap-2 mb-3">
                  <code class="font-semibold text-base text-slate-800">{{ selectedTableInfo.name }}</code>
                  <NTag size="small">{{ selectedTableInfo.columns.length }} 欄</NTag>
                  <NTag v-if="selectedTableInfo.row_count >= 0" size="small" type="success">
                    {{ selectedTableInfo.row_count.toLocaleString() }} 列
                  </NTag>
                  <NTag
                    v-if="selectedTableInfo.foreign_keys && selectedTableInfo.foreign_keys.length"
                    size="small" type="info"
                  >
                    {{ selectedTableInfo.foreign_keys.length }} FK
                  </NTag>
                </div>
                <div v-if="selectedTableInfo.description" class="text-sm text-slate-500 mb-3 italic">
                  {{ selectedTableInfo.description }}
                </div>

                <NTabs type="line" size="small">
                  <NTabPane name="columns" tab="欄位定義">
                    <NDataTable
                      :columns="colDefs"
                      :data="selectedTableInfo.columns"
                      size="small"
                      :bordered="false"
                      striped
                      :max-height="340"
                      class="mt-2"
                    />
                    <!-- FK section -->
                    <div
                      v-if="selectedTableInfo.foreign_keys && selectedTableInfo.foreign_keys.length"
                      class="mt-3 pt-3 border-t border-slate-100"
                    >
                      <div class="text-xs font-semibold text-slate-500 mb-2">外鍵關聯</div>
                      <div
                        v-for="(fk, fi) in selectedTableInfo.foreign_keys"
                        :key="fi"
                        class="text-xs text-slate-600 flex items-center gap-1 mb-1"
                      >
                        <code class="bg-slate-100 px-1 rounded">{{ fk.constrained_columns.join(', ') }}</code>
                        <span class="text-slate-400">→</span>
                        <code class="bg-blue-50 text-blue-700 px-1 rounded">{{ fk.referred_table }}.{{ fk.referred_columns.join(', ') }}</code>
                      </div>
                    </div>
                  </NTabPane>

                  <NTabPane name="ddl" tab="DDL">
                    <NScrollbar style="max-height:380px" class="mt-2">
                      <pre
                        v-if="selectedTableInfo.ddl"
                        class="text-xs font-mono bg-slate-50 p-3 rounded text-slate-700 whitespace-pre-wrap"
                      >{{ selectedTableInfo.ddl }}</pre>
                      <div v-else class="text-slate-400 text-sm py-4">無 DDL 資訊</div>
                    </NScrollbar>
                  </NTabPane>

                  <NTabPane name="sample" tab="範例資料 (3 列)">
                    <div v-if="selectedTableInfo.sample_rows.length" class="overflow-x-auto mt-2">
                      <table class="text-xs w-full border-collapse">
                        <thead>
                          <tr class="border-b border-slate-200">
                            <th
                              v-for="col in selectedTableInfo.columns"
                              :key="col.name"
                              class="px-2 py-1.5 text-left font-semibold text-slate-600 whitespace-nowrap bg-slate-50"
                            >{{ col.name }}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="(row, ri) in selectedTableInfo.sample_rows"
                            :key="ri"
                            class="border-b border-slate-100 hover:bg-slate-50"
                          >
                            <td
                              v-for="col in selectedTableInfo.columns"
                              :key="col.name"
                              class="px-2 py-1.5 text-slate-600 max-w-[180px] truncate"
                            >{{ row[col.name] ?? '' }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <NEmpty v-else description="無範例資料" class="mt-8" />
                  </NTabPane>
                </NTabs>
              </template>
            </NCard>
          </NGridItem>
        </NGrid>
      </template>
    </NSpin>
  </div>
</template>

<style scoped>
.qm-ai-summary-dark :deep(*) {
  color: white !important;
}
.qm-ai-summary-dark :deep(code) {
  color: #6ee7b7 !important;
  background-color: rgba(255, 255, 255, 0.08) !important;
}
.qm-ai-summary-dark :deep(pre) {
  background-color: rgba(0, 0, 0, 0.35) !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
}
.qm-ai-summary-dark :deep(a) {
  color: #a5b4fc !important;
}
.qm-ai-summary-dark :deep(table th),
.qm-ai-summary-dark :deep(table td) {
  border-color: rgba(255, 255, 255, 0.15) !important;
}
.qm-ai-summary-dark :deep(hr),
.qm-ai-summary-dark :deep(blockquote) {
  border-color: rgba(255, 255, 255, 0.2) !important;
}
</style>
