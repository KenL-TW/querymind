<script setup lang="ts">
import {
  NAlert, NButton, NCard, NDataTable, NForm, NFormItem, NInput, NModal, NPopconfirm,
  NSelect, NSpace, NSwitch, NTag, useMessage, type DataTableColumns,
} from 'naive-ui'
import { h, onMounted, reactive, ref } from 'vue'
import { useApi } from '../../composables/useApi'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ title: '管理 / 資料連線' })

interface AccessUser {
  id: number
  email: string
  role: string
  explicit: boolean
}

interface ConnectionAccess {
  roles: Record<string, number>
  users: AccessUser[]
  open_to_unrestricted_users: boolean
}

interface WorkspaceConnection {
  name: string
  masked_url: string
  environment: string
  description: string
  is_active: boolean
  source: 'config' | 'workspace' | string
  created_at?: string
  updated_at?: string
  dialect: string
  alive: boolean
  error?: string | null
  access: ConnectionAccess
  schema_state?: SchemaObservation
  readiness?: ConnectionReadiness
}

interface ConnectionReadiness {
  score: number
  level: 'ready' | 'needs_attention' | 'not_ready' | string
  checks: Array<{ id: string; label: string; status: 'pass' | 'warn' | 'fail' | string; detail: string }>
  dictionary_coverage?: { described_columns: number; total_columns: number; ratio: number }
  sensitive_columns?: Array<{ table: string; column: string; patterns: string[] }>
}

interface SchemaObservation {
  status: string
  conn_name?: string
  last_checked_at?: string | null
  last_changed_at?: string | null
  fingerprint?: string
  table_count?: number
  view_count?: number
  last_diff?: SchemaDiff
}

interface SchemaDiff {
  changed?: boolean
  tables_added?: string[]
  tables_removed?: string[]
  columns_added?: Record<string, string[]>
  columns_removed?: Record<string, string[]>
  columns_type_changed?: Record<string, Array<{ column: string; from: string; to: string }>>
  views_added?: string[]
  views_removed?: string[]
}

interface SchemaScan {
  conn_name: string
  table_count: number
  view_count: number
  tables: Array<{
    name: string
    column_count: number
    columns: Array<{ name: string; type: string }>
    foreign_key_count: number
  }>
  views: string[]
  observation?: SchemaObservation
}

const api = useApi()
const message = useMessage()

const loading = ref(false)
const loadError = ref('')
const connections = ref<WorkspaceConnection[]>([])

const showCreate = ref(false)
const createSaving = ref(false)
const createTesting = ref(false)
const createForm = reactive({
  name: '',
  url: '',
  environment: 'local',
  description: '',
  is_active: true,
})

const editTarget = ref<WorkspaceConnection | null>(null)
const editSaving = ref(false)
const editForm = reactive({
  url: '',
  environment: 'local',
  description: '',
  is_active: true,
})

const scanLoading = ref(false)
const scanResult = ref<SchemaScan | null>(null)
const environmentOptions = [
  { label: 'Local', value: 'local' },
  { label: 'Development', value: 'development' },
  { label: 'Staging', value: 'staging' },
  { label: 'Production', value: 'production' },
]

function errMsg(e: unknown, fallback: string) {
  return (e as { data?: { detail?: string }; message?: string })?.data?.detail
    ?? (e as { message?: string })?.message
    ?? fallback
}

async function load(refresh = false) {
  loading.value = true
  loadError.value = ''
  try {
    const qs = refresh ? '?refresh=true' : ''
    const res = await api.get<{ connections: WorkspaceConnection[] }>(`/v1/admin/connections${qs}`)
    connections.value = res.connections ?? []
  } catch (e: unknown) {
    const msg = errMsg(e, '載入資料連線失敗')
    loadError.value = msg
    message.error(msg)
  } finally {
    loading.value = false
  }
}

async function testCreateUrl() {
  if (!createForm.url) {
    message.warning('請先輸入 DB URL')
    return
  }
  createTesting.value = true
  try {
    const res = await api.post<{ alive: boolean; dialect: string; error?: string | null }>(
      '/v1/admin/connections/test',
      { name: createForm.name || 'test', url: createForm.url },
    )
    if (res.alive) message.success(`連線成功：${res.dialect || 'postgresql'}`)
    else message.error(res.error || '連線失敗')
  } catch (e: unknown) {
    message.error(errMsg(e, '連線測試失敗'))
  } finally {
    createTesting.value = false
  }
}

