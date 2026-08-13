<script setup lang="ts">
import {
  NButton, NDataTable, NEmpty, NIcon, NInput, NScrollbar, NSelect,
  NSpin, NTag, NTooltip, useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { computed, h, onMounted, ref, watch } from 'vue'
import { useApi } from '../composables/useApi'
import { useAuthStore } from '../stores/auth'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ title: '資料字典' })

// ── Types ────────────────────────────────────────────────────────────────────

interface DictColumn {
  name: string
  type: string
  nullable: boolean
  description: string
}

interface DictTable {
  name: string
  description: string
  category: string
  columns: DictColumn[]
}

interface DictResp {
  conn_name: string
  tables: DictTable[]
  table_count: number
  can_edit: boolean
}

// ── State ────────────────────────────────────────────────────────────────────

const api = useApi()
const auth = useAuthStore()
const message = useMessage()

const conns = ref<string[]>([])
const currentConn = ref('default')
const dictData = ref<DictResp | null>(null)
const loading = ref(false)
const saving = ref(false)

const search = ref('')
const selectedTable = ref<string | null>(null)
const editMode = ref(false)

// Editable drafts (copy of current table/column descriptions)
const draftDesc = ref<Record<string, { description: string; category: string; columns: Record<string, string> }>>({})

// ── Computed ─────────────────────────────────────────────────────────────────

const connOptions = computed(() => conns.value.map(c => ({ label: c, value: c })))

const filteredTables = computed(() => {
  const q = search.value.toLowerCase().trim()
  return (dictData.value?.tables ?? []).filter(t =>
    !q ||
    t.name.toLowerCase().includes(q) ||
    t.description.toLowerCase().includes(q) ||
    t.category.toLowerCase().includes(q),
  )
})

const selectedTableInfo = computed<DictTable | null>(() =>
  dictData.value?.tables.find(t => t.name === selectedTable.value) ?? null,
)

const selectedDraft = computed(() => {
  if (!selectedTable.value) return null
  return draftDesc.value[selectedTable.value] ?? null
})

const canEdit = computed(() => dictData.value?.can_edit ?? false)

