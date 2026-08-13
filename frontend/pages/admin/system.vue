<script setup lang="ts">
import {
  NAlert, NButton, NCard, NCheckbox, NDataTable, NForm, NFormItem, NInputNumber, NModal,
  NSpace, NTag, useMessage, type DataTableColumns,
} from 'naive-ui'
import { h, onMounted, reactive, ref } from 'vue'
import { useApi } from '../../composables/useApi'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ title: '管理 / 系統' })

interface SysInfo {
  version: string
  environment: string
  auth_enabled: boolean
  rbac_enabled: boolean
  first_run_pending: boolean
}

interface Role {
  name: string
  description: string
  allowed_sql_verbs: string[]
  max_rows_per_query: number
  can_export: boolean
  can_schedule: boolean
  can_etl: boolean
  can_manage_users: boolean
  can_modify_schema: boolean
}

const ALL_SQL_VERBS = ['SELECT', 'WITH', 'EXPLAIN', 'SHOW', 'DESCRIBE', 'DESC', 'PRAGMA',
  'INSERT', 'UPDATE', 'MERGE', 'REPLACE', 'DELETE', 'CREATE', 'ALTER']

const api = useApi()
const message = useMessage()
const sys = ref<SysInfo | null>(null)
const roles = ref<Role[]>([])
const loading = ref(false)
const loadError = ref('')

// Role edit modal
const showEditRole = ref(false)
const editingRole = ref('')
const editSaving = ref(false)
const editForm = reactive({
  max_rows_per_query: 10000,
  can_export: false,
  can_schedule: false,
  can_etl: false,
  can_manage_users: false,
  can_modify_schema: false,
  allowed_sql_verbs: [] as string[],
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [s, r] = await Promise.all([
      api.get<SysInfo>('/v1/admin/system-info'),
      api.get<Role[]>('/v1/admin/roles'),
    ])
    sys.value = s
    roles.value = r
  } catch (e: unknown) {
    const msg = (e as { data?: { detail?: string }; message?: string })?.data?.detail
      ?? (e as { message?: string })?.message ?? '載入失敗'
    loadError.value = msg
    message.error(msg)
  } finally { loading.value = false }
}

function openEditRole(r: Role) {
  editingRole.value = r.name
  Object.assign(editForm, {
    max_rows_per_query: r.max_rows_per_query,
    can_export: r.can_export,
    can_schedule: r.can_schedule,
    can_etl: r.can_etl,
    can_manage_users: r.can_manage_users,
    can_modify_schema: r.can_modify_schema,
    allowed_sql_verbs: [...r.allowed_sql_verbs],
  })
  showEditRole.value = true
}

async function saveEditRole() {
  editSaving.value = true
  try {
    const updated = await api.put<Role>(`/v1/admin/roles/${encodeURIComponent(editingRole.value)}`, {
      max_rows_per_query: editForm.max_rows_per_query,
      can_export: editForm.can_export,
      can_schedule: editForm.can_schedule,
      can_etl: editForm.can_etl,
      can_manage_users: editForm.can_manage_users,
      can_modify_schema: editForm.can_modify_schema,
      allowed_sql_verbs: editForm.allowed_sql_verbs,
    })
    const idx = roles.value.findIndex((r) => r.name === editingRole.value)
    if (idx >= 0) roles.value[idx] = updated
    showEditRole.value = false
    message.success(`角色「${editingRole.value}」已更新`)
  } catch (e: unknown) {
    message.error((e as { data?: { detail?: string }; message?: string })?.data?.detail
      ?? (e as { message?: string })?.message ?? '儲存失敗')
  } finally {
    editSaving.value = false
  }
}

function toggleVerb(verb: string) {
  const idx = editForm.allowed_sql_verbs.indexOf(verb)
  if (idx >= 0) editForm.allowed_sql_verbs.splice(idx, 1)
  else editForm.allowed_sql_verbs.push(verb)
}