async function submitCreate() {
  createSaving.value = true
  try {
    await api.post('/v1/admin/connections', { ...createForm })
    Object.assign(createForm, { name: '', url: '', environment: 'local', description: '', is_active: true })
    showCreate.value = false
    message.success('已新增資料連線')
    await load(true)
  } catch (e: unknown) {
    message.error(errMsg(e, '新增失敗'))
  } finally {
    createSaving.value = false
  }
}

function openEdit(row: WorkspaceConnection) {
  editTarget.value = row
  Object.assign(editForm, {
    url: '',
    environment: row.environment || 'local',
    description: row.description || '',
    is_active: row.is_active,
  })
}

async function submitEdit() {
  if (!editTarget.value) return
  editSaving.value = true
  try {
    const payload: Record<string, unknown> = {
      environment: editForm.environment,
      description: editForm.description,
      is_active: editForm.is_active,
    }
    if (editForm.url.trim()) payload.url = editForm.url.trim()
    await api.put(`/v1/admin/connections/${encodeURIComponent(editTarget.value.name)}`, payload)
    message.success('已更新資料連線')
    editTarget.value = null
    await load(true)
  } catch (e: unknown) {
    message.error(errMsg(e, '更新失敗'))
  } finally {
    editSaving.value = false
  }
}

async function deleteConnection(row: WorkspaceConnection) {
  try {
    await api.del(`/v1/admin/connections/${encodeURIComponent(row.name)}`)
    message.success('已刪除資料連線')
    await load(true)
  } catch (e: unknown) {
    message.error(errMsg(e, '刪除失敗'))
  }
}

async function pingConnection(row: WorkspaceConnection) {
  try {
    const res = await api.post<{ alive: boolean; error?: string | null }>(
      `/v1/connections/${encodeURIComponent(row.name)}/ping`,
      {},
    )
    message[res.alive ? 'success' : 'error'](res.alive ? '連線正常' : (res.error || '連線失敗'))
    await load(false)
  } catch (e: unknown) {
    message.error(errMsg(e, '健康檢查失敗'))
  }
}

async function scanSchema(row: WorkspaceConnection) {
  scanLoading.value = true
  scanResult.value = null
  try {
    scanResult.value = await api.post<SchemaScan>(
      `/v1/admin/connections/${encodeURIComponent(row.name)}/scan-schema`,
      {},
    )
    await load(false)
  } catch (e: unknown) {
    message.error(errMsg(e, 'Schema 掃描失敗'))
  } finally {
    scanLoading.value = false
  }
}

function renderRoles(access: ConnectionAccess) {
  const entries = Object.entries(access?.roles ?? {})
  if (!entries.length) return h('span', { class: 'text-slate-400 text-xs' }, '尚未指派')
  return h(NSpace, { size: 4, wrap: true }, () =>
    entries.map(([role, count]) =>
      h(NTag, { size: 'small', bordered: false }, () => `${role}: ${count}`)))
}

function schemaStatusType(status?: string) {
  if (status === 'changed') return 'warning'
  if (['baseline', 'unchanged', 'stored', 'cached'].includes(status || '')) return 'success'
  if (status === 'error') return 'error'
  return 'default'
}

function readinessType(level?: string) {
  if (level === 'ready') return 'success'
  if (level === 'needs_attention') return 'warning'
  if (level === 'not_ready') return 'error'
  return 'default'
}

function readinessFailures(row: WorkspaceConnection) {
  return (row.readiness?.checks ?? []).filter((check) => check.status !== 'pass')
}

function diffSummary(diff?: SchemaDiff) {
  if (!diff || !diff.changed) return '沒有偵測到 schema 變更'
  const parts: string[] = []
  if (diff.tables_added?.length) parts.push(`新增 ${diff.tables_added.length} table`)
  if (diff.tables_removed?.length) parts.push(`移除 ${diff.tables_removed.length} table`)
  const addedCols = Object.values(diff.columns_added ?? {}).reduce((sum, cols) => sum + cols.length, 0)
  const removedCols = Object.values(diff.columns_removed ?? {}).reduce((sum, cols) => sum + cols.length, 0)
  const changedTypes = Object.values(diff.columns_type_changed ?? {}).reduce((sum, cols) => sum + cols.length, 0)
  if (addedCols) parts.push(`新增 ${addedCols} 欄位`)
  if (removedCols) parts.push(`移除 ${removedCols} 欄位`)
  if (changedTypes) parts.push(`${changedTypes} 欄位型別變更`)
  return parts.join('、') || 'schema fingerprint 已變更'
}