const colDefs = computed<DataTableColumns<DictColumn>>(() => {
  const base: DataTableColumns<DictColumn> = [
    {
      title: '欄位名稱',
      key: 'name',
      width: 160,
      ellipsis: { tooltip: true },
      render: row => h('span', { class: 'font-mono text-xs text-indigo-700' }, row.name),
    },
    {
      title: '型別',
      key: 'type',
      width: 130,
      ellipsis: { tooltip: true },
      render: row => row.type
        ? h('span', { class: 'font-mono text-xs text-slate-500' }, row.type)
        : h('span', { class: 'text-slate-300' }, '—'),
    },
    {
      title: 'NULL',
      key: 'nullable',
      width: 65,
      align: 'center',
      render: row => h('span', { class: row.nullable ? 'text-slate-400' : 'text-red-500 font-semibold' }, row.nullable ? '✓' : '✗'),
    },
  ]

  if (editMode.value) {
    base.push({
      title: '說明（可編輯）',
      key: 'description',
      minWidth: 200,
      render: row => {
        const tName = selectedTable.value!
        const draft = draftDesc.value[tName]
        if (!draft) return h('span', '—')
        return h(NInput, {
          size: 'small',
          value: draft.columns[row.name] ?? '',
          placeholder: '輸入欄位說明…',
          onUpdateValue: (v: string) => { draft.columns[row.name] = v },
        })
      },
    })
  } else {
    base.push({
      title: '說明',
      key: 'description',
      minWidth: 200,
      ellipsis: { tooltip: true },
      render: row => {
        const tName = selectedTable.value!
        const stored = draftDesc.value[tName]?.columns[row.name] ?? row.description
        return stored
          ? h('span', { class: 'text-slate-700 text-sm' }, stored)
          : h('span', { class: 'text-slate-300' }, '—')
      },
    })
  }

  return base
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function initDrafts(tables: DictTable[]) {
  const d: typeof draftDesc.value = {}
  for (const t of tables) {
    d[t.name] = {
      description: t.description,
      category: t.category,
      columns: Object.fromEntries(t.columns.map(c => [c.name, c.description])),
    }
  }
  draftDesc.value = d
}

async function loadConns() {
  try {
    const h = await api.get<{ connections: Array<{ name: string }>; default: string | null }>('/v1/connections')
    conns.value = (h.connections ?? []).map(c => c.name)
    if (!conns.value.includes(currentConn.value) && conns.value.length) {
      currentConn.value = h.default ?? conns.value[0]
    }
  } catch { /* swallow */ }
}

async function loadDict() {
  loading.value = true
  editMode.value = false
  try {
    const res = await api.get<DictResp>(`/v1/dictionary/${currentConn.value}`)
    dictData.value = res
    initDrafts(res.tables)
    if (res.tables.length && !selectedTable.value) {
      selectedTable.value = res.tables[0].name
    }
  } catch (e: any) {
    message.error(e?.message ?? '載入失敗')
  } finally {
    loading.value = false
  }
}

async function saveDict() {
  saving.value = true
  try {
    const tables: Record<string, { description: string; category: string; columns: Record<string, string> }> = {}
    for (const [tname, draft] of Object.entries(draftDesc.value)) {
      tables[tname] = draft
    }
    await api.put(`/v1/dictionary/${currentConn.value}`, { tables })
    // Refresh live descriptions from server
    const res = await api.get<DictResp>(`/v1/dictionary/${currentConn.value}`)
    dictData.value = res
    initDrafts(res.tables)
    editMode.value = false
    message.success('資料字典已儲存')
  } catch (e: any) {
    message.error(e?.message ?? '儲存失敗')
  } finally {
    saving.value = false
  }
}

function cancelEdit() {
  if (dictData.value) initDrafts(dictData.value.tables)
  editMode.value = false
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  await loadConns()
  await loadDict()
})

watch(currentConn, loadDict)
</script>

<template>
  <div class="flex h-full flex-col gap-4 p-4">
    <!-- Header -->
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-xl font-semibold text-slate-800">資料字典</h1>

      <NSelect
        v-model:value="currentConn"
        :options="connOptions"
        size="small"
        class="w-36"
        :disabled="loading"
      />

      <NInput
        v-model:value="search"
        placeholder="搜尋資料表…"
        clearable
        size="small"
        class="w-56"
      />

      <div class="ml-auto flex items-center gap-2">
        <template v-if="canEdit && !editMode">
          <NButton size="small" type="primary" ghost @click="editMode = true">
            ✏️ 編輯說明
          </NButton>
        </template>
        <template v-if="editMode">
          <NButton size="small" @click="cancelEdit" :disabled="saving">取消</NButton>
          <NButton size="small" type="primary" :loading="saving" @click="saveDict">
            💾 儲存
          </NButton>
        </template>
      </div>
    </div>

    <NSpin :show="loading">
      <div v-if="!loading && dictData" class="flex gap-4" style="height: calc(100vh - 160px)">
        <!-- Left: Table list -->
        <div class="w-56 shrink-0 rounded-lg border border-slate-200 bg-white">
          <NScrollbar style="max-height: 100%">
            <div
              v-for="t in filteredTables"
              :key="t.name"
              class="cursor-pointer border-b border-slate-100 px-3 py-2.5 transition-colors last:border-0 hover:bg-slate-50"
              :class="{ 'bg-indigo-50 border-l-2 border-l-indigo-500': selectedTable === t.name }"
              @click="selectedTable = t.name"
            >
              <div class="flex items-center gap-1.5">
                <span class="truncate font-mono text-xs font-medium text-slate-700">{{ t.name }}</span>
              </div>
              <div v-if="t.category" class="mt-0.5">
                <NTag size="tiny" :bordered="false" type="info">{{ t.category }}</NTag>
              </div>
              <p v-if="draftDesc[t.name]?.description" class="mt-0.5 truncate text-xs text-slate-400">
                {{ draftDesc[t.name].description }}
              </p>
            </div>

            <div v-if="filteredTables.length === 0" class="p-4 text-center text-sm text-slate-400">
              無符合的資料表
            </div>
          </NScrollbar>
        </div>

        <!-- Right: Table detail -->
        <div class="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white p-4">
          <template v-if="selectedTableInfo && selectedDraft">
            <div class="mb-4 flex flex-wrap items-start gap-3">
              <div class="min-w-0 flex-1">
                <h2 class="font-mono text-base font-semibold text-slate-800">
                  {{ selectedTableInfo.name }}
                </h2>

                <!-- Category -->
                <div class="mt-2 flex items-center gap-2">
                  <span class="text-xs text-slate-500 w-12 shrink-0">分類</span>
                  <template v-if="editMode">
                    <NInput
                      v-model:value="selectedDraft.category"
                      size="small"
                      placeholder="例：組織、商品、財務…"
                      class="max-w-xs"
                    />
                  </template>
                  <template v-else>
                    <NTag v-if="selectedDraft.category" size="small" :bordered="false" type="info">
                      {{ selectedDraft.category }}
                    </NTag>
                    <span v-else class="text-xs text-slate-300">—</span>
                  </template>
                </div>

                <!-- Table description -->
                <div class="mt-2 flex items-start gap-2">
                  <span class="mt-0.5 text-xs text-slate-500 w-12 shrink-0">說明</span>
                  <template v-if="editMode">
                    <NInput
                      v-model:value="selectedDraft.description"
                      type="textarea"
                      :autosize="{ minRows: 1, maxRows: 3 }"
                      size="small"
                      placeholder="描述這張資料表的業務用途…"
                      class="max-w-lg"
                    />
                  </template>
                  <template v-else>
                    <p v-if="selectedDraft.description" class="text-sm text-slate-700">
                      {{ selectedDraft.description }}
                    </p>
                    <span v-else class="text-xs text-slate-300">— 尚無說明</span>
                  </template>
                </div>
              </div>

              <NTag :bordered="false" size="small" type="default">
                {{ selectedTableInfo.columns.length }} 欄
              </NTag>
            </div>

            <!-- Column table -->
            <NDataTable
              :columns="colDefs"
              :data="selectedTableInfo.columns"
              :pagination="false"
              size="small"
              striped
              :scroll-x="600"
              style="height: calc(100% - 130px)"
              flex-height
            />
          </template>

          <NEmpty v-else description="請從左側選取一張資料表" class="mt-16" />
        </div>
      </div>

      <NEmpty v-if="!loading && !dictData" description="無資料" class="mt-16" />
    </NSpin>
  </div>
</template>