const cols: DataTableColumns<Role> = [
  { title: '角色', key: 'name', width: 110,
    render: (r) => h(NTag, { bordered: false, type: r.name === 'owner' ? 'error' : 'info' }, () => r.name) },
  { title: '說明', key: 'description' },
  { title: '最大列數', key: 'max_rows_per_query', width: 110 },
  {
    title: 'SQL', key: 'allowed_sql_verbs',
    render: (r) => r.allowed_sql_verbs.map((v) =>
      h(NTag, { size: 'small', bordered: false, style: 'margin-right:4px' }, () => v)),
  },
  {
    title: '權限', key: '_caps',
    render: (r) => [
      r.can_export       && h(NTag, { size: 'small', type: 'success', bordered: false, style: 'margin-right:4px' }, () => '匯出'),
      r.can_schedule     && h(NTag, { size: 'small', type: 'success', bordered: false, style: 'margin-right:4px' }, () => '排程'),
      r.can_etl          && h(NTag, { size: 'small', type: 'success', bordered: false, style: 'margin-right:4px' }, () => 'ETL'),
      r.can_manage_users && h(NTag, { size: 'small', type: 'warning', bordered: false, style: 'margin-right:4px' }, () => '管理人員'),
      r.can_modify_schema && h(NTag, { size: 'small', type: 'error', bordered: false, style: 'margin-right:4px' }, () => 'DDL'),
    ].filter(Boolean),
  },
  {
    title: '操作', key: '_actions', width: 80,
    render: (r) => h(NButton, { size: 'tiny', onClick: () => openEditRole(r) }, () => '編輯'),
  },
]

onMounted(load)
</script>

<template>
  <div>
    <AdminTabs />

    <NAlert v-if="loadError" type="error" :title="'載入失敗'" class="mb-3" closable>
      <div class="flex items-center justify-between gap-3">
        <div class="text-sm">{{ loadError }}</div>
        <NButton size="small" @click="load">重試</NButton>
      </div>
    </NAlert>

    <NCard title="系統" size="small" class="mb-3">
      <div v-if="sys" class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div class="text-slate-500">版本</div><div>{{ sys.version }}</div>
        <div class="text-slate-500">環境</div><div><NTag size="small" bordered :type="sys.environment === 'production' ? 'error' : 'default'">{{ sys.environment }}</NTag></div>
        <div class="text-slate-500">認證</div><div><NTag size="small" :type="sys.auth_enabled ? 'success' : 'warning'" bordered>{{ sys.auth_enabled ? '啟用' : '關閉' }}</NTag></div>
        <div class="text-slate-500">RBAC</div><div><NTag size="small" :type="sys.rbac_enabled ? 'success' : 'warning'" bordered>{{ sys.rbac_enabled ? '啟用' : '關閉' }}</NTag></div>
        <div class="text-slate-500">First-run 未完成</div><div>{{ sys.first_run_pending ? '是' : '否' }}</div>
      </div>
      <div v-else-if="loading" class="text-slate-400 text-sm py-3">載入中…</div>
      <div v-else class="text-slate-400 text-sm py-3">無資料（可能為權限不足或後端未啓動）</div>
    </NCard>

    <NCard title="角色設定" size="small">
      <NDataTable :columns="cols" :data="roles" :loading="loading" :row-key="(r: Role) => r.name" :bordered="false" size="small" />
    </NCard>

    <!-- Role edit modal -->
    <NModal v-model:show="showEditRole" preset="card" :title="`編輯角色：${editingRole}`" style="width:560px">
      <NForm label-placement="left" label-width="120">
        <NFormItem label="最大列數">
          <NInputNumber v-model:value="editForm.max_rows_per_query" :min="1" :max="10000000" />
        </NFormItem>
        <NFormItem label="SQL 動詞">
          <div class="flex flex-wrap gap-2">
            <NCheckbox
              v-for="v in ALL_SQL_VERBS"
              :key="v"
              :checked="editForm.allowed_sql_verbs.includes(v)"
              @update:checked="toggleVerb(v)"
            >{{ v }}</NCheckbox>
          </div>
        </NFormItem>
        <NFormItem label="功能權限">
          <div class="flex flex-col gap-1">
            <NCheckbox v-model:checked="editForm.can_export">允許匯出（CSV / Excel）</NCheckbox>
            <NCheckbox v-model:checked="editForm.can_schedule">允許排程</NCheckbox>
            <NCheckbox v-model:checked="editForm.can_etl">允許 ETL</NCheckbox>
            <NCheckbox v-model:checked="editForm.can_modify_schema">允許修改 Schema（DDL）</NCheckbox>
            <NCheckbox
              v-model:checked="editForm.can_manage_users"
              :disabled="editingRole === 'owner'"
            >允許管理使用者（owner 必須保留）</NCheckbox>
          </div>
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="showEditRole = false">取消</NButton>
          <NButton type="primary" :loading="editSaving" @click="saveEditRole">儲存</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
