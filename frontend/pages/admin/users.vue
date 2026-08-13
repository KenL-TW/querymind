<script setup lang="ts">
import {
  NButton, NCard, NDataTable, NDrawer, NDrawerContent, NForm, NFormItem,
  NInput, NModal, NPopconfirm, NSelect, NSpace, NSwitch, NTag, useDialog, useMessage,
  type DataTableColumns,
} from 'naive-ui'
import { computed, h, onMounted, reactive, ref } from 'vue'
import { useApi } from '../../composables/useApi'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ title: '管理 / 使用者' })

interface User {
  id: number
  email: string
  display_name: string
  role: string
  is_active: boolean
  allowed_conns: string[]
  created_at?: string
}

interface ApiKey {
  id: number
  label: string
  prefix: string
  created_at?: string
  revoked_at?: string | null
  last_used_at?: string | null
}

interface Role {
  name: string
  description: string
}

interface ConnInfo { name: string; alive?: boolean }

const api = useApi()
const message = useMessage()
const dialog = useDialog()

const users = ref<User[]>([])
const roles = ref<Role[]>([])
const conns = ref<ConnInfo[]>([])
const loading = ref(false)

const showCreate = ref(false)
const createForm = reactive({
  email: '', role: 'viewer', display_name: '', allowed_conns: [] as string[],
  initial_password: '',
})
const inviteToken = ref('')
const inviteExpiresAt = ref('')
const showInviteDialog = ref(false)

const editTarget = ref<User | null>(null)
const editForm = reactive({ role: 'viewer', display_name: '', allowed_conns: [] as string[], is_active: true })

const keysDrawer = ref(false)
const keysUser = ref<User | null>(null)
const keys = ref<ApiKey[]>([])
const newKeyLabel = ref('')
const lastRawKey = ref('')

const roleOptions = computed(() => roles.value.map((r) => ({ label: r.name, value: r.name })))
const connOptions = computed(() => conns.value.map((c) => ({
  label: c.alive === false ? `${c.name}（異常）` : c.name,
  value: c.name,
})))

async function load() {
  loading.value = true
  try {
    const [u, r, c] = await Promise.all([
      api.get<User[]>('/v1/admin/users'),
      api.get<Role[]>('/v1/admin/roles'),
      api.get<{ connections: ConnInfo[] }>('/v1/connections'),
    ])
    users.value = u
    roles.value = r
    conns.value = c.connections ?? []
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '載入失敗')
  } finally {
    loading.value = false
  }
}

async function submitCreate() {
  try {
    const result = await api.post<{ invite_token?: string; invite_expires_at?: string }>('/v1/admin/users', {
      email: createForm.email,
      role: createForm.role,
      display_name: createForm.display_name,
      allowed_conns: createForm.allowed_conns,
      initial_password: createForm.initial_password || null,
    })
    showCreate.value = false
    Object.assign(createForm, { email: '', role: 'viewer', display_name: '', allowed_conns: [], initial_password: '' })
    await load()
    if (result?.invite_token) {
      inviteToken.value = result.invite_token
      inviteExpiresAt.value = result.invite_expires_at ?? ''
      showInviteDialog.value = true
    } else {
      message.success('已建立使用者（初始密碼已設定）')
    }
  } catch (e: unknown) {
    message.error((e as { data?: { detail?: string }; message?: string })?.data?.detail
      ?? (e as { message?: string })?.message ?? '建立失敗')
  }
}

function openEdit(u: User) {
  editTarget.value = u
  Object.assign(editForm, {
    role: u.role, display_name: u.display_name,
    allowed_conns: [...(u.allowed_conns ?? [])], is_active: u.is_active,
  })
}

async function submitEdit() {
  if (!editTarget.value) return
  try {
    await api.request(`/v1/admin/users/${editTarget.value.id}`, { method: 'PATCH', body: { ...editForm } })
    message.success('已更新')
    editTarget.value = null
    await load()
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '更新失敗')
  }
}

function confirmDelete(u: User) {
  dialog.warning({
    title: '刪除使用者',
    content: `確定要刪除 ${u.email}？此動作不可逆。`,
    positiveText: '刪除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.del(`/v1/admin/users/${u.id}`)
        message.success('已刪除')
        await load()
      } catch (e: unknown) {
        message.error((e as { message?: string })?.message ?? '刪除失敗')
      }
    },
  })
}

