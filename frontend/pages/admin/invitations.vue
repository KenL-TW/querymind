<script setup lang="ts">
import {
  NButton, NCard, NDataTable, NForm, NFormItem, NInput, NInputNumber,
  NModal, NPopconfirm, NSelect, NSpace, NTag, useMessage, type DataTableColumns,
} from 'naive-ui'
import { computed, h, onMounted, reactive, ref } from 'vue'
import { useApi } from '../../composables/useApi'

declare const definePageMeta: (meta: Record<string, unknown>) => void
definePageMeta({ title: '管理 / 邀請' })

interface Invitation {
  id: number
  email: string
  role: string
  allowed_conns: string[]
  expires_at?: string
  created_at?: string
  used_at?: string | null
  revoked?: boolean
}

interface Role { name: string }
interface ConnInfo { name: string; alive?: boolean }

const api = useApi()
const message = useMessage()

const items = ref<Invitation[]>([])
const roles = ref<Role[]>([])
const conns = ref<ConnInfo[]>([])
const loading = ref(false)

const showCreate = ref(false)
const form = reactive({ email: '', role: 'viewer', allowed_conns: [] as string[], expires_hours: 72 })
const lastToken = ref('')
const lastEmail = ref('')

const lastInviteUrl = computed(() => {
  if (!lastToken.value || import.meta.server) return ''
  return `${window.location.origin}/accept-invite?token=${encodeURIComponent(lastToken.value)}`
})

const roleOptions = computed(() => roles.value.map((r) => ({ label: r.name, value: r.name })))
const connOptions = computed(() => conns.value.map((c) => ({
  label: c.alive === false ? `${c.name}（異常）` : c.name,
  value: c.name,
})))

async function load() {
  loading.value = true
  try {
    const [list, r, c] = await Promise.all([
      api.get<Invitation[]>('/v1/admin/invitations'),
      api.get<Role[]>('/v1/admin/roles'),
      api.get<{ connections: ConnInfo[] }>('/v1/connections'),
    ])
    items.value = list
    roles.value = r
    conns.value = c.connections ?? []
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '載入失敗')
  } finally { loading.value = false }
}

async function submitCreate() {
  try {
    const r = await api.post<{ invitation: Invitation; invite_token: string; warning: string }>(
      '/v1/admin/invitations',
      { ...form },
    )
    lastToken.value = r.invite_token
    lastEmail.value = r.invitation.email
    Object.assign(form, { email: '', role: 'viewer', allowed_conns: [], expires_hours: 72 })
    showCreate.value = false
    message.success('已建立邀請')
    await load()
  } catch (e: unknown) {
    message.error((e as { data?: { detail?: string }; message?: string })?.data?.detail
      ?? (e as { message?: string })?.message ?? '建立失敗')
  }
}

async function revoke(inv: Invitation) {
  try {
    await api.del(`/v1/admin/invitations/${inv.id}`)
    items.value = items.value.filter((item) => item.id !== inv.id)
    message.success('已撤銷')
  } catch (e: unknown) {
    message.error((e as { message?: string })?.message ?? '撤銷失敗')
  }
}

async function copyToken() {
  if (!lastInviteUrl.value) return
  try {
    await navigator.clipboard.writeText(lastInviteUrl.value)
    message.success('已複製邀請連結')
  } catch { message.warning('複製失敗') }
}

async function copyRawToken() {
  if (!lastToken.value) return
  try {
    await navigator.clipboard.writeText(lastToken.value)
    message.success('已複製 token')
  } catch { message.warning('複製失敗') }
}

const columns: DataTableColumns<Invitation> = [
  { title: 'ID', key: 'id', width: 60 },
  { title: 'Email', key: 'email' },
  {
    title: '角色', key: 'role', width: 100,
    render: (r) => h(NTag, { size: 'small', bordered: false, type: 'info' }, () => r.role),
  },
  {
    title: '狀態', key: '_status', width: 100,
    render: (r) => {
      if (r.used_at)   return h(NTag, { size: 'small', type: 'success', bordered: false }, () => '已使用')
      if (r.revoked)return h(NTag, { size: 'small', type: 'error',   bordered: false }, () => '已撤銷')
      if (r.expires_at && new Date(r.expires_at).getTime() < Date.now())
                       return h(NTag, { size: 'small', type: 'warning', bordered: false }, () => '已過期')
      return             h(NTag, { size: 'small', type: 'default', bordered: false }, () => '未使用')
    },
  },
  { title: '過期時間', key: 'expires_at', width: 200 },
  {
    title: '操作', key: 'actions', width: 120,
    render: (r) => r.used_at || r.revoked
      ? h('span', { class: 'text-slate-400 text-xs' }, '—')
      : h(NPopconfirm, { onPositiveClick: () => revoke(r) }, {
          trigger: () => h(NButton, { size: 'tiny', type: 'error' }, () => '撤銷'),
          default: () => '確定撤銷？',
        }),
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
          <span>邀請 ({{ items.length }})</span>
          <NButton type="primary" size="small" @click="showCreate = true">新增邀請</NButton>
        </div>
      </template>
      <NDataTable
        :columns="columns"
        :data="items"
        :loading="loading"
        :row-key="(r: Invitation) => r.id"
        :bordered="false"
        size="small"
      />
    </NCard>

    <NCard v-if="lastToken" size="small" class="mt-4 border-amber-200">
      <template #header>
        <div class="text-amber-700">已生成邀請連結（僅顯示一次）</div>
      </template>
      <div class="text-sm text-slate-700 mb-2">
        請把以下連結交給 <b>{{ lastEmail }}</b>。收到者開啟後即可設定密碼並進入工作區。
      </div>
      <div class="flex items-center gap-2 bg-amber-50 p-2 rounded">
        <code class="text-xs break-all flex-1">{{ lastInviteUrl }}</code>
        <NButton size="tiny" type="primary" @click="copyToken">複製連結</NButton>
      </div>
      <div class="text-xs text-slate-500 mt-2">
        進階：若需要手動串接 API，可使用 token
        <code class="break-all">{{ lastToken }}</code>
        呼叫 <code>POST /v1/auth/accept-invite</code>。
        <NButton size="tiny" text type="info" @click="copyRawToken">複製 token</NButton>
      </div>
    </NCard>

    <NModal v-model:show="showCreate" preset="card" title="新增邀請" style="width:520px">
      <NForm>
        <NFormItem label="Email"><NInput v-model:value="form.email" /></NFormItem>
        <NFormItem label="角色"><NSelect v-model:value="form.role" :options="roleOptions" /></NFormItem>
        <NFormItem label="可用連線">
          <NSelect
            v-model:value="form.allowed_conns"
            multiple
            filterable
            clearable
            :options="connOptions"
            placeholder="留空代表可使用全部連線"
          />
        </NFormItem>
        <NFormItem label="過期小時">
          <NInputNumber v-model:value="form.expires_hours" :min="1" :max="720" />
        </NFormItem>
        <div class="flex justify-end gap-2">
          <NButton @click="showCreate = false">取消</NButton>
          <NButton type="primary" :disabled="!form.email" @click="submitCreate">建立</NButton>
        </div>
      </NForm>
    </NModal>
  </div>
</template>