const columns: DataTableColumns<WorkspaceConnection> = [
  {
    title: '連線',
    key: 'name',
    width: 180,
    render: (row) => h('div', { class: 'space-y-1' }, [
      h('div', { class: 'font-medium' }, row.name),
      h(NSpace, { size: 4 }, () => [
        h(NTag, { size: 'small', bordered: false, type: row.source === 'config' ? 'info' : 'success' }, () =>
          row.source === 'config' ? '.env' : 'workspace'),
        h(NTag, { size: 'small', bordered: false }, () => row.environment || 'local'),
      ]),
    ]),
  },
  {
    title: '狀態',
    key: 'alive',
    width: 120,
    render: (row) => h(NTag, {
      size: 'small',
      bordered: false,
      type: row.alive ? 'success' : row.is_active ? 'error' : 'default',
    }, () => row.alive ? '正常' : row.is_active ? '異常' : '停用'),
  },
  {
    title: 'URL',
    key: 'masked_url',
    ellipsis: { tooltip: true },
    render: (row) => h('code', { class: 'text-xs' }, row.masked_url),
  },
  {
    title: '說明',
    key: 'description',
    ellipsis: { tooltip: true },
    render: (row) => row.description || h('span', { class: 'text-slate-400 text-xs' }, '-'),
  },
  {
    title: '角色可用性',
    key: 'access',
    render: (row) => renderRoles(row.access),
  },
  {
    title: 'Schema 狀態',
    key: 'schema_state',
    width: 180,
    render: (row) => h('div', { class: 'space-y-1' }, [
      h(NTag, {
        size: 'small',
        bordered: false,
        type: schemaStatusType(row.schema_state?.status),
      }, () => row.schema_state?.status || 'not_scanned'),
      h('div', { class: 'text-xs text-slate-500' }, row.schema_state?.last_checked_at
        ? `${row.schema_state.table_count ?? 0} tables · ${row.schema_state.view_count ?? 0} views`
        : '尚未掃描'),
    ]),
  },
  {
    title: 'PoC readiness',
    key: 'readiness',
    width: 220,
    render: (row) => h('div', { class: 'space-y-1' }, [
      h('div', { class: 'flex items-center gap-2' }, [
        h(NTag, {
          size: 'small',
          bordered: false,
          type: readinessType(row.readiness?.level),
        }, () => `${row.readiness?.score ?? 0}/100`),
        h('span', { class: 'text-xs text-slate-500' }, row.readiness?.level ?? 'unknown'),
      ]),
      h('div', { class: 'text-xs text-slate-500' }, () => {
        const cov = row.readiness?.dictionary_coverage
        return cov ? `dictionary ${Math.round((cov.ratio || 0) * 100)}%` : 'dictionary -'
      }),
      ...readinessFailures(row).slice(0, 2).map((check) =>
        h('div', { class: 'text-xs text-amber-600 truncate', title: check.detail }, `${check.label}: ${check.detail}`)),
    ]),
  },
  {
    title: '操作',
    key: 'actions',
    width: 260,
    render: (row) => h(NSpace, { size: 'small' }, () => [
      h(NButton, { size: 'tiny', onClick: () => pingConnection(row) }, () => 'Health'),
      h(NButton, { size: 'tiny', type: 'info', disabled: !row.is_active, onClick: () => scanSchema(row) }, () => 'Scan'),
      row.source === 'workspace'
        ? h(NButton, { size: 'tiny', onClick: () => openEdit(row) }, () => '編輯')
        : null,
      row.source === 'workspace'
        ? h(NPopconfirm, { onPositiveClick: () => deleteConnection(row) }, {
            trigger: () => h(NButton, { size: 'tiny', type: 'error' }, () => '刪除'),
            default: () => `確定刪除 ${row.name}？`,
          })
        : null,
    ]),
  },
]

onMounted(() => load())
</script>