async function openKeys(u: User) {
  keysUser.value = u
  keysDrawer.value = true
  lastRawKey.value = ''
  try {
    keys.value = await api.get<ApiKey[]>(`/v1/admin/users/${u.id}/keys`)
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '載入金鑰失敗')
  }
}

async function issueKey() {
  if (!keysUser.value) return
  try {
    const r = await api.post<{ api_key: string; key: ApiKey; warning: string }>(
      `/v1/admin/users/${keysUser.value.id}/keys`,
      { label: newKeyLabel.value },
    )
    lastRawKey.value = r.api_key
    newKeyLabel.value = ''
    keys.value = await api.get<ApiKey[]>(`/v1/admin/users/${keysUser.value.id}/keys`)
    message.success('已產生金鑰，請立即複製')
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '產生失敗')
  }
}

async function revokeKey(k: ApiKey) {
  try {
    await api.del(`/v1/admin/keys/${k.id}`)
    message.success('已撤銷')
    if (keysUser.value) keys.value = await api.get<ApiKey[]>(`/v1/admin/users/${keysUser.value.id}/keys`)
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '撤銷失敗')
  }
}

async function copyKey() {
  if (!lastRawKey.value) return
  try {
    await navigator.clipboard.writeText(lastRawKey.value)
    message.success('已複製')
  } catch { message.warning('複製失敗，請手動選取') }
}

async function copyInviteToken() {
  if (!inviteToken.value) return
  try {
    await navigator.clipboard.writeText(inviteToken.value)
    message.success('已複製邀請 Token')
  } catch { message.warning('複製失敗，請手動選取') }
}

const columns: DataTableColumns<User> = [
  { title: 'ID', key: 'id', width: 60 },
  { title: 'Email', key: 'email' },
  { title: '名稱', key: 'display_name' },
  {
    title: '角色', key: 'role', width: 100,
    render: (r) => h(NTag, { type: r.role === 'owner' ? 'error' : 'info', size: 'small', bordered: false }, () => r.role),
  },
  {
    title: '狀態', key: 'is_active', width: 80,
    render: (r) => h(NTag, { type: r.is_active ? 'success' : 'default', size: 'small', bordered: false },
      () => r.is_active ? '啟用' : '停用'),
  },
  {
    title: '可用連線', key: 'allowed_conns',
    render: (r) => (r.allowed_conns?.length
      ? r.allowed_conns.map((c) => h(NTag, { size: 'small', bordered: false, style: 'margin-right:4px' }, () => c))
      : h('span', { class: 'text-slate-400 text-xs' }, '*')),
  },
  {
    title: '操作', key: 'actions', width: 220,
    render: (r) => h(NSpace, { size: 'small' }, () => [
      h(NButton, { size: 'tiny', onClick: () => openEdit(r) }, () => '編輯'),
      h(NButton, { size: 'tiny', type: 'info', onClick: () => openKeys(r) }, () => '金鑰'),
      h(NButton, { size: 'tiny', type: 'error', onClick: () => confirmDelete(r) }, () => '刪除'),
    ]),
  },
]

onMounted(load)
</script>

<template>
  <div>
    <AdminTabs />

    <NCard>
      <template #header>
        <div class="flex items-center justify-between">
          <span>使用者 ({{ users.length }})</span>
          <NButton type="primary" size="small" @click="showCreate = true">新增使用者</NButton>
        </div>
      </template>
      <NDataTable
        :columns="columns"
        :data="users"
        :loading="loading"
        :row-key="(r: User) => r.id"
        :bordered="false"
        size="small"
      />
    </NCard>

    <!-- Create -->
    <NModal v-model:show="showCreate" preset="card" title="新增使用者" style="width:520px">
      <NForm>
        <NFormItem label="Email">
          <NInput v-model:value="createForm.email" />
        </NFormItem>
        <NFormItem label="名稱">
          <NInput v-model:value="createForm.display_name" />
        </NFormItem>
        <NFormItem label="角色">
          <NSelect v-model:value="createForm.role" :options="roleOptions" />
        </NFormItem>
        <NFormItem label="可用連線（留空 = 全部）">
          <NSelect
            v-model:value="createForm.allowed_conns"
            multiple
            filterable
            clearable
            :options="connOptions"
            placeholder="留空代表可使用全部連線"
          />
        </NFormItem>
        <NFormItem label="初始密碼（選填，留空將產生邀請連結）">
          <NInput
            v-model:value="createForm.initial_password"
            type="password"
            show-password-on="click"
            placeholder="至少 8 字元，留空則自動產生邀請連結"
          />
        </NFormItem>
        <div class="flex justify-end gap-2">
          <NButton @click="showCreate = false">取消</NButton>
          <NButton type="primary" :disabled="!createForm.email" @click="submitCreate">建立</NButton>
        </div>
      </NForm>
    </NModal>

    <!-- Invite token dialog -->
    <NModal v-model:show="showInviteDialog" preset="card" title="邀請連結已產生" style="width:520px">
      <div class="space-y-3">
        <div class="text-sm text-slate-600">
          使用者已建立，但尚未設定密碼。請將以下邀請 Token 傳送給對方，對方可透過「接受邀請」頁面設定密碼後登入。
        </div>
        <div class="p-3 bg-amber-50 border border-amber-200 rounded">
          <div class="text-xs text-amber-700 mb-1">邀請 Token（僅顯示一次）：</div>
          <div class="flex items-center gap-2">
            <code class="text-xs break-all flex-1">{{ inviteToken }}</code>
            <NButton size="tiny" @click="copyInviteToken">複製</NButton>
          </div>
        </div>
        <div v-if="inviteExpiresAt" class="text-xs text-slate-400">到期：{{ inviteExpiresAt }}</div>
      </div>
      <template #footer>
        <div class="flex justify-end">
          <NButton type="primary" @click="showInviteDialog = false">確定</NButton>
        </div>
      </template>
    </NModal>

    <!-- Edit -->
    <NModal :show="!!editTarget" preset="card" title="編輯使用者" style="width:520px"
            @update:show="(v: boolean) => v ? null : (editTarget = null)">
      <NForm v-if="editTarget">
        <NFormItem label="Email"><NInput :value="editTarget.email" disabled /></NFormItem>
        <NFormItem label="名稱"><NInput v-model:value="editForm.display_name" /></NFormItem>
        <NFormItem label="角色"><NSelect v-model:value="editForm.role" :options="roleOptions" /></NFormItem>
        <NFormItem label="可用連線">
          <NSelect
            v-model:value="editForm.allowed_conns"
            multiple
            filterable
            clearable
            :options="connOptions"
            placeholder="留空代表可使用全部連線"
          />
        </NFormItem>
        <NFormItem label="啟用"><NSwitch v-model:value="editForm.is_active" /></NFormItem>
        <div class="flex justify-end gap-2">
          <NButton @click="editTarget = null">取消</NButton>
          <NButton type="primary" @click="submitEdit">儲存</NButton>
        </div>
      </NForm>
    </NModal>

    <!-- Keys drawer -->
    <NDrawer v-model:show="keysDrawer" :width="560" placement="right">
      <NDrawerContent :title="`API 金鑰：${keysUser?.email ?? ''}`">
        <div class="space-y-4">
          <NCard size="small" title="新增金鑰">
            <div class="flex gap-2">
              <NInput v-model:value="newKeyLabel" placeholder="標籤（選填）" />
              <NButton type="primary" @click="issueKey">產生</NButton>
            </div>
            <div v-if="lastRawKey" class="mt-3 p-3 bg-amber-50 border border-amber-200 rounded">
              <div class="text-xs text-amber-700 mb-1">金鑰僅顯示一次，請立即保存：</div>
              <div class="flex items-center gap-2">
                <code class="text-xs break-all flex-1">{{ lastRawKey }}</code>
                <NButton size="tiny" @click="copyKey">複製</NButton>
              </div>
            </div>
          </NCard>

          <NCard size="small" :title="`現有金鑰 (${keys.length})`">
            <div v-if="!keys.length" class="text-slate-400 text-sm">尚無金鑰</div>
            <div v-for="k in keys" :key="k.id"
                 class="border border-slate-200 rounded p-2 mb-2 flex items-center justify-between">
              <div>
                <div class="text-sm font-medium">{{ k.label || '(未命名)' }}</div>
                <div class="text-xs text-slate-500">{{ k.prefix }}… 建立於 {{ k.created_at }}</div>
                <NTag v-if="k.revoked_at" size="tiny" type="error" :bordered="false">已撤銷</NTag>
              </div>
              <NPopconfirm v-if="!k.revoked_at" @positive-click="revokeKey(k)">
                <template #trigger>
                  <NButton size="tiny" type="error">撤銷</NButton>
                </template>
                確定撤銷這張金鑰？
              </NPopconfirm>
            </div>
          </NCard>
        </div>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>