<template>
  <div>
    <AdminTabs />

    <NAlert v-if="loadError" type="error" title="載入失敗" class="mb-3" closable>
      <div class="flex items-center justify-between gap-3">
        <div class="text-sm">{{ loadError }}</div>
        <NButton size="small" @click="load(true)">重試</NButton>
      </div>
    </NAlert>

    <NCard size="small">
      <template #header>
        <div class="flex items-center justify-between">
          <div>
            <div class="font-medium">Workspace / Data Connections</div>
            <div class="text-xs text-slate-500 mt-1">
              管理資料庫連線、連線測試、schema 掃描、權限綁定與環境切換。
            </div>
          </div>
          <NSpace>
            <NButton size="small" @click="load(true)">重新檢查</NButton>
            <NButton type="primary" size="small" @click="showCreate = true">新增 DB connection</NButton>
          </NSpace>
        </div>
      </template>

      <NDataTable
        :columns="columns"
        :data="connections"
        :loading="loading"
        :row-key="(row: WorkspaceConnection) => row.name"
        :bordered="false"
        size="small"
      />
    </NCard>

    <NModal v-model:show="showCreate" preset="card" title="新增 DB connection" style="width:640px">
      <NForm label-placement="left" label-width="110">
        <NFormItem label="連線名稱">
          <NInput v-model:value="createForm.name" placeholder="例如 analytics_prod" />
        </NFormItem>
        <NFormItem label="DB URL">
          <NInput
            v-model:value="createForm.url"
            type="password"
            show-password-on="click"
            placeholder="postgresql+psycopg2://user:password@host:5432/db"
          />
        </NFormItem>
        <NFormItem label="環境">
          <NSelect v-model:value="createForm.environment" :options="environmentOptions" />
        </NFormItem>
        <NFormItem label="說明">
          <NInput v-model:value="createForm.description" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" />
        </NFormItem>
        <NFormItem label="啟用">
          <NSwitch v-model:value="createForm.is_active" />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton :loading="createTesting" @click="testCreateUrl">測試連線</NButton>
          <NButton @click="showCreate = false">取消</NButton>
          <NButton type="primary" :loading="createSaving" @click="submitCreate">儲存</NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal :show="!!editTarget" preset="card" :title="`編輯 DB connection：${editTarget?.name ?? ''}`" style="width:640px"
            @update:show="(v: boolean) => v ? null : (editTarget = null)">
      <NForm v-if="editTarget" label-placement="left" label-width="110">
        <NFormItem label="來源">
          <NTag size="small" bordered>{{ editTarget.source }}</NTag>
        </NFormItem>
        <NFormItem label="目前 URL">
          <code class="text-xs break-all">{{ editTarget.masked_url }}</code>
        </NFormItem>
        <NFormItem label="更新 URL">
          <NInput
            v-model:value="editForm.url"
            type="password"
            show-password-on="click"
            placeholder="留空代表保留原 URL"
          />
        </NFormItem>
        <NFormItem label="環境">
          <NSelect v-model:value="editForm.environment" :options="environmentOptions" />
        </NFormItem>
        <NFormItem label="說明">
          <NInput v-model:value="editForm.description" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" />
        </NFormItem>
        <NFormItem label="啟用">
          <NSwitch v-model:value="editForm.is_active" />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="editTarget = null">取消</NButton>
          <NButton type="primary" :loading="editSaving" @click="submitEdit">儲存</NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal :show="!!scanResult || scanLoading" preset="card" title="Schema 掃描結果" style="width:760px"
            @update:show="(v: boolean) => v ? null : (scanResult = null)">
      <div v-if="scanLoading" class="text-sm text-slate-500 py-4">掃描中...</div>
      <div v-else-if="scanResult" class="space-y-3">
        <div class="flex gap-2 text-sm">
          <NTag bordered>connection: {{ scanResult.conn_name }}</NTag>
          <NTag bordered>tables: {{ scanResult.table_count }}</NTag>
          <NTag bordered>views: {{ scanResult.view_count }}</NTag>
          <NTag
            v-if="scanResult.observation"
            :type="schemaStatusType(scanResult.observation.status)"
            bordered
          >
            {{ scanResult.observation.status }}
          </NTag>
        </div>
        <div
          v-if="scanResult.observation"
          class="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
        >
          <div class="font-medium">Schema drift</div>
          <div class="text-xs text-slate-500 mt-1">{{ diffSummary(scanResult.observation.last_diff) }}</div>
          <div class="text-xs text-slate-400 mt-1">
            last checked: {{ scanResult.observation.last_checked_at || '-' }}
          </div>
        </div>
        <div class="max-h-96 overflow-auto border border-slate-200 rounded">
          <div
            v-for="table in scanResult.tables"
            :key="table.name"
            class="px-3 py-2 border-b border-slate-100"
          >
            <div class="flex items-center justify-between">
              <div class="font-medium text-sm">{{ table.name }}</div>
              <div class="text-xs text-slate-500">
                {{ table.column_count }} columns · {{ table.foreign_key_count }} FKs
              </div>
            </div>
            <div class="mt-1 flex flex-wrap gap-1">
              <NTag
                v-for="col in table.columns.slice(0, 12)"
                :key="`${table.name}.${col.name}`"
                size="tiny"
                bordered
              >
                {{ col.name }}: {{ col.type }}
              </NTag>
              <span v-if="table.columns.length > 12" class="text-xs text-slate-400">
                +{{ table.columns.length - 12 }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </NModal>
  </div>
</template>
